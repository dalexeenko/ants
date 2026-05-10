# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "openmgr"
}

variable "environment" {
  description = "Environment name (e.g. production, staging)"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (need at least 2 for the load balancer)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "enable_nat_gateway" {
  description = "Create a NAT Gateway for private subnet internet access. When false (default), Fargate tasks run in public subnets with public IPs instead, saving ~$32/mo. Set to true for production workloads that should not have public IPs."
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Container
# -----------------------------------------------------------------------------

variable "image" {
  description = "Docker image to deploy. Ignored when enable_ecr is true (ECR repo URL is used instead)."
  type        = string
  default     = "openmgr/server:latest"
}

variable "image_tag" {
  description = "Image tag to deploy when using ECR"
  type        = string
  default     = "latest"
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 6647
}

variable "cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of running tasks"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# Storage (EFS for persistent data)
# -----------------------------------------------------------------------------

variable "enable_efs" {
  description = "Enable EFS for persistent /data and /workspaces volumes"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Container Registry (optional ECR)
# -----------------------------------------------------------------------------

variable "enable_ecr" {
  description = "Create a private ECR repository. When true, the ECS task uses the ECR image instead of var.image."
  type        = bool
  default     = false
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository (only used when enable_ecr is true)"
  type        = string
  default     = "openmgr/server"
}

variable "ecr_image_tag_mutability" {
  description = "Tag mutability setting for the ECR repository (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "MUTABLE"
}

variable "ecr_scan_on_push" {
  description = "Enable image scanning on push to ECR"
  type        = bool
  default     = true
}

variable "ecr_lifecycle_max_images" {
  description = "Maximum number of untagged images to retain in ECR (0 to disable lifecycle policy)"
  type        = number
  default     = 30
}

# -----------------------------------------------------------------------------
# Domain & HTTPS (recommended — without this, traffic is unencrypted)
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Custom domain name for the server (e.g. openmgr.example.com). Requires hosted_zone_name. Without a domain, the server is HTTP-only and all traffic (including API keys) is sent unencrypted."
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = "Route 53 hosted zone name (e.g. example.com). Must already exist in the account."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ARN of an existing ACM certificate. If empty but domain_name is set, a certificate is created and DNS-validated automatically."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Authentication
#
# You must choose ONE of two authentication modes:
#
#   1. Bearer token mode (single-user):
#      Set openmgr_secret to a bearer token. Do NOT set openmgr_multi_user.
#
#   2. Multi-user mode:
#      Set openmgr_multi_user = true and openmgr_setup_token. Do NOT set
#      openmgr_secret.
#
# You cannot set both openmgr_secret and openmgr_multi_user, and you must
# set at least one.
# -----------------------------------------------------------------------------

variable "openmgr_secret" {
  description = "Bearer token secret for API authentication (single-user mode). Mutually exclusive with openmgr_multi_user."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openmgr_encryption_key" {
  description = "AES-256 encryption key for encrypting stored provider API keys and secrets. Must be exactly 32 bytes encoded as base64. Generate with: openssl rand -base64 32. Required — the server will not start without it."
  type        = string
  sensitive   = true
}

variable "openmgr_multi_user" {
  description = "Enable multi-user mode with RBAC. Mutually exclusive with openmgr_secret. When enabled, set openmgr_setup_token to secure initial admin creation."
  type        = bool
  default     = false
}

variable "openmgr_setup_token" {
  description = "One-time token required to create the initial admin account via POST /setup. Required when openmgr_multi_user is true. Generate with: openssl rand -base64 32"
  type        = string
  default     = ""
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Web App UI
# -----------------------------------------------------------------------------

variable "openmgr_web_app" {
  description = "Enable the full web app UI at /app. When true, the OPENMGR_WEB_APP=true environment variable is passed to the container."
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

variable "openmgr_sqlite_journal_mode" {
  description = "SQLite journal mode. Use 'delete' when running on network filesystems (EFS) to avoid WAL/mmap corruption. Defaults to 'delete' because the standard Terraform deployment uses EFS."
  type        = string
  default     = "delete"
}

# -----------------------------------------------------------------------------
# Environment variables passed to the container
# -----------------------------------------------------------------------------

variable "openmgr_env" {
  description = "Additional environment variables for the OpenMgr container (key-value map)"
  type        = map(string)
  default     = {}
}
