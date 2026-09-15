import json
from pathlib import Path
root=Path(__file__).parent
bootstrap='''#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/synthgen-bootstrap.log) 2>&1
dnf install -y docker unzip
systemctl enable --now docker
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '/swapfile none swap sw 0 0\\n' >> /etc/fstab
mkdir -p /usr/local/lib/docker/cli-plugins /opt/synthgen-stage
cd /opt/synthgen-stage
curl -fLsS https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 -o docker-compose-linux-x86_64
curl -fLsS https://github.com/docker/compose/releases/download/v2.39.4/checksums.txt -o checksums.txt
sha256sum --check --ignore-missing checksums.txt
install -m 755 docker-compose-linux-x86_64 /usr/local/lib/docker/cli-plugins/docker-compose
aws s3 cp s3://${ArtifactBucket}/${ArtifactKey} source.zip --region ${AWS::Region}
echo '${ArtifactSha256}  source.zip' | sha256sum --check
unzip -q source.zip
mv SynthGen /opt/synthgen
cd /opt/synthgen
docker build -t synthgen-pilot .
touch /opt/synthgen/BUILD_READY
'''
t={
 'AWSTemplateFormatVersion':'2010-09-09',
 'Description':'SynthGen trusted-user pilot: EC2, encrypted disk, HTTPS ingress and Systems Manager access. App starts only after private login configuration.',
 'Parameters':{
  'VpcId':{'Type':'AWS::EC2::VPC::Id'},'SubnetId':{'Type':'AWS::EC2::Subnet::Id'},
  'ImageId':{'Type':'AWS::EC2::Image::Id'},
  'ArtifactBucket':{'Type':'String'},'ArtifactKey':{'Type':'String'},
  'ArtifactSha256':{'Type':'String','AllowedPattern':'[a-f0-9]{64}'},
 },
 'Resources':{
  'WebSecurityGroup':{'Type':'AWS::EC2::SecurityGroup','Properties':{
   'GroupDescription':'SynthGen HTTPS and certificate issuance; no inbound SSH', 'VpcId':{'Ref':'VpcId'},
   'SecurityGroupIngress':[{'IpProtocol':'tcp','FromPort':p,'ToPort':p,'CidrIp':'0.0.0.0/0'} for p in [80,443]],
   'Tags':[{'Key':'Application','Value':'SynthGen'}]}},
  'HostRole':{'Type':'AWS::IAM::Role','Properties':{
   'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'ec2.amazonaws.com'},'Action':'sts:AssumeRole'}]},
   'ManagedPolicyArns':['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
   'Policies':[{'PolicyName':'ReadSynthGenRelease','PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'s3:GetObject','Resource':{'Fn::Sub':'arn:${AWS::Partition}:s3:::${ArtifactBucket}/${ArtifactKey}'}}]}}]}},
  'HostProfile':{'Type':'AWS::IAM::InstanceProfile','Properties':{'Roles':[{'Ref':'HostRole'}]}},
  'Host':{'Type':'AWS::EC2::Instance','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{
   'ImageId':{'Ref':'ImageId'},'InstanceType':'t3.small','CreditSpecification':{'CPUCredits':'standard'},
   'IamInstanceProfile':{'Ref':'HostProfile'},'MetadataOptions':{'HttpTokens':'required','HttpPutResponseHopLimit':1},
   'NetworkInterfaces':[{'DeviceIndex':'0','SubnetId':{'Ref':'SubnetId'},'AssociatePublicIpAddress':True,'GroupSet':[{'Ref':'WebSecurityGroup'}]}],
   'BlockDeviceMappings':[{'DeviceName':'/dev/xvda','Ebs':{'VolumeSize':30,'VolumeType':'gp3','Encrypted':True,'DeleteOnTermination':False}}],
   'Tags':[{'Key':'Name','Value':'synthgen-pilot'},{'Key':'Application','Value':'SynthGen'}],
   'UserData':{'Fn::Base64':{'Fn::Sub':bootstrap}}
  }}
 },
 'Outputs':{'InstanceId':{'Value':{'Ref':'Host'}},'PublicIp':{'Value':{'Fn::GetAtt':['Host','PublicIp']}}}
}
(root/'pilot-stack.json').write_text(json.dumps(t,indent=2)+'\n')
print('Wrote pilot-stack.json')