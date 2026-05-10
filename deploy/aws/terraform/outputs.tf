# =============================================================================
# Outputs
# =============================================================================

output "nlb_dns_name" {
  description = "DNS name of the Network Load Balancer"
  value       = aws_lb.this.dns_name
}

output "app_url" {
  description = "URL to access the OpenMgr server"
  value = (
    var.domain_name != "" ? (
      local.enable_https ? "https://${var.domain_name}" : "http://${var.domain_name}"
    ) : "http://${aws_lb.this.dns_name}"
  )
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = aws_ecs_service.this.name
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for container logs"
  value       = aws_cloudwatch_log_group.this.name
}

output "efs_file_system_id" {
  description = "EFS file system ID (if enabled)"
  value       = var.enable_efs ? aws_efs_file_system.this[0].id : null
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.this.id
}

output "certificate_arn" {
  description = "ACM certificate ARN (if HTTPS is enabled)"
  value       = local.enable_https ? local.effective_certificate_arn : null
}

output "ecr_repository_url" {
  description = "ECR repository URL (if ECR is enabled). Push images with: docker push <url>:<tag>"
  value       = var.enable_ecr ? aws_ecr_repository.this[0].repository_url : null
}

output "ecr_push_commands" {
  description = "Commands to authenticate and push an image to ECR"
  value = var.enable_ecr ? join("\n", [
    "aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.this[0].repository_url}",
    "docker tag openmgr/server:latest ${aws_ecr_repository.this[0].repository_url}:${var.image_tag}",
    "docker push ${aws_ecr_repository.this[0].repository_url}:${var.image_tag}",
  ]) : null
}
