terraform {
  required_version = ">= 1.10.0"
  backend "s3" {
    bucket       = "solomad-tf-state-147435199603-us-east-1"
    key          = "solomad/staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" { region = "us-east-1" }

variable "enable_https_listener" {
  type    = bool
  default = false
}

module "stack" {
  source                   = "../../modules/stack"
  name                     = "solomad-staging"
  region                   = "us-east-1"
  vpc_cidr                 = "10.20.0.0/16"
  db_min_capacity          = 0.5
  db_max_capacity          = 4
  db_backup_retention_days = 1
  db_instance_count        = 1
  enable_aurora_cluster    = false
  enable_public_edge       = true
  enable_https_listener    = var.enable_https_listener
  api_desired_count        = 1
  realtime_desired_count   = 2
  worker_desired_count     = 1
  domain_name              = "staging.solomad.app"
  parent_domain_name       = "solomad.app"
}

output "alb_dns_name" { value = module.stack.alb_dns_name }
output "media_bucket" { value = module.stack.media_bucket }
output "queue_url" { value = module.stack.queue_url }
output "redis_primary_endpoint" { value = module.stack.redis_primary_endpoint }
output "route53_name_servers" { value = module.stack.route53_name_servers }
output "parent_route53_name_servers" { value = module.stack.parent_route53_name_servers }
output "runtime_secret_arn" { value = module.stack.runtime_secret_arn }
output "codebuild_project_name" { value = module.stack.codebuild_project_name }
output "ecr_api_repository_url" { value = module.stack.ecr_api_repository_url }
output "ecr_realtime_repository_url" { value = module.stack.ecr_realtime_repository_url }
