terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
  }
}

variable "name"        { type = string }
variable "vpc_id"      { type = string }
variable "subnet_ids"  { type = list(string) }
variable "node_type"   { type = string default = "cache.t4g.small" }
variable "api_security_group_id" { type = string }
variable "kms_key_arn" { type = string }

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-cache-subnets"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "cache" {
  name   = "${var.name}-cache"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.api_security_group_id]
  }
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

# AC: Redis ACLs for queue isolation — separate users for queue vs session storage
resource "aws_elasticache_user" "queue" {
  user_id       = "${var.name}-queue"
  user_name     = "queue"
  engine        = "REDIS"
  access_string = "on ~bull:* ~bullmq:* +@all -@dangerous"
  authentication_mode {
    type      = "password"
    passwords = [random_password.auth.result]
  }
}

resource "aws_elasticache_user" "session" {
  user_id   = "${var.name}-session"
  user_name = "session"
  engine    = "REDIS"
  access_string = "on ~session:* +@all -@dangerous"
  authentication_mode {
    type      = "password"
    passwords = [random_password.auth.result]
  }
}

resource "aws_elasticache_user_group" "this" {
  engine        = "REDIS"
  user_group_id = "${var.name}-users"
  user_ids      = ["default", aws_elasticache_user.queue.user_id, aws_elasticache_user.session.user_id]
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "${var.name} Redis (BullMQ + sessions)"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.node_type
  num_cache_clusters         = 2
  parameter_group_name       = "default.redis7"
  port                       = 6379
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.cache.id]

  # AC: Redis TLS enabled
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  user_group_ids             = [aws_elasticache_user_group.this.user_group_id]

  snapshot_retention_limit = 7
  snapshot_window          = "03:00-04:00"
  maintenance_window       = "sun:04:00-sun:05:00"
}

resource "aws_secretsmanager_secret" "redis" {
  name       = "${var.name}/redis"
  kms_key_id = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    host     = aws_elasticache_replication_group.this.primary_endpoint_address
    port     = aws_elasticache_replication_group.this.port
    auth     = random_password.auth.result
    tls      = true
  })
}

output "endpoint"       { value = aws_elasticache_replication_group.this.primary_endpoint_address }
output "secret_arn"     { value = aws_secretsmanager_secret.redis.arn }
output "security_group" { value = aws_security_group.cache.id }
