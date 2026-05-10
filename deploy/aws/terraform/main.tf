# =============================================================================
# OpenMgr Server — AWS Fargate (ARM64) Deployment
# =============================================================================
#
# Architecture:
#   NLB (public subnets) -> ECS Fargate ARM64 -> EFS (data)
#   Tasks run in public subnets by default; enable_nat_gateway = true for private
#
# Cost optimisation:
#   - ARM64 (Graviton) Fargate tasks are ~20% cheaper than x86
#   - Smallest Fargate size (0.25 vCPU / 512 MiB) by default
#   - NAT Gateway disabled by default; tasks run in public subnets
#     Set enable_nat_gateway = true for private-subnet deployment
# =============================================================================

locals {
  name = "${var.project_name}-${var.environment}"

  # Resolve which certificate ARN to use:
  #  1. Explicit certificate_arn variable (user-provided)
  #  2. Auto-created ACM certificate (when domain_name is set but certificate_arn is not)
  #  3. Empty string (HTTP-only mode)
  effective_certificate_arn = (
    var.certificate_arn != "" ? var.certificate_arn :
    var.domain_name != "" ? aws_acm_certificate.this[0].arn :
    ""
  )

  # These use only input variables so they are known at plan time (safe for count/for_each)
  enable_https = var.certificate_arn != "" || var.domain_name != ""
  enable_dns   = var.domain_name != "" && var.hosted_zone_name != ""

  # Subnets where Fargate tasks run: private (with NAT) or public (without)
  task_subnets = var.enable_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id

  # Resolve which image to use: ECR repo URL or the user-provided image string
  effective_image = (
    var.enable_ecr
    ? "${aws_ecr_repository.this[0].repository_url}:${var.image_tag}"
    : var.image
  )

  # Auth mode flags (used for validation)
  is_bearer_token_mode = var.openmgr_secret != ""
  is_multi_user_mode   = var.openmgr_multi_user
}

# =============================================================================
# Input validation
# =============================================================================

check "auth_mode_exclusive" {
  assert {
    condition     = !(local.is_bearer_token_mode && local.is_multi_user_mode)
    error_message = "Cannot set both openmgr_secret and openmgr_multi_user. Choose bearer token mode (set openmgr_secret) OR multi-user mode (set openmgr_multi_user + openmgr_setup_token)."
  }
}

check "auth_mode_required" {
  assert {
    condition     = local.is_bearer_token_mode || local.is_multi_user_mode
    error_message = "You must configure an authentication mode. Set either openmgr_secret (bearer token mode) or openmgr_multi_user = true (multi-user mode)."
  }
}

check "setup_token_when_multi_user" {
  assert {
    condition     = !local.is_multi_user_mode || var.openmgr_setup_token != ""
    error_message = "openmgr_setup_token is required when openmgr_multi_user is true. Generate one with: openssl rand -base64 32"
  }
}

# -----------------------------------------------------------------------------
# Data sources
# -----------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

# =============================================================================
# Networking
# =============================================================================

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }
}

# --- Public subnets (NLB, and Fargate tasks when NAT Gateway is disabled) ----

