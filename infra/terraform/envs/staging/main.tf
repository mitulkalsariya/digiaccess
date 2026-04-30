terraform {
  required_version = ">= 1.6"
  backend "s3" {
    bucket         = "a11y-tfstate" # override via -backend-config in CI
    key            = "envs/staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "a11y-tflock"
    encrypt        = true
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
  }
}

provider "aws" { region = var.region }

variable "region" { type = string default = "us-east-1" }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "api_security_group_id" { type = string }
variable "kms_key_arn" { type = string }

module "postgres" {
  source                = "../../modules/postgres"
  name                  = "a11y-staging"
  vpc_id                = var.vpc_id
  subnet_ids            = var.private_subnet_ids
  api_security_group_id = var.api_security_group_id
  kms_key_arn           = var.kms_key_arn
}

module "redis" {
  source                = "../../modules/redis"
  name                  = "a11y-staging"
  vpc_id                = var.vpc_id
  subnet_ids            = var.private_subnet_ids
  api_security_group_id = var.api_security_group_id
  kms_key_arn           = var.kms_key_arn
}

output "postgres_secret_arn" { value = module.postgres.secret_arn }
output "redis_secret_arn"    { value = module.redis.secret_arn }
