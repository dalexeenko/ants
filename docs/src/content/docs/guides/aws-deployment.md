---
title: AWS Deployment
description: Deploy Ants to AWS using the included Terraform configuration — ECS Fargate on ARM64 Graviton.
sidebar:
  order: 3
---

Ants includes a production-ready Terraform configuration that deploys to AWS on **ECS Fargate with ARM64 (Graviton)** for lower cost.

## Architecture

```
Internet -> NLB (public subnets) -> ECS Fargate ARM64 -> EFS (persistent data)
                                         |
                                    CloudWatch Logs
```

**What gets created:**

- VPC with public/private subnets across 2 AZs
- Network Load Balancer (public, TLS termination with ACM when HTTPS is enabled)
- ECS Cluster + Fargate service (ARM64/Graviton)
- EFS file system for persistent `/data` and `/workspaces` volumes
- CloudWatch log group
- *(Optional)* NAT Gateway + private subnets
- *(Optional)* ACM certificate + Route 53 DNS record for custom domain/HTTPS
- *(Optional)* ECR private repository for custom Docker images

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS CLI configured with appropriate credentials
- *(Optional)* A Route 53 hosted zone for a custom domain

## Quick Start

```bash
cd deploy/aws/terraform

# 1. Generate an encryption key
openssl rand -base64 32

# 2. Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — at minimum, set ants_encryption_key

# 3. Deploy
terraform init
terraform plan
terraform apply
```

After deployment, Terraform outputs the URL to access your server.

## Authentication Modes

You must choose exactly one authentication mode. Terraform will error if you set both or neither.

### Bearer Token (single-user)

All clients share one API token. Good for personal or single-tenant deployments.

```hcl
ants_encryption_key = "OUTPUT_OF_openssl_rand_-base64_32"
ants_secret         = "OUTPUT_OF_openssl_rand_-base64_32"
```

### Multi-User Mode

Individual user accounts with RBAC (admin, operator, viewer). The setup token secures the initial admin creation.

```hcl
ants_encryption_key = "OUTPUT_OF_openssl_rand_-base64_32"
ants_multi_user     = true
ants_setup_token    = "OUTPUT_OF_openssl_rand_-base64_32"
```

After deploying, visit the server URL to complete initial admin setup with the setup token.

## HTTPS with Custom Domain

If you have a Route 53 hosted zone, Terraform automatically creates an ACM certificate, validates it via DNS, and sets up the domain:

```hcl
project_name     = "ants"
aws_region       = "us-east-1"
image            = "ants/server:latest"
ants_secret   = "OUTPUT_OF_openssl_rand_-base64_32"
domain_name      = "ants.example.com"
hosted_zone_name = "example.com"
```

:::caution
Without a custom domain, the server is only accessible over plain HTTP via the NLB's auto-generated DNS name. All traffic — including API keys — will be unencrypted. Always use HTTPS for production.
:::

## Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `project_name` | `ants` | Name prefix for all AWS resources |
| `environment` | `production` | Environment name |
| `aws_region` | `us-east-1` | AWS region |
| `image` | `ants/server:latest` | Docker image |
| `cpu` | `256` | Fargate CPU units (256 = 0.25 vCPU) |
| `memory` | `512` | Fargate memory in MiB |
| `desired_count` | `1` | Number of running tasks |
| `enable_nat_gateway` | `false` | Use NAT Gateway + private subnets |
| `enable_efs` | `true` | Enable EFS persistent volumes |
| `domain_name` | `""` | Custom domain (e.g., `ants.example.com`) |
| `hosted_zone_name` | `""` | Route 53 zone (e.g., `example.com`) |
| `certificate_arn` | `""` | Existing ACM certificate ARN |
| `ants_encryption_key` | *(required)* | AES-256 key for encrypting stored secrets |
| `ants_secret` | `""` | Bearer token (single-user mode) |
| `ants_multi_user` | `false` | Enable multi-user mode |
| `ants_setup_token` | `""` | One-time setup token (required with multi-user) |
| `ants_web_app` | `false` | Enable the full web app UI at `/app` |
| `enable_ecr` | `false` | Create a private ECR repository |

## Cost Estimate

With default settings (ARM64, NLB, EFS, no NAT Gateway):

| Resource | Monthly Cost |
|----------|-------------|
| Fargate (ARM64) | ~$58 |
| NLB | ~$6 + data transfer |
| EFS | ~$0.30/GB stored |
| **Total (idle)** | **~$64/mo** |

Add ~$32/mo if you enable the NAT Gateway for private subnet isolation.

## Useful Commands

```bash
# View logs
aws logs tail /ecs/ants-production --follow

# Force new deployment (pull latest image)
aws ecs update-service \
  --cluster ants-production-cluster \
  --service ants-production-service \
  --force-new-deployment

# Tear down everything
terraform destroy
```
