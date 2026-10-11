data "aws_caller_identity" "current" {}

locals {
  api_fqdn      = "api.${var.domain_name}"
  realtime_fqdn = "realtime.${var.domain_name}"
}

resource "aws_route53_zone" "edge" {
  count = var.enable_public_edge ? 1 : 0
  name  = var.domain_name
}

resource "aws_route53_zone" "parent" {
  count = var.enable_public_edge && var.parent_domain_name != "" ? 1 : 0
  name  = var.parent_domain_name
}

resource "aws_route53_record" "parent_staging_delegation" {
  count   = var.enable_public_edge && var.parent_domain_name != "" ? 1 : 0
  zone_id = aws_route53_zone.parent[0].zone_id
  name    = replace(var.domain_name, ".${var.parent_domain_name}", "")
  type    = "NS"
  ttl     = 300
  records = aws_route53_zone.edge[0].name_servers
}

resource "aws_acm_certificate" "edge" {
  count                     = var.enable_public_edge ? 1 : 0
  domain_name               = local.api_fqdn
  subject_alternative_names = [local.realtime_fqdn]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.enable_public_edge ? {
    for option in aws_acm_certificate.edge[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}
  zone_id         = aws_route53_zone.edge[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_lb_target_group" "api" {
  count       = var.enable_public_edge ? 1 : 0
  name        = "${var.name}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_target_group" "realtime" {
  count       = var.enable_public_edge ? 1 : 0
  name        = "${var.name}-rt"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_listener" "http" {
  count             = var.enable_public_edge && !var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.enable_public_edge && var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener_rule" "http_api" {
  count        = var.enable_public_edge && !var.enable_https_listener ? 1 : 0
  listener_arn = aws_lb_listener.http[0].arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
  condition {
    host_header { values = [local.api_fqdn] }
  }
  depends_on = [aws_lb_listener.http]
}

resource "aws_lb_listener_rule" "http_realtime" {
  count        = var.enable_public_edge && !var.enable_https_listener ? 1 : 0
  listener_arn = aws_lb_listener.http[0].arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.realtime[0].arn
  }
  condition {
    host_header { values = [local.realtime_fqdn] }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.enable_public_edge && var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.edge[0].arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  count        = var.enable_public_edge && var.enable_https_listener ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
  condition {
    host_header { values = [local.api_fqdn] }
  }
}

resource "aws_lb_listener_rule" "realtime" {
  count        = var.enable_public_edge && var.enable_https_listener ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.realtime[0].arn
  }
  condition {
    host_header { values = [local.realtime_fqdn] }
  }
}

resource "aws_route53_record" "api" {
  count   = var.enable_public_edge ? 1 : 0
  zone_id = aws_route53_zone.edge[0].zone_id
  name    = local.api_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "realtime" {
  count   = var.enable_public_edge ? 1 : 0
  zone_id = aws_route53_zone.edge[0].zone_id
  name    = local.realtime_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_ecr_repository" "api" {
  count                = var.enable_public_edge ? 1 : 0
  name                 = "${var.name}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "realtime" {
  count                = var.enable_public_edge ? 1 : 0
  name                 = "${var.name}-realtime"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_cloudwatch_log_group" "ecs" {
  count             = var.enable_public_edge ? 1 : 0
  name              = "/ecs/${var.name}"
  retention_in_days = 14
}

resource "aws_secretsmanager_secret" "runtime" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}/runtime"
}

resource "aws_iam_role" "ecs_execution" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  count      = var.enable_public_edge ? 1 : 0
  role       = aws_iam_role.ecs_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-ecs-execution-secrets"
  role  = aws_iam_role.ecs_execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.runtime[0].arn]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-ecs-task"
  role  = aws_iam_role.ecs_task[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["rds-db:connect"]
        Resource = ["arn:aws:rds-db:${var.region}:${data.aws_caller_identity.current.account_id}:dbuser:*/postgres"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
        Resource = [aws_sqs_queue.work.arn, aws_sqs_queue.dlq.arn]
      },
    ]
  })
}

