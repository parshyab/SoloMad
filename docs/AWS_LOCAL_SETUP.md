# Local AWS sign-in

Staging commands use profile `solomad-staging` and region `us-east-1`, the same region as `infra/terraform/environments/staging`. The AWS console region (including Stockholm) does not override that. This page is local authentication only. It does not create infrastructure or apply Terraform.

Terraform 1.16.5 is pinned at `tools/terraform/terraform`. The AWS provider 5.100.0 does not consume `login_session` on `solomad-staging`. A second local profile, `solomad-staging-terraform`, runs `credential_process = aws configure export-credentials --profile solomad-staging --format process`.

```bash
export AWS_PROFILE=solomad-staging-terraform
export AWS_REGION=us-east-1
tools/terraform/terraform version
make terraform-check
```

## Cause

On 2026-10-09, `aws login` reached the browser and then failed the token exchange with `certificate verify failed: self-signed certificate in certificate chain`. No proxy environment variables were set. `AWS_CA_BUNDLE`, `SSL_CERT_FILE`, and `REQUESTS_CA_BUNDLE` were unset. AWS CLI 2.37.11 trusts `/usr/local/aws-cli/awscli/botocore/cacert.pem`, which does not include the company's TLS inspection CA.

The presented chain for `us-east-1.signin.aws.amazon.com` was issued by Netskope (`ca.nykaa.eu.goskope.com`, signed by `caadmin.netskope.com`). Those two CA certificates were already in the macOS System keychain, and `security verify-cert` accepted the leaf for SSL. Their SHA-256 fingerprints matched the System keychain copies:

- `caadmin.netskope.com`: `20:24:A2:B1:8D:68:FC:53:C0:26:5B:14:71:85:4D:17:D6:85:6B:E2:EC:D6:8C:7B:47:71:F8:5A:7C:27:64:F2` (valid through 2034-01-06)
- `ca.nykaa.eu.goskope.com`: `33:19:37:89:D1:0D:53:E7:01:96:D3:DE:F4:C1:2C:5D:3F:C8:5D:09:A5:6C:A5:3F:4B:CF:7E:83:88:03:64:E9` (valid through 2034-03-26)

The vendor bundle still returned `unable to get local issuer certificate`.

## Repair

The original vendor bundle was not modified. A separate file, `~/.aws/certs/solomad-ca-bundle.pem`, contains that public vendor bundle plus the two public CA certificates exported from the System keychain. No private keys were exported. Profile `solomad-staging` sets `ca_bundle` to that file. Certificate verification stays enabled.

`--ca-bundle` overrides `AWS_CA_BUNDLE`, which overrides the profile `ca_bundle`. Leave those overrides unset for this profile.

## Commands

```bash
aws configure set region us-east-1 --profile solomad-staging
aws configure set output json --profile solomad-staging
aws configure set ca_bundle "$HOME/.aws/certs/solomad-ca-bundle.pem" --profile solomad-staging
aws login --profile solomad-staging --region us-east-1
aws sts get-caller-identity --profile solomad-staging --region us-east-1 --output json --no-cli-pager
```

Complete the password and MFA prompts in the AWS sign-in page. Do not reuse an authorization code from a failed attempt.

## Renewal

Rebuild `~/.aws/certs/solomad-ca-bundle.pem` when the installed Netskope CA in the System keychain changes, or when the AWS CLI replaces its vendor bundle. Export the new public CA from the System keychain and confirm its fingerprint before appending it. Do not add a certificate only because it appeared on the network.

## Rollback

There was no `~/.aws/config` or `~/.aws/credentials` file before this profile was created. To undo the local trust change, delete the `solomad-staging` profile from `~/.aws/config` and delete `~/.aws/certs/solomad-ca-bundle.pem`. The vendor file `/usr/local/aws-cli/awscli/botocore/cacert.pem` was not edited.

Login caches and credential files stay under `~/.aws` and are not part of this repository.
