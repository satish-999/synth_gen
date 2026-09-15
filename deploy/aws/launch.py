"""Run in AWS CloudShell after approving the pilot. No credentials in this file."""
import argparse, hashlib, json, pathlib, sys
import boto3
from botocore.exceptions import ClientError
parser=argparse.ArgumentParser()
parser.add_argument('--release', required=True)
parser.add_argument('--apply', action='store_true')
a=parser.parse_args()
region='eu-north-1'
session=boto3.Session(region_name=region)
account=session.client('sts').get_caller_identity()['Account']
if account != '470100169590': sys.exit('Wrong AWS account; deployment stopped.')
release=pathlib.Path(a.release).resolve()
if not release.is_file(): sys.exit('Release archive does not exist.')
sha=hashlib.sha256(release.read_bytes()).hexdigest()
cf=session.client('cloudformation'); ec2=session.client('ec2')
template=(pathlib.Path(__file__).parent/'pilot-stack.json').read_text()
cf.validate_template(TemplateBody=template)
vpcs=ec2.describe_vpcs(Filters=[{'Name':'is-default','Values':['true']}])['Vpcs']
if len(vpcs)!=1: sys.exit('Expected one default VPC; review networking first.')
vpc=vpcs[0]['VpcId']
subnets=ec2.describe_subnets(Filters=[{'Name':'vpc-id','Values':[vpc]}])['Subnets']
subnets=sorted((s for s in subnets if s['AvailableIpAddressCount']>0 and s.get('DefaultForAz')),key=lambda s:s['AvailabilityZone'])
if not subnets: sys.exit('No suitable default subnet.')
images=ec2.describe_images(Owners=['amazon'],Filters=[{'Name':'name','Values':['al2023-ami-2023*-x86_64']},{'Name':'state','Values':['available']}])['Images']
image=max(images,key=lambda i:i['CreationDate'])['ImageId']
stack='synthgen-pilot'
try:
    old=cf.describe_stacks(StackName=stack)['Stacks'][0]
except ClientError as e:
    if 'does not exist' not in str(e): raise
else:
    print(json.dumps({'existingStack':old['StackStatus'],'outputs':old.get('Outputs',[])}))
    sys.exit('Existing stack found; review it instead of creating a duplicate.')
bucket=f'synthgen-release-{account}-{region}'
key=f'releases/{sha}/source.zip'
parameters={'VpcId':vpc,'SubnetId':subnets[0]['SubnetId'],'ImageId':image,'ArtifactBucket':bucket,'ArtifactKey':key,'ArtifactSha256':sha}
print(json.dumps({'account':account,'region':region,'stack':stack,'instance':'t3.small','parameters':parameters,'mode':'apply' if a.apply else 'plan'},indent=2))
if not a.apply: sys.exit(0)
s3=session.client('s3')
try: s3.head_bucket(Bucket=bucket,ExpectedBucketOwner=account)
except ClientError as e:
    if str(e.response['Error']['Code']) not in ('404','NoSuchBucket'): raise
    s3.create_bucket(Bucket=bucket,CreateBucketConfiguration={'LocationConstraint':region},ObjectOwnership='BucketOwnerEnforced')
s3.put_public_access_block(Bucket=bucket,PublicAccessBlockConfiguration={k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']})
s3.put_bucket_encryption(Bucket=bucket,ServerSideEncryptionConfiguration={'Rules':[{'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]})
s3.upload_file(str(release),bucket,key,ExtraArgs={'ServerSideEncryption':'AES256'})
response=cf.create_stack(StackName=stack,TemplateBody=template,Parameters=[{'ParameterKey':k,'ParameterValue':v} for k,v in parameters.items()],Capabilities=['CAPABILITY_IAM'],Tags=[{'Key':'Application','Value':'SynthGen'}],ClientRequestToken='synthgen-'+sha[:32])
pathlib.Path('synthgen-deployment.json').write_text(json.dumps({'stackId':response['StackId'],**parameters},indent=2))
print('Stack requested:',response['StackId'])
print('Monitor stack events. Do not treat CREATE_COMPLETE as application readiness.')
