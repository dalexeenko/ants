#!/usr/bin/env bash
# =============================================================================
# Deploy OpenMgr server to AWS ECS
# =============================================================================
#
# Runs the full deployment pipeline:
#   1. Build the server Docker image (unless --no-build)
#   2. Terraform apply (infrastructure changes)
#   3. Push the Docker image to ECR
#   4. Force a new ECS deployment and wait for it to go live
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform installed
#   - Docker installed
#   - terraform.tfvars configured in aws/terraform/
#
# Usage:
#   ./dev/scripts/deploy-aws-ecs.sh [options]
#
# Options:
#   -t, --tag TAG              Image tag (default: openmgr/server:latest)
#   --no-build                 Skip building the Docker image (use existing local image)
#   --skip-terraform           Skip terraform apply step
#   --skip-push                Skip ECR push step (just refresh ECS)
#   --skip-ecs                 Skip ECS service refresh
#   --terraform-dir PATH       Path to terraform directory (default: aws/terraform)
#   -i, --interactive          Prompt for confirmation before terraform apply
#   -h, --help                 Show this help message
#
# Examples:
#   # Full deploy: build + terraform + push + refresh ECS
#   ./dev/scripts/deploy-aws-ecs.sh
#
#   # Deploy without rebuilding (use existing local image)
#   ./dev/scripts/deploy-aws-ecs.sh --no-build
#
#   # Skip infra changes, just build + push + refresh
#   ./dev/scripts/deploy-aws-ecs.sh --skip-terraform
#
#   # Just refresh ECS to re-pull the latest image
#   ./dev/scripts/deploy-aws-ecs.sh --no-build --skip-terraform --skip-push
#
#   # Deploy a specific image tag
#   ./dev/scripts/deploy-aws-ecs.sh --tag openmgr/server:v1.2.3
#
#   # Review terraform plan before applying
#   ./dev/scripts/deploy-aws-ecs.sh --interactive
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOCAL_IMAGE_TAG="openmgr/server:latest"
TERRAFORM_DIR="${REPO_ROOT}/aws/terraform"
SKIP_BUILD=false
SKIP_TERRAFORM=false
SKIP_PUSH=false
SKIP_ECS=false
INTERACTIVE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      LOCAL_IMAGE_TAG="$2"
      shift 2
      ;;
    --no-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-terraform)
      SKIP_TERRAFORM=true
      shift
      ;;
    --skip-push)
      SKIP_PUSH=true
      shift
      ;;
    --skip-ecs)
      SKIP_ECS=true
      shift
      ;;
    --terraform-dir)
      TERRAFORM_DIR="$2"
      shift 2
      ;;
    -i|--interactive)
      INTERACTIVE=true
      shift
      ;;
    -h|--help)
      sed -n '2,/^# =====/p' "$0" | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
for cmd in aws terraform docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed or not in PATH" >&2
    exit 1
  fi
done

if [[ ! -d "$TERRAFORM_DIR" ]]; then
  echo "Error: Terraform directory not found at $TERRAFORM_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Check AWS credentials
# ---------------------------------------------------------------------------
echo "==> Checking AWS credentials..."

