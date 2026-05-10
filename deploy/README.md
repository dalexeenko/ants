# Ants Deploy

Example infrastructure configurations for deploying the [Ants](https://github.com/ants/ants) server.

## AWS (Terraform)

Deploys Ants on **ECS Fargate with ARM64 (Graviton)** for lower cost.

### Architecture

```
Internet -> NLB (public subnets) -> ECS Fargate ARM64 -> EFS (persistent data)
                                         |
                                    CloudWatch Logs
```

**What gets created:**

- VPC with public/private subnets across 2 AZs
- Network Load Balancer (public, TLS termination with ACM when HTTPS enabled)
- ECS Cluster + Fargate service (ARM64/Graviton)
- EFS file system for persistent `/data` and `/workspaces` volumes
- CloudWatch log group
- *(Optional)* NAT Gateway + private subnets (`enable_nat_gateway = true`)
- *(Optional)* ACM certificate + Route 53 DNS record for custom domain/HTTPS
- *(Optional)* ECR private repository for custom Docker images

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS CLI configured with appropriate credentials
- *(Optional)* A Route 53 hosted zone if you want a custom domain

### Quick Start

```bash
cd aws/terraform

# 1. Generate an encryption key (required)
openssl rand -base64 32

# 2. Copy and edit the example variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — at minimum, set ants_encryption_key

# 3. Initialize Terraform
terraform init

# 4. Preview the changes
terraform plan

# 5. Deploy
terraform apply
```

After deployment, Terraform will output the URL to access your server.

### Configuration

#### Authentication modes

You must choose **exactly one** of two authentication modes. Terraform will error if you set both or neither.

**Option 1: Bearer token (single-user)**

All clients share one API token. Good for personal or single-tenant deployments.

```hcl
# terraform.tfvars
ants_encryption_key = "OUTPUT_OF_openssl_rand_-base64_32"
ants_secret         = "OUTPUT_OF_openssl_rand_-base64_32"
```

**Option 2: Multi-user mode**

Individual user accounts with RBAC (admin, operator, viewer). The setup token secures the initial admin creation so that only you can claim it.

```hcl
# terraform.tfvars
ants_encryption_key = "OUTPUT_OF_openssl_rand_-base64_32"
ants_multi_user     = true
ants_setup_token    = "OUTPUT_OF_openssl_rand_-base64_32"
```

After deploying, visit the server URL in your browser to complete initial admin setup with the setup token.

> **Note:** You cannot set both `ants_secret` and `ants_multi_user`. They are mutually exclusive authentication modes.

#### Minimal (HTTP only)

> **Warning:** Without a custom domain, the server is only accessible over plain HTTP via the NLB's auto-generated DNS name. All traffic — including API keys and session data — will be sent unencrypted. This configuration is **not suitable for production**. Use a custom domain with HTTPS (see below) for any deployment handling real data.

> **Warning:** Without a custom domain, the server allows requests with **any** Host header (`ANTS_ALLOWED_HOSTS=*`), which disables [DNS rebinding](https://en.wikipedia.org/wiki/DNS_rebinding) protection. When you set `domain_name`, the allowed hosts are automatically restricted to that domain. For production, always configure a custom domain.

```hcl
# terraform.tfvars
project_name           = "ants"
aws_region             = "us-east-1"
image                  = "ants/server:latest"
ants_encryption_key = "OUTPUT_OF_openssl_rand_-base64_32"
ants_secret         = "OUTPUT_OF_openssl_rand_-base64_32"
```

#### With custom domain and HTTPS (recommended)

If you have a Route 53 hosted zone, Terraform will automatically create an ACM certificate, validate it via DNS, and set up the domain:

```hcl
# terraform.tfvars
project_name     = "ants"
aws_region       = "us-east-1"
image            = "ants/server:latest"
ants_secret   = "OUTPUT_OF_openssl_rand_-base64_32"
domain_name      = "ants.example.com"
hosted_zone_name = "example.com"
```

#### With an existing ACM certificate

```hcl
# terraform.tfvars
certificate_arn  = "arn:aws:acm:us-east-1:123456789012:certificate/abc-123"
domain_name      = "ants.example.com"
hosted_zone_name = "example.com"
```

#### With the web app UI

Ants includes an optional full web app UI (served at `/app`) that provides a richer interface than the default server UI at `/ui`. It is disabled by default and can be enabled with:

```hcl
# terraform.tfvars
ants_web_app = true
```

When enabled, the `ANTS_WEB_APP=true` environment variable is passed to the container. The web app requires authentication — unauthenticated visitors are redirected to the login page.

#### With a private ECR repository

Create a private ECR repo and deploy a custom image from it:

```hcl
# terraform.tfvars
enable_ecr          = true
ecr_repository_name = "ants/server"
image_tag           = "latest"
```

After `terraform apply`, push your image:

```bash
# Terraform outputs the exact commands, but the flow is:
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ecr-repo-url>
docker tag ants/server:latest <ecr-repo-url>:latest
docker push <ecr-repo-url>:latest

# Then force a new deployment to pick up the image
aws ecs update-service \
  --cluster ants-production-cluster \
  --service ants-production-service \
  --force-new-deployment
```

### Variables Reference

| Variable | Description | Default |
|---|---|---|
| `project_name` | Name prefix for all resources | `ants` |
| `environment` | Environment name | `production` |
| `aws_region` | AWS region | `us-east-1` |
| `image` | Docker image | `ants/server:latest` |
| `cpu` | Fargate CPU units (256 = 0.25 vCPU) | `256` |
| `memory` | Fargate memory in MiB | `512` |
| `desired_count` | Number of running tasks | `1` |
| `enable_nat_gateway` | Use NAT Gateway + private subnets for tasks | `false` |
| `enable_efs` | Enable EFS persistent volumes | `true` |
| `domain_name` | Custom domain (e.g. `ants.example.com`) | `""` |
| `hosted_zone_name` | Route 53 zone (e.g. `example.com`) | `""` |
| `certificate_arn` | Existing ACM certificate ARN | `""` |
| `ants_encryption_key` | **Required.** AES-256 key for encrypting stored secrets | *(none)* |
| `ants_secret` | Bearer token (single-user mode). Mutually exclusive with `ants_multi_user`. | `""` |
| `ants_multi_user` | Enable multi-user mode. Mutually exclusive with `ants_secret`. | `false` |
| `ants_setup_token` | One-time setup token. Required when `ants_multi_user = true`. | `""` |
| `ants_web_app` | Enable the full web app UI at `/app` | `false` |
| `enable_ecr` | Create a private ECR repository | `false` |
| `ecr_repository_name` | ECR repository name | `ants/server` |
| `image_tag` | Image tag when using ECR | `latest` |
| `ecr_scan_on_push` | Enable image scanning on push | `true` |
| `ecr_lifecycle_max_images` | Max untagged images to retain | `30` |
| `ants_env` | Extra env vars for the container | `{}` |

### Useful Commands

```bash
# View logs
aws logs tail /ecs/ants-production --follow

# Force a new deployment (e.g. to pull latest image)
aws ecs update-service \
  --cluster ants-production-cluster \
  --service ants-production-service \
  --force-new-deployment

# Tear down everything
terraform destroy
```

### Cost Estimate

With current settings (2 vCPU ARM64, 4 GB, NLB, no NAT Gateway, EFS):

| Resource | Approx. Monthly Cost |
|---|---|
| Fargate (ARM64) | ~$58 |
| NLB | ~$6 + data transfer |
| EFS | ~$0.30/GB stored |
| **Total (idle)** | **~$64/mo** |

By default, Fargate tasks run in public subnets with public IPs and no NAT Gateway. Set `enable_nat_gateway = true` to place tasks in private subnets behind a NAT Gateway (~$32/mo extra) for stricter network isolation.

## License

MIT
