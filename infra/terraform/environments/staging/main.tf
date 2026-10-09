terraform {
  required_version = ">= 1.10.0"
  backend "s3" {
    bucket       = "REPLACE_WITH_STATE_BUCKET"
    key          = "solomad/staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" { region = "us-east-1" }

module "stack" {
  source                 = "../../modules/stack"
  name                   = "solomad-staging"
  region                 = "us-east-1"
  vpc_cidr               = "10.20.0.0/16"
  db_min_capacity        = 0.5
  db_max_capacity        = 4
  api_desired_count      = 2
  realtime_desired_count = 2
  worker_desired_count   = 1
  domain_name            = "REPLACE_WITH_STAGING_DOMAIN"
}
