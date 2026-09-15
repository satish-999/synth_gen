# AWS pilot release

Target: AWS account 470100169590 (Avineni Jhansi), eu-north-1 / Stockholm.
The deployment creates one t3.small host, 30 GiB encrypted gp3 disk, a dedicated
security group within the existing default VPC, and an instance role for Systems
Manager plus read access to this release object only. Public inbound ports are
80/443; SSH port 22 is closed. IMDSv2 is required and CPU credits use Standard mode
to avoid surplus-credit charges. A private S3 bucket holds the source release.

The confirmed EC2 rate is USD 0.0216/hour (~USD 15.77 per 730 hours). Add the public
IPv4 (~USD 3.65/month), disk, S3 and traffic. Allow around USD 25/month for light
pilot use; this is an estimate, not a hard spending cap. Retained disks and hosts
can continue costing money after stack deletion; review all retained resources
when ending the pilot. No paid plan upgrade is included.

Deployment must use the current local source ZIP, not the older GitHub version.
The stack installs Docker and verified Compose v2.39.4, downloads the private source
archive, verifies its SHA256, and builds the image. CloudFormation CREATE_COMPLETE
does not mean the image has finished building: check /var/log/synthgen-bootstrap.log
and /opt/synthgen/BUILD_READY through Session Manager.

A DNS hostname pointing at the public IP is required for HTTPS. Before using a
new hostname, confirm ownership or approval for a temporary DNS service. The
instance IP may change after a stop/start unless an Elastic IP is reserved later.

The owner sets the login interactively through Session Manager:
`sudo bash /opt/synthgen/deploy/aws/configure.sh`
Credentials are not included in startup metadata, source ZIP or CloudFormation.
Afterward verify HTTPS, authentication, sample generation, incremental reuse,
restart persistence and backups. Do not claim deployment finished until those
checks pass. This is a trusted-user shared workspace, not multi-tenant SaaS.

Local saved models and generated datasets are not included in the source ZIP;
the cloud pilot initially starts with its default model. Export and migrate local
runtime data separately if those existing datasets are needed in the cloud.