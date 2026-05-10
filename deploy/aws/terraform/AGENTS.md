# Agent Instructions for aws/terraform

## Overview

Terraform configuration that deploys the OpenMgr server on AWS ECS Fargate (ARM64/Graviton). Produces a VPC, NLB, ECS service, EFS volumes, and optionally ACM + Route 53 for HTTPS.

## File Layout

| File | Purpose |
|---|---|
| `providers.tf` | Terraform/AWS provider versions, optional S3 backend |
| `variables.tf` | All user-configurable inputs with defaults |
| `main.tf` | All resources (networking, security groups, EFS, NLB, ACM, DNS, ECS) |
| `outputs.tf` | Values printed after `terraform apply` |
| `terraform.tfvars.example` | Copy-and-edit template for users |

## Key Architecture Decisions

- **ARM64 only** — the `runtime_platform` block is hardcoded to `ARM64`. The Docker image must be built for `linux/arm64`. Do not change this to `X86_64` without also updating the Dockerfile build pipeline.
- **NLB (not ALB)** — a Network Load Balancer is used instead of an Application Load Balancer to reduce cost (~$6/mo vs ~$16/mo). NLB operates at layer 4 (TCP/TLS), which means no path-based routing, no HTTP->HTTPS redirect, and no security group on the LB itself. TLS termination uses ACM certificates on the NLB's TLS listener. WebSocket connections work natively since NLB just passes the TCP stream through. When HTTPS is enabled, only the TLS:443 listener is created (no HTTP:80 listener); when HTTPS is not enabled, only the TCP:80 listener is created.
- **NAT Gateway disabled by default** — tasks run in public subnets with `assign_public_ip = true` to save ~$32/mo. Set `enable_nat_gateway = true` to create a single NAT Gateway and run tasks in private subnets. For HA, you'd add one NAT Gateway per AZ.
- **EFS for persistence** — the container's `/data` (SQLite DB) and `/workspaces` directories are mounted from EFS via access points. Disabling EFS (`enable_efs = false`) means data is lost on task restart.
- **Optional ECR** — when `enable_ecr = true`, an ECR repository is created and the task definition uses `local.effective_image` (ECR URL + tag) instead of `var.image`. The `AmazonECSTaskExecutionRolePolicy` on the execution role already grants ECR pull permissions for same-account repos.

## HTTPS / Domain Conditional Logic

Three modes controlled by `locals` in `main.tf`:

| `domain_name` | `certificate_arn` | Behaviour |
|---|---|---|
| empty | empty | HTTP-only, NLB DNS as URL |
| set | empty | Auto-create ACM cert, DNS-validate via Route 53, HTTPS |
| set or empty | set | Use provided cert ARN, optionally create Route 53 alias |

The key locals are:
- `effective_certificate_arn` — resolves which cert to use
- `enable_https` — controls TLS listener on port 443
- `enable_dns` — controls Route 53 records (requires both `domain_name` and `hosted_zone_name`)

When modifying HTTPS behaviour, update the locals and let the conditionals propagate — do not add separate `var.certificate_arn != ""` checks in resources.

## ECR / Image Resolution

The `local.effective_image` resolves which Docker image the task definition uses:

| `enable_ecr` | Result |
|---|---|
| `false` | Uses `var.image` directly (e.g. `openmgr/server:latest` from Docker Hub) |
| `true` | Uses `aws_ecr_repository.this[0].repository_url:var.image_tag` |

When adding image-related logic, use `local.effective_image` — do not reference `var.image` directly in the task definition.

## Authentication Variables

Four auth-related variables map to OpenMgr server environment variables:

| Terraform variable | Env var | Required | Sensitive |
|---|---|---|---|
| `openmgr_encryption_key` | `OPENMGR_ENCRYPTION_KEY` | Yes | Yes |
| `openmgr_secret` | `OPENMGR_SECRET` | Mode 1 only | Yes |
| `openmgr_multi_user` | `OPENMGR_MULTI_USER` | Mode 2 only | No |
| `openmgr_setup_token` | `OPENMGR_SETUP_TOKEN` | Mode 2 only | Yes |

### Auth mode constraint (mutually exclusive)

Users must choose exactly one of two authentication modes:

1. **Bearer token mode** — set `openmgr_secret`, leave `openmgr_multi_user = false`
2. **Multi-user mode** — set `openmgr_multi_user = true` + `openmgr_setup_token`, leave `openmgr_secret` empty

Three `check` blocks in `main.tf` enforce this:
- `auth_mode_exclusive` — cannot set both `openmgr_secret` and `openmgr_multi_user`
- `auth_mode_required` — must set at least one
- `setup_token_when_multi_user` — `openmgr_setup_token` is required when `openmgr_multi_user = true`

### Notes

- `openmgr_encryption_key` is always required — the server exits without it.
- All sensitive variables are marked `sensitive = true` in Terraform so their values are redacted from plan output.

When adding new env vars that contain secrets, always mark the Terraform variable as `sensitive = true` and conditionally inject it (don't pass empty strings to the container).

## Validation

There are no automated tests. Validate changes with:

```bash
terraform fmt -check
terraform validate        # requires terraform init first
terraform plan            # requires AWS credentials + a terraform.tfvars
```

`terraform validate` will catch syntax errors and reference issues without needing real AWS resources.

## Common Pitfalls

- **NAT Gateway / subnet placement** — when `enable_nat_gateway = false` (the default), private subnets, the NAT Gateway, and associated route tables are not created. Fargate tasks run in public subnets with `assign_public_ip = true`. The `local.task_subnets` local resolves to the correct subnet IDs for both modes. EFS mount targets also use `local.task_subnets`. When adding resources that need to be in the same subnets as the Fargate tasks, use `local.task_subnets`.
- **`terraform.tfvars` is gitignored** — never reference it in code or docs as if it exists by default. Always point users to `terraform.tfvars.example`.
- **NLB name length** — AWS limits NLB names to 32 characters. The name is `${project_name}-${environment}-nlb`, so long project names will fail. Same limit applies to target group names.
- **NLB security model** — NLBs do not use security groups; traffic passes directly to targets with client source IPs preserved. The ECS security group must allow inbound on the container port from `0.0.0.0/0`. Do not attempt to restrict ingress to an LB security group — NLBs don't have one.
- **IAM policy ARN** — the execution role uses `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` (note the double colon — no account ID, it's an AWS-managed policy).
- **Health check path** — hardcoded to `/api/beta/health` (both in the NLB target group HTTP health check and the container health check). If the OpenMgr server changes this endpoint, both must be updated.
- **Container port** — defaults to `6647` matching the Dockerfile's `EXPOSE`. Changing `container_port` variable is fine but the Docker image must also listen on that port.
- **ECR repository deletion** — `force_delete` is `false` on the ECR repo, so `terraform destroy` will fail if the repo still contains images. Users must manually delete images first, or set `force_delete = true`.
- **`enable_https` must use input variables only** — `local.enable_https` is derived from `var.certificate_arn` and `var.domain_name` (not from resource attributes) because it's used in `count` expressions. Terraform requires counts to be known at plan time. Do not make it depend on resource outputs like `aws_acm_certificate.this[0].arn`.
- **Sensitive variables** — `openmgr_encryption_key`, `openmgr_secret`, and `openmgr_setup_token` are all `sensitive = true`. Terraform will redact them from CLI output but they are passed as plain-text environment variables in the task definition. For production, consider using AWS Secrets Manager with `secrets` instead of `environment` in the container definition.
