locals {
  # HTTP Basic checks use RE2, not JSONPath. Validate the complete existing
  # HealthResponse / @JsonPropertyOrder contract to reject nested status, HTML,
  # duplicate keys and malformed JSON without switching to paid scripted checks.
  json_string         = "\"([^\"\\\\\\x00-\\x1f]|\\\\([\"\\\\/bfnrt]|u[0-9a-fA-F]{4}))*\""
  health_body_pattern = "^\\s*\\{\\s*\"status\"\\s*:\\s*\"ok\"\\s*,\\s*\"services\"\\s*:\\s*\\[\\s*(${local.json_string}(\\s*,\\s*${local.json_string})*)?\\s*\\]\\s*,\\s*\"model\"\\s*:\\s*${local.json_string}\\s*,\\s*\"keep_alive\"\\s*:\\s*(true|false)\\s*,\\s*\"commit\"\\s*:\\s*${local.json_string}\\s*\\}\\s*$"
}

resource "grafana_synthetic_monitoring_check" "health" {
  for_each           = var.health_origins
  job                = "acttub-health-${each.key}"
  target             = "${each.value}/health"
  probes             = [var.probe_id]
  frequency          = 60000
  timeout            = 10000
  enabled            = true
  basic_metrics_only = true
  alert_sensitivity  = "none"
  labels = {
    environment = each.key
    site        = var.site
    owner       = "acttub-monitoring"
  }
  settings {
    http {
      method                          = "GET"
      valid_status_codes              = [200]
      fail_if_not_ssl                 = true
      no_follow_redirects             = true
      fail_if_body_not_matches_regexp = [local.health_body_pattern]
    }
  }
  lifecycle { prevent_destroy = true }
}

output "external_checks_31_day_budget" {
  value = {
    planned   = length(local.environments) * 60 * 24 * 31
    allowance = 100000
    headroom  = 100000 - length(local.environments) * 60 * 24 * 31
  }
}
