variable "name" { type = string }
variable "region" { type = string }
variable "vpc_cidr" { type = string }
variable "db_min_capacity" { type = number }
variable "db_max_capacity" { type = number }
variable "api_desired_count" { type = number }
variable "realtime_desired_count" { type = number }
variable "worker_desired_count" { type = number }
variable "db_backup_retention_days" {
  type        = number
  description = "Aurora backup retention. Free-tier accounts are limited to 1 day."
  default     = 7
}
variable "db_instance_count" {
  type    = number
  default = 2
}
variable "enable_aurora_cluster" {
  type        = bool
  description = "When false, Aurora is provisioned outside Terraform (for example Aurora PostgreSQL express on the AWS Free Tier)."
  default     = true
}

variable "domain_name" {
  type        = string
  description = "Public DNS name supplied by the operator. Do not invent one."
}

variable "enable_public_edge" {
  type        = bool
  description = "Route 53, ACM, ALB listeners, ECR, and ECS services for api/realtime hostnames under domain_name."
  default     = false
}

variable "enable_https_listener" {
  type        = bool
  description = "Attach the validated ACM certificate to the ALB HTTPS listener. Set true after Route 53 delegation and ACM issuance."
  default     = false
}

variable "parent_domain_name" {
  type        = string
  description = "When domain_name is a delegated subdomain (for example staging.solomad.app), create this parent zone and NS-delegate the child."
  default     = ""
}
