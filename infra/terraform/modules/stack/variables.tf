variable "name" { type = string }
variable "region" { type = string }
variable "vpc_cidr" { type = string }
variable "db_min_capacity" { type = number }
variable "db_max_capacity" { type = number }
variable "api_desired_count" { type = number }
variable "realtime_desired_count" { type = number }
variable "worker_desired_count" { type = number }

variable "domain_name" {
  type        = string
  description = "Public DNS name supplied by the operator. Do not invent one."
}