STS_OUTPUT="$(aws sts get-caller-identity 2>&1)" || {
  echo ""
  echo "    No valid AWS credentials found."
  echo "    Reason: $STS_OUTPUT"
  echo ""
  echo "    Logging out and clearing credential caches..."
  echo ""

  aws logout 2>/dev/null || true
  rm -rf ~/.aws/sso/cache/* ~/.aws/cli/cache/* ~/.aws/login/cache/*
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_CREDENTIAL_EXPIRATION

  echo "    Running 'aws login'..."
  echo ""

  aws login
  LOGIN_EXIT=$?

  if [ $LOGIN_EXIT -ne 0 ]; then
    echo "" >&2
    echo "Error: 'aws login' exited with code $LOGIN_EXIT." >&2
  fi

  # Verify login succeeded
  STS_OUTPUT="$(aws sts get-caller-identity 2>&1)" || {
    echo "" >&2
    echo "Error: AWS login did not succeed. Cannot continue." >&2
    echo "    STS check failed with: $STS_OUTPUT" >&2
    echo "" >&2
    echo "    Troubleshooting tips:" >&2
    echo "      - Run 'aws sts get-caller-identity' manually to see the full error" >&2
    echo "      - Check that your SSO session/profile is configured correctly" >&2
    echo "      - Verify AWS_PROFILE is set if using named profiles (current: ${AWS_PROFILE:-<unset>})" >&2
    echo "      - Check ~/.aws/config and ~/.aws/credentials" >&2
    exit 1
  }
}

AWS_IDENTITY="$(aws sts get-caller-identity --query 'Arn' --output text)"
echo "    Authenticated as: $AWS_IDENTITY"

# Export credentials as env vars so Terraform and other tools can use them.
# The AWS CLI supports credential sources (like 'aws login') that Terraform's
# AWS provider doesn't understand. Exporting as env vars bridges the gap.
eval "$(aws configure export-credentials --format env 2>/dev/null)" || true

echo ""

# ---------------------------------------------------------------------------
# Step 1: Build Docker image
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == false ]]; then
  echo "==> Step 1/4: Building server image..."
  echo ""

  "$SCRIPT_DIR/build-server-image.sh" --tag "$LOCAL_IMAGE_TAG"

  echo ""
  echo "    Build complete."
else
  echo "==> Step 1/4: Skipping build (--no-build)"
fi

# ---------------------------------------------------------------------------
# Step 2: Terraform apply
# ---------------------------------------------------------------------------
if [[ "$SKIP_TERRAFORM" == false ]]; then
  echo "==> Step 2/4: Running terraform apply..."
  echo ""

  terraform -chdir="$TERRAFORM_DIR" init -input=false

  if [[ "$INTERACTIVE" == true ]]; then
    terraform -chdir="$TERRAFORM_DIR" apply
  else
    terraform -chdir="$TERRAFORM_DIR" apply -auto-approve
  fi

  echo ""
  echo "    Terraform apply complete."
else
  echo "==> Step 2/4: Skipping terraform apply (--skip-terraform)"
fi

# ---------------------------------------------------------------------------
# Read Terraform outputs (needed for push and ECS refresh)
# ---------------------------------------------------------------------------
if [[ "$SKIP_PUSH" == false || "$SKIP_ECS" == false ]]; then
  echo ""
  echo "==> Reading terraform outputs..."

  ECR_REPO_URL="$(terraform -chdir="$TERRAFORM_DIR" output -raw ecr_repository_url 2>/dev/null || true)"
  ECS_CLUSTER="$(terraform -chdir="$TERRAFORM_DIR" output -raw ecs_cluster_name 2>/dev/null || true)"
  ECS_SERVICE="$(terraform -chdir="$TERRAFORM_DIR" output -raw ecs_service_name 2>/dev/null || true)"
  AWS_REGION="$(terraform -chdir="$TERRAFORM_DIR" output -raw 2>/dev/null aws_region || \
    aws configure get region || \
    echo "us-east-1")"

  # Try to get region from the terraform variables if not an output
  if [[ -z "$AWS_REGION" || "$AWS_REGION" == "us-east-1" ]]; then
    # Parse region from terraform.tfvars if available
    TFVARS_REGION="$(grep -E '^aws_region\s*=' "$TERRAFORM_DIR/terraform.tfvars" 2>/dev/null | sed 's/.*=\s*"\(.*\)"/\1/' || true)"
    if [[ -n "$TFVARS_REGION" ]]; then
      AWS_REGION="$TFVARS_REGION"
    fi
  fi

  if [[ "$SKIP_PUSH" == false && -z "$ECR_REPO_URL" ]]; then
    echo "Error: Could not read ecr_repository_url from terraform outputs." >&2
    echo "Is ECR enabled (enable_ecr = true) in your terraform.tfvars?" >&2
    exit 1
  fi

  if [[ "$SKIP_ECS" == false && ( -z "$ECS_CLUSTER" || -z "$ECS_SERVICE" ) ]]; then
    echo "Error: Could not read ECS cluster/service names from terraform outputs." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: Push image to ECR
# ---------------------------------------------------------------------------
if [[ "$SKIP_PUSH" == false ]]; then
  echo ""
  echo "==> Step 3/4: Pushing image to ECR..."
  echo "    Local image:  $LOCAL_IMAGE_TAG"
  echo "    ECR repo:     $ECR_REPO_URL"
  echo "    Region:       $AWS_REGION"
  echo ""

  # Extract the image tag portion (after the colon) from the local tag
  IMAGE_TAG_SUFFIX="${LOCAL_IMAGE_TAG##*:}"
  ECR_FULL_TAG="${ECR_REPO_URL}:${IMAGE_TAG_SUFFIX}"

  # Authenticate Docker with ECR
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "${ECR_REPO_URL%%/*}"

  # Tag and push
  docker tag "$LOCAL_IMAGE_TAG" "$ECR_FULL_TAG"
  docker push "$ECR_FULL_TAG"

  echo ""
  echo "    Pushed: $ECR_FULL_TAG"
else
  echo "==> Step 3/4: Skipping ECR push (--skip-push)"
fi

# ---------------------------------------------------------------------------
# Step 3: Force new ECS deployment
# ---------------------------------------------------------------------------
if [[ "$SKIP_ECS" == false ]]; then
  echo ""
  echo "==> Step 4/4: Refreshing ECS service..."
  echo "    Cluster: $ECS_CLUSTER"
  echo "    Service: $ECS_SERVICE"
  echo "    Region:  $AWS_REGION"
  echo ""

  # Capture the deployment ID from the update-service response so we can
  # track this specific deployment rather than just checking overall stability.
  DEPLOYMENT_ID="$(aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --force-new-deployment \
    --query 'service.deployments[?status==`PRIMARY`] | [0].id' \
    --output text)"

  echo "    Deployment: $DEPLOYMENT_ID"
  echo ""
  echo "    Waiting for new deployment to complete..."
  echo ""

  # Poll until this specific deployment has rolloutState=COMPLETED (new task
  # running, old tasks drained) or we hit a failure/timeout.
  MAX_ATTEMPTS=40
  POLL_INTERVAL=15
  ATTEMPT=0

  while [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; do
    ROLLOUT_STATE="$(aws ecs describe-services \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --services "$ECS_SERVICE" \
      --query "services[0].deployments[?id=='${DEPLOYMENT_ID}'].rolloutState | [0]" \
      --output text 2>/dev/null || echo "UNKNOWN")"

    RUNNING="$(aws ecs describe-services \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --services "$ECS_SERVICE" \
      --query "services[0].deployments[?id=='${DEPLOYMENT_ID}'].runningCount | [0]" \
      --output text 2>/dev/null || echo "0")"

    DESIRED="$(aws ecs describe-services \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --services "$ECS_SERVICE" \
      --query "services[0].deployments[?id=='${DEPLOYMENT_ID}'].desiredCount | [0]" \
      --output text 2>/dev/null || echo "?")"

    echo "    [$((ATTEMPT + 1))/${MAX_ATTEMPTS}] rollout=$ROLLOUT_STATE running=$RUNNING/$DESIRED"

    if [[ "$ROLLOUT_STATE" == "COMPLETED" ]]; then
      echo ""
      echo "    New deployment is live."
      break
    fi

    if [[ "$ROLLOUT_STATE" == "FAILED" ]]; then
      echo ""
      echo "Error: Deployment $DEPLOYMENT_ID failed." >&2
      echo "Check logs: aws logs tail /ecs/openmgr-production --region $AWS_REGION --since 10m" >&2
      exit 1
    fi

    ATTEMPT=$((ATTEMPT + 1))
    sleep "$POLL_INTERVAL"
  done

  if [[ $ATTEMPT -ge $MAX_ATTEMPTS ]]; then
    echo ""
    echo "Warning: Timed out after $((MAX_ATTEMPTS * POLL_INTERVAL))s waiting for deployment." >&2
    echo "The deployment may still be in progress. Check status with:" >&2
    echo "  aws ecs describe-services --region $AWS_REGION --cluster $ECS_CLUSTER --services $ECS_SERVICE --query 'services[0].deployments'" >&2
  fi
else
  echo "==> Step 4/4: Skipping ECS refresh (--skip-ecs)"
fi

echo ""
echo "Deploy complete."
