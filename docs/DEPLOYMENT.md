# Deployment

No environment has been applied. There is no public URL.

## What the Terraform describes

`infra/terraform/modules/stack` sketches a VPC, two public and two private subnets, an Aurora PostgreSQL cluster with managed master password and seven-day backups, a private Redis replication group, SQS with a dead-letter queue, a private media bucket, an internet-facing load balancer, and an ECS cluster. Staging and production are separate directories. Their remote state buckets are placeholders named `REPLACE_WITH_STATE_BUCKET`. Native S3 locking is enabled with `use_lockfile = true`. Terraform is pinned to 1.16.5 (`>= 1.10.0`).

The repository region is `us-east-1` in both environment roots, the AWS provider, and the S3 backend. A console session left on Stockholm (`eu-north-1`) does not change that.

This repository has no command that creates the Terraform state bucket. After the account is signed up for S3, create one bucket in `us-east-1` with versioning, then replace `REPLACE_WITH_STATE_BUCKET`. Do not run that from this repo until the bucket name is chosen.

```bash
# Owner-run after S3 is enabled. Choose a globally unique name. Do not apply Terraform from this.
aws s3api create-bucket --profile solomad-staging --region us-east-1 --bucket REPLACE_WITH_STATE_BUCKET
aws s3api put-bucket-versioning --profile solomad-staging --bucket REPLACE_WITH_STATE_BUCKET --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --profile solomad-staging --bucket REPLACE_WITH_STATE_BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

The AWS provider 5.100.0 does not read `aws login` sessions on `solomad-staging`. Use the local Terraform-only profile, which calls `aws configure export-credentials --profile solomad-staging --format process`:

```bash
export AWS_PROFILE=solomad-staging-terraform
export AWS_REGION=us-east-1
make terraform-check
```

Do not add `credential_process` to `solomad-staging` itself; that breaks `aws login`.

On 2026-10-09, Terraform with that profile returned account `147435199603` / `arn:aws:iam::147435199603:root`. The same identity then received `NotSignedUp` from S3 and `OptInRequired` from EC2 in `us-east-1`. Authentication succeeded; the account has not subscribed to those services yet.

## Permissions the stack will need after service opt-in

Backend (once `REPLACE_WITH_STATE_BUCKET` exists), per HashiCorp S3 backend docs with `use_lockfile`:

- `s3:ListBucket` on the bucket
- `s3:GetObject` and `s3:PutObject` on `solomad/staging/terraform.tfstate` (and the production key)
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the matching `.tflock` object

Stack resources in `infra/terraform/modules/stack/main.tf` also require API access for:

- EC2 VPC, subnets, security groups, and availability zones
- Elastic Load Balancing application load balancer
- RDS Aurora PostgreSQL clusters and instances, plus Secrets Manager for `manage_master_user_password`
- ElastiCache Redis replication groups
- SQS queues
- S3 media buckets and public-access blocks
- ECS clusters

The current root identity has those APIs in principle, but this account is not signed up for S3 or EC2 yet, so apply remains blocked regardless of IAM.

Missing from the applied path, and not claimed as running: ECS task definitions, ECR images, ACM certificates, Route 53 records, CloudFront, Secrets Manager entries, autoscaling policies, and a PostGIS parameter group. Aurora PostgreSQL still needs the PostGIS extension enabled after the cluster exists.

Do not run `terraform apply` until the operator supplies a real state bucket and domain, and the account can call S3 and EC2 in `us-east-1`. Applying this module as written would try to create billable resources and would fail closed on the placeholder backend.

## Runtime rules

Staging and production start only when `assertRuntimeSafe` accepts the environment. That requires `AUTH_MODE=supabase` with a hosted https project, and rejects local Supabase endpoints, emulator hosts, auth bypass, entitlement test overrides, LocalStack endpoints, fixture providers, and missing Supabase, APNs, RevenueCat, and admin settings. `pnpm verify:release` loads that check.

API, gateway, and worker scale as separate services. Membership and entitlement reads after a write use the primary. Discovery may use a replica once replica lag is monitored. Connection pools must be sized against the maximum task count.

## Rollback

Keep the previous ECS task definition. Roll the service back to it if health checks fail. Database changes stay expand-only until the previous app version is gone. Restore from Aurora PITR. The recovery objectives, RPO within 5 minutes and RTO within 60 minutes, are targets until a restore drill is recorded.

## Cost

The module does not contain a measured bill. A planning envelope for the first production size is two API tasks, two gateway tasks, two worker tasks, Aurora Serverless v2 between 1 and 16 ACU, and a two-node `cache.t4g.small` group. Price those from the current AWS public rate card for the chosen region before approval. Do not treat this paragraph as a quote or a benchmark.
