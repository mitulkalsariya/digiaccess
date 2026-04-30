terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
  }
}

variable "name"          { type = string }
variable "vpc_id"        { type = string }
variable "subnet_ids"    { type = list(string) } # private subnets only
variable "instance_class" { type = string  default = "db.t4g.medium" }
variable "allocated_storage" { type = number default = 50 }
variable "api_security_group_id" { type = string }
variable "kms_key_arn"   { type = string }

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db-subnets"
  subnet_ids = var.subnet_ids
}

# AC: DB reachable from API service only — ingress restricted to API SG
resource "aws_security_group" "db" {
  name   = "${var.name}-db"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.api_security_group_id]
  }
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "this" {
  identifier              = var.name
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.instance_class
  allocated_storage       = var.allocated_storage
  storage_type            = "gp3"
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn
  username                = "a11y"
  password                = random_password.db.result
  db_name                 = "a11y"
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  publicly_accessible     = false # AC: no public access

  # AC: daily backups + PITR
  backup_retention_period = 14
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  delete_automated_backups = false
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.name}-final"

  performance_insights_enabled = true
  monitoring_interval          = 60
  enabled_cloudwatch_logs_exports = ["postgresql"]

  apply_immediately = false
}

# Persist credentials in Secrets Manager for the API to read at boot
resource "aws_secretsmanager_secret" "db" {
  name       = "${var.name}/postgres"
  kms_key_id = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    database = aws_db_instance.this.db_name
    username = aws_db_instance.this.username
    password = random_password.db.result
  })
}

output "endpoint"       { value = aws_db_instance.this.address }
output "secret_arn"     { value = aws_secretsmanager_secret.db.arn }
output "security_group" { value = aws_security_group.db.id }
