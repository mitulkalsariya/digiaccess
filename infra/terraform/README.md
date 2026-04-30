# Terraform — staging + production data plane

Modules:

- `modules/postgres` — RDS Postgres 16 with PITR + daily backups, private subnet only
- `modules/redis` — ElastiCache Redis 7 with TLS, AUTH, ACL groups
- `envs/staging` / `envs/production` — root configs that wire modules together

## Bootstrap (once per AWS account)

State lives in S3 + DynamoDB. The bucket and lock table are bootstrapped manually:

```bash
aws s3api create-bucket --bucket a11y-tfstate-${ACCOUNT_ID} --region us-east-1
aws dynamodb create-table --table-name a11y-tflock --region us-east-1 \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## Per-environment apply

```bash
cd envs/staging
terraform init
terraform plan -out=plan.out
terraform apply plan.out
```

OIDC roles `STAGING_DEPLOY_ROLE_ARN` / `PRODUCTION_DEPLOY_ROLE_ARN` are
provisioned out-of-band by the security team — Terraform here only consumes them.
