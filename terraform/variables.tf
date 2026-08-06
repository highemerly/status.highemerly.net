variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "domain_name" {
  description = "Domain name for the status page"
  type        = string
  default     = "status.highemerly.net"
}

variable "zone_id" {
  description = "Route53 hosted zone ID for highemerly.net"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (us-east-1)"
  type        = string
}

variable "prometheus_url" {
  description = "Prometheus URL"
  type        = string
}

variable "prometheus_username" {
  description = "Prometheus username"
  type        = string
  sensitive   = true
}

variable "prometheus_password" {
  description = "Prometheus password"
  type        = string
  sensitive   = true
}

variable "discord_public_key" {
  description = "Discord application public key"
  type        = string
  sensitive   = true
}

variable "s3_bucket_name" {
  description = "S3 bucket name for static files"
  type        = string
  default     = "status-highemerly-net"
}