resource "aws_subnet" "public" {
  count                   = length(var.public_subnet_cidrs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- Private subnets (Fargate tasks when NAT Gateway is enabled) -------------

resource "aws_subnet" "private" {
  count             = var.enable_nat_gateway ? length(var.private_subnet_cidrs) : 0
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${local.name}-private-${count.index}" }
}

# Single NAT Gateway (opt-in — use one per AZ for HA in production)
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = { Name = "${local.name}-nat" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  count  = var.enable_nat_gateway ? 1 : 0
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-private-rt" }
}

resource "aws_route" "private_nat" {
  count                  = var.enable_nat_gateway ? 1 : 0
  route_table_id         = aws_route_table.private[0].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private" {
  count          = var.enable_nat_gateway ? length(aws_subnet.private) : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# =============================================================================
# Security Groups
# =============================================================================

# --- ECS tasks security group ------------------------------------------------
# NLB does not use security groups — traffic passes directly to targets with
# the client's source IP preserved. The ECS SG must allow inbound on the
# container port from all sources.

resource "aws_security_group" "ecs" {
  name_prefix = "${local.name}-ecs-"
  vpc_id      = aws_vpc.this.id
  description = "Allow traffic to ECS tasks"

  ingress {
    description = "Container port (from NLB / health checks)"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle { create_before_destroy = true }

  tags = { Name = "${local.name}-ecs-sg" }
}

# --- EFS security group ------------------------------------------------------

resource "aws_security_group" "efs" {
  count       = var.enable_efs ? 1 : 0
  name_prefix = "${local.name}-efs-"
  vpc_id      = aws_vpc.this.id
  description = "Allow NFS from ECS tasks"

  ingress {
    description     = "NFS from ECS"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle { create_before_destroy = true }

  tags = { Name = "${local.name}-efs-sg" }
}

# =============================================================================
# EFS (persistent storage for /data and /workspaces)
# =============================================================================

resource "aws_efs_file_system" "this" {
  count          = var.enable_efs ? 1 : 0
  encrypted      = true
  creation_token = "${local.name}-efs"

  tags = { Name = "${local.name}-efs" }
}

resource "aws_efs_mount_target" "this" {
  count           = var.enable_efs ? length(local.task_subnets) : 0
  file_system_id  = aws_efs_file_system.this[0].id
  subnet_id       = local.task_subnets[count.index]
  security_groups = [aws_security_group.efs[0].id]
}

# Access point for /data
resource "aws_efs_access_point" "data" {
  count          = var.enable_efs ? 1 : 0
  file_system_id = aws_efs_file_system.this[0].id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/openmgr-data"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${local.name}-data-ap" }
}

# Access point for /workspaces
resource "aws_efs_access_point" "workspaces" {
  count          = var.enable_efs ? 1 : 0
  file_system_id = aws_efs_file_system.this[0].id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/openmgr-workspaces"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${local.name}-workspaces-ap" }
}

# =============================================================================
# ECR (optional private container registry)
# =============================================================================

resource "aws_ecr_repository" "this" {
  count                = var.enable_ecr ? 1 : 0
  name                 = var.ecr_repository_name
  image_tag_mutability = var.ecr_image_tag_mutability
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = var.ecr_scan_on_push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.name}-ecr" }
}

resource "aws_ecr_lifecycle_policy" "this" {
  count      = var.enable_ecr && var.ecr_lifecycle_max_images > 0 ? 1 : 0
  repository = aws_ecr_repository.this[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the last ${var.ecr_lifecycle_max_images} untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_lifecycle_max_images
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# =============================================================================
# NLB (Network Load Balancer)
# =============================================================================

resource "aws_lb" "this" {
  name               = "${local.name}-nlb"
  internal           = false
  load_balancer_type = "network"
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${local.name}-nlb" }
}

resource "aws_lb_target_group" "this" {
  name        = "${local.name}-tg"
  port        = var.container_port
  protocol    = "TCP"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"

  health_check {
    protocol            = "HTTP"
    path                = "/api/beta/health"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
  }

  tags = { Name = "${local.name}-tg" }
}

# TCP listener on port 80 (HTTP-only mode, or always-on for plain access)
resource "aws_lb_listener" "http" {
  count             = local.enable_https ? 0 : 1
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# TLS listener on port 443 (when HTTPS is configured — NLB terminates TLS)
resource "aws_lb_listener" "https" {
  count             = local.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.effective_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  # Wait for certificate validation if we're auto-creating the cert
  depends_on = [aws_acm_certificate_validation.this]
}

# =============================================================================
# ACM Certificate (auto-created when domain_name is set, no certificate_arn)
# =============================================================================

resource "aws_acm_certificate" "this" {
  count             = var.domain_name != "" && var.certificate_arn == "" ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name}-cert" }
}

# DNS validation records for the ACM certificate
resource "aws_route53_record" "cert_validation" {
  for_each = var.domain_name != "" && var.certificate_arn == "" && local.enable_dns ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = var.domain_name != "" && var.certificate_arn == "" && local.enable_dns ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# =============================================================================
# Route 53 — DNS alias for the NLB
# =============================================================================

data "aws_route53_zone" "this" {
  count = local.enable_dns ? 1 : 0
  name  = var.hosted_zone_name
}

resource "aws_route53_record" "app" {
  count   = local.enable_dns ? 1 : 0
  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# =============================================================================
# ECS Cluster + Fargate Service
# =============================================================================

resource "aws_ecs_cluster" "this" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # Enable if you want CloudWatch Container Insights (adds cost)
  }

  tags = { Name = "${local.name}-cluster" }
}

# --- IAM ---------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Task execution role (pulling images, writing logs)
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = { Name = "${local.name}-execution" }
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role (what the running container can do — kept minimal)
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = { Name = "${local.name}-task" }
}

# --- CloudWatch Logs ---------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
  tags              = { Name = "${local.name}-logs" }
}

# --- Task Definition ---------------------------------------------------------

resource "aws_ecs_task_definition" "this" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # ARM64 (Graviton) for lower cost
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "openmgr"
      image     = local.effective_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = concat(
        [
          { name = "OPENMGR_HOST", value = "0.0.0.0" },
          { name = "OPENMGR_PORT", value = tostring(var.container_port) },
          { name = "OPENMGR_DATA_DIR", value = "/data" },
          { name = "OPENMGR_WORKSPACES_DIR", value = "/workspaces" },
          { name = "OPENMGR_ENCRYPTION_KEY", value = var.openmgr_encryption_key },
        ],
        var.openmgr_secret != "" ? [{ name = "OPENMGR_SECRET", value = var.openmgr_secret }] : [],
        var.openmgr_multi_user ? [{ name = "OPENMGR_MULTI_USER", value = "true" }] : [],
        var.openmgr_setup_token != "" ? [{ name = "OPENMGR_SETUP_TOKEN", value = var.openmgr_setup_token }] : [],
        var.openmgr_web_app ? [{ name = "OPENMGR_WEB_APP", value = "true" }] : [],
        [{ name = "OPENMGR_ALLOWED_HOSTS", value = var.domain_name != "" ? var.domain_name : "*" }],
        var.openmgr_sqlite_journal_mode != "wal" ? [{ name = "OPENMGR_SQLITE_JOURNAL_MODE", value = var.openmgr_sqlite_journal_mode }] : [],
        [for k, v in var.openmgr_env : { name = k, value = v }]
      )

      mountPoints = var.enable_efs ? [
        {
          sourceVolume  = "data"
          containerPath = "/data"
          readOnly      = false
        },
        {
          sourceVolume  = "workspaces"
          containerPath = "/workspaces"
          readOnly      = false
        }
      ] : []

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}/api/beta/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  dynamic "volume" {
    for_each = var.enable_efs ? [1] : []
    content {
      name = "data"
      efs_volume_configuration {
        file_system_id     = aws_efs_file_system.this[0].id
        transit_encryption = "ENABLED"
        authorization_config {
          access_point_id = aws_efs_access_point.data[0].id
          iam             = "DISABLED"
        }
      }
    }
  }

  dynamic "volume" {
    for_each = var.enable_efs ? [1] : []
    content {
      name = "workspaces"
      efs_volume_configuration {
        file_system_id     = aws_efs_file_system.this[0].id
        transit_encryption = "ENABLED"
        authorization_config {
          access_point_id = aws_efs_access_point.workspaces[0].id
          iam             = "DISABLED"
        }
      }
    }
  }

  tags = { Name = "${local.name}-task" }
}

# --- ECS Service -------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name            = "${local.name}-service"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Stop-then-start: old task stops before the new one starts.
  # Required because SQLite on EFS cannot safely handle two writers —
  # concurrent access causes SQLITE_BUSY / SQLITE_CORRUPT errors.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  # Give the new task time to start and pass NLB health checks before ECS
  # considers the deployment failed. The NLB needs healthy_threshold (2)
  # consecutive checks at 30s intervals = 60s, plus container startup time.
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets          = local.task_subnets
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "openmgr"
    container_port   = var.container_port
  }

  depends_on = [
    aws_lb_listener.http,
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.execution,
  ]

  lifecycle {
    ignore_changes = [desired_count] # Allow autoscaling to manage this
  }

  tags = { Name = "${local.name}-service" }
}
