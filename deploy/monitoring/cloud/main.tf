provider "grafana" {
  url = var.grafana_url
  # GRAFANA_AUTH, GRAFANA_SM_URL and GRAFANA_SM_ACCESS_TOKEN are supplied
  # externally. Never put authentication in .tfvars or the command line.
}

resource "grafana_folder" "monitoring" {
  uid   = "acttub-monitoring"
  title = "Acttub 운영 모니터링"
  lifecycle { prevent_destroy = true }
}

resource "grafana_data_source" "local" {
  uid                                    = "acttub-local-prometheus"
  name                                   = "Acttub Local Prometheus (PDC)"
  type                                   = "prometheus"
  access_mode                            = "proxy"
  url                                    = "http://prometheus:9090"
  is_default                             = false
  private_data_source_connect_network_id = var.pdc_network_id
  json_data_encoded = jsonencode({
    httpMethod        = "POST"
    timeInterval      = "30s"
    queryTimeout      = "10s"
    prometheusType    = "Prometheus"
    prometheusVersion = "3.14.0"
  })
  lifecycle { prevent_destroy = true }
}

resource "grafana_contact_point" "slack" {
  name = "acttub-monitoring-slack"
  slack {
    url                     = var.slack_webhook_url
    recipient               = "#서비스-장애"
    disable_resolve_message = false
    title                   = "[{{ .Status | toUpper }}] Acttub {{ .CommonLabels.environment }} / {{ .CommonLabels.site }}"
    text                    = file("${path.module}/slack.tmpl")
  }
  lifecycle { prevent_destroy = true }
}

locals {
  environments = keys(var.health_origins)
  # Keep the existing prod landing page when both environments are selected.
  default_environment = contains(local.environments, "prod") ? "prod" : "dev"
  definitions         = jsondecode(file("${path.module}/rules.json"))
  rules = flatten([for definition in local.definitions : [
    for environment in(definition.scope == "environment" ? local.environments : ["shared"]) : merge(definition, {
      uid         = "acttub-${definition.key}-${environment}"
      environment = environment
      expr        = replace(replace(definition.expr, "$env", environment), "$disk", var.disk_mountpoint)
    })
  ]])
}

resource "grafana_rule_group" "monitoring" {
  name             = "acttub-monitoring"
  folder_uid       = grafana_folder.monitoring.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.rules
    content {
      uid            = rule.value.uid
      name           = "${rule.value.title} (${rule.value.environment})"
      condition      = "B"
      for            = rule.value.for
      no_data_state  = rule.value.key == "datasource" || rule.value.key == "cloud-datasource" ? "Alerting" : "KeepLast"
      exec_err_state = rule.value.key == "datasource" || rule.value.key == "cloud-datasource" ? "Alerting" : "KeepLast"
      labels = {
        owner       = "acttub-monitoring"
        environment = rule.value.environment
        site        = var.site
        datasource  = rule.value.datasource == "cloud" ? var.synthetic_datasource_uid : grafana_data_source.local.uid
        target      = rule.value.target
        severity    = rule.value.severity
      }
      annotations = {
        summary          = rule.value.title
        condition        = rule.value.condition
        observed_value   = "{{ $values.A.Value }}"
        description      = "${rule.value.condition}; 관측값={{ $values.A.Value }}. ${rule.value.recovery}"
        recovery_meaning = rule.value.recovery
        dashboard_url    = "${var.grafana_url}/d/acttub-${rule.value.dashboard}?var-environment=${rule.value.environment == "shared" ? local.default_environment : rule.value.environment}&from=now-1h&to=now&timezone=Asia%2FSeoul"
        runbook_url      = "${var.runbook_url}#${rule.value.dashboard}"
      }
      data {
        ref_id         = "A"
        datasource_uid = rule.value.datasource == "cloud" ? var.synthetic_datasource_uid : grafana_data_source.local.uid
        relative_time_range {
          from = 600
          to   = 0
        }
        model = jsonencode({
          refId         = "A"
          expr          = rule.value.expr
          instant       = true
          range         = false
          intervalMs    = 30000
          maxDataPoints = 1000
        })
      }
      data {
        ref_id         = "B"
        datasource_uid = "__expr__"
        relative_time_range {
          from = 0
          to   = 0
        }
        model = jsonencode({ refId = "B", type = "math", expression = "$A ${rule.value.op} ${rule.value.threshold}" })
      }
      # Direct rule routing avoids provisioning the organization-wide policy tree.
      notification_settings {
        contact_point   = grafana_contact_point.slack.name
        group_by        = ["grafana_folder", "alertname", "environment", "site", "datasource"]
        group_wait      = "10s"
        group_interval  = "1m"
        repeat_interval = "1h"
      }
    }
  }
  lifecycle { prevent_destroy = true }
}