resource "aws_security_group" "ecs" {
  count  = var.enable_public_edge ? 1 : 0
  name   = "${var.name}-ecs"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 3000
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

locals {
  api_image = var.enable_public_edge ? "${aws_ecr_repository.api[0].repository_url}:latest" : ""
  rt_image  = var.enable_public_edge ? "${aws_ecr_repository.realtime[0].repository_url}:latest" : ""
}

resource "aws_ecs_task_definition" "api" {
  count                    = var.enable_public_edge ? 1 : 0
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn
  task_role_arn            = aws_iam_role.ecs_task[0].arn
  container_definitions = jsonencode([{
    name         = "api"
    image        = local.api_image
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "API_HOST", value = "0.0.0.0" },
      { name = "API_PORT", value = "3000" },
      { name = "AWS_REGION", value = var.region },
    ]
    secrets = [{ name = "RUNTIME_SECRET_JSON", valueFrom = aws_secretsmanager_secret.runtime[0].arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.ecs[0].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "realtime" {
  count                    = var.enable_public_edge ? 1 : 0
  family                   = "${var.name}-realtime"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn
  task_role_arn            = aws_iam_role.ecs_task[0].arn
  container_definitions = jsonencode([{
    name         = "realtime"
    image        = local.rt_image
    essential    = true
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "API_HOST", value = "0.0.0.0" },
      { name = "REALTIME_PORT", value = "3001" },
      { name = "AWS_REGION", value = var.region },
    ]
    secrets = [{ name = "RUNTIME_SECRET_JSON", valueFrom = aws_secretsmanager_secret.runtime[0].arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.ecs[0].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "realtime"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  count           = var.enable_public_edge ? 1 : 0
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api[0].arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs[0].id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api[0].arn
    container_name   = "api"
    container_port   = 3000
  }
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "realtime" {
  count           = var.enable_public_edge ? 1 : 0
  name            = "${var.name}-realtime"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.realtime[0].arn
  desired_count   = var.realtime_desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs[0].id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.realtime[0].arn
    container_name   = "realtime"
    container_port   = 3001
  }
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_iam_role" "codebuild" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-codebuild"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "codebuild" {
  count = var.enable_public_edge ? 1 : 0
  name  = "${var.name}-codebuild"
  role  = aws_iam_role.codebuild[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.media.arn}/codebuild/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:UpdateService"]
        Resource = ["*"]
      },
    ]
  })
}

resource "aws_codebuild_project" "staging_images" {
  count        = var.enable_public_edge ? 1 : 0
  name         = "${var.name}-images"
  service_role = aws_iam_role.codebuild[0].arn
  artifacts { type = "NO_ARTIFACTS" }
  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = true
    image_pull_credentials_type = "CODEBUILD"
    environment_variable {
      name  = "AWS_REGION"
      value = var.region
    }
    environment_variable {
      name  = "ECR_REGISTRY"
      value = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
    }
    environment_variable {
      name  = "ECR_API_REPO"
      value = aws_ecr_repository.api[0].repository_url
    }
    environment_variable {
      name  = "ECR_REALTIME_REPO"
      value = aws_ecr_repository.realtime[0].repository_url
    }
  }
  source {
    type      = "S3"
    location  = "${aws_s3_bucket.media.bucket}/codebuild/source.tgz"
    buildspec = "infra/codebuild/buildspec.staging-images.yml"
  }
}

output "codebuild_project_name" {
  value = var.enable_public_edge ? aws_codebuild_project.staging_images[0].name : null
}

output "route53_name_servers" {
  value = var.enable_public_edge ? aws_route53_zone.edge[0].name_servers : []
}

output "parent_route53_name_servers" {
  value = var.enable_public_edge && var.parent_domain_name != "" ? aws_route53_zone.parent[0].name_servers : []
}

output "runtime_secret_arn" {
  value = var.enable_public_edge ? aws_secretsmanager_secret.runtime[0].arn : null
}

output "ecr_api_repository_url" {
  value = var.enable_public_edge ? aws_ecr_repository.api[0].repository_url : null
}

output "ecr_realtime_repository_url" {
  value = var.enable_public_edge ? aws_ecr_repository.realtime[0].repository_url : null
}
