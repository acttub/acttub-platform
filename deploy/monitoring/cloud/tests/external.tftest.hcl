mock_provider "grafana" {}

run "three_operational_dashboards_use_korean_time_and_freshness" {
  command = plan
  assert {
    condition     = length(grafana_dashboard.monitoring) == 3 && alltrue([for d in grafana_dashboard.monitoring : jsondecode(d.config_json).timezone == "Asia/Seoul" && jsondecode(d.config_json).time.from == "now-1h" && length(jsondecode(d.config_json).panels) >= 10 && jsondecode(d.config_json).templating.list[0].name == "environment"])
    error_message = "All three dashboards need KST, last hour, environment selection and operational panels."
  }
}

variables {
  health_origins           = { dev = "https://dev.example.test", prod = "https://prod.example.test" }
  probe_id                 = 1
  pdc_network_id           = "test-pdc"
  synthetic_datasource_uid = "test-cloud-metrics"
  slack_webhook_url        = "https://hooks.slack.com/services/test/fixture/not-a-secret"
  grafana_url              = "https://example.grafana.net"
}

run "private_datasource_and_owned_notifications_preserve_other_configuration" {
  command = plan
  assert {
    condition     = grafana_data_source.local.private_data_source_connect_network_id == "test-pdc" && !grafana_data_source.local.is_default && grafana_data_source.local.url == "http://prometheus:9090"
    error_message = "Local metrics must be queried through PDC without changing the default datasource."
  }
  assert {
    condition     = alltrue([for r in grafana_rule_group.monitoring.rule : r.notification_settings[0].repeat_interval == "1h" && r.notification_settings[0].group_wait == "10s" && r.notification_settings[0].group_interval == "1m" && contains(r.notification_settings[0].group_by, "environment") && contains(r.notification_settings[0].group_by, "site") && contains(r.notification_settings[0].group_by, "datasource")])
    error_message = "Each owned rule must route first/hourly/recovery notifications with environment/site/datasource grouping."
  }
  assert {
    condition = alltrue([for r in grafana_rule_group.monitoring.rule : (
      startswith(r.uid, "acttub-datasource-") || startswith(r.uid, "acttub-cloud-datasource-")
    ) ? (r.no_data_state == "Alerting" && r.exec_err_state == "Alerting" && r.for == "2m") : (r.no_data_state == "KeepLast" && r.exec_err_state == "KeepLast")]) && !tolist(grafana_contact_point.slack.slack)[0].disable_resolve_message
    error_message = "Only dedicated datasource rules may alert on Error/NoData after 2m; services keep last state and recovery messages remain enabled."
  }
}

run "public_health_has_one_location_and_checks_status_and_body" {
  command = plan

  assert {
    condition     = length(grafana_synthetic_monitoring_check.health) == 2 && alltrue([for c in grafana_synthetic_monitoring_check.health : c.frequency == 60000 && c.timeout == 10000 && length(c.probes) == 1 && tolist(tolist(c.settings)[0].http)[0].valid_status_codes == toset([200])])
    error_message = "Two environments must use one location, 60s interval, 10s timeout and HTTP 200."
  }

  assert {
    condition     = can(regex(local.health_body_pattern, "{\"status\":\"ok\",\"services\":[\"summary\",\"coach\",\"report\"],\"model\":\"test\",\"keep_alive\":false,\"commit\":\"unknown\"}")) && !can(regex(local.health_body_pattern, "{\"status\":\"down\",\"nested\":{\"status\":\"ok\"}}")) && !can(regex(local.health_body_pattern, "<html>\"status\":\"ok\"</html>"))
    error_message = "Only the real health JSON contract with top-level status=ok may pass."
  }
}

run "two_environment_default_is_compatible" {
  command = plan

  assert {
    condition     = length(grafana_rule_group.monitoring.rule) == 59 && toset([for r in grafana_rule_group.monitoring.rule : r.uid]) == toset(flatten([for d in local.definitions : [for env in(d.scope == "environment" ? ["dev", "prod"] : ["shared"]) : "acttub-${d.key}-${env}"]]))
    error_message = "The two-environment default must preserve all 59 existing rule identities."
  }
  assert {
    condition     = alltrue([for name, d in grafana_dashboard.monitoring : jsondecode(d.config_json).templating == local.dashboards[name].templating && jsondecode(d.config_json).uid == "acttub-${name}"]) && output.external_checks_31_day_budget == { planned = 89280, allowance = 100000, headroom = 10720 }
    error_message = "Default dashboard identities, selectors, prod landing page and monthly budget must stay unchanged."
  }
}

run "dev_only_has_no_prod_probes_rules_metrics_or_selectors" {
  command = plan
  variables {
    health_origins = { dev = "https://dev.example.test" }
  }

  assert {
    condition     = keys(grafana_synthetic_monitoring_check.health) == ["dev"] && grafana_synthetic_monitoring_check.health["dev"].job == "acttub-health-dev" && grafana_synthetic_monitoring_check.health["dev"].frequency == 60000 && grafana_synthetic_monitoring_check.health["dev"].timeout == 10000 && output.external_checks_31_day_budget == { planned = 44640, allowance = 100000, headroom = 55360 }
    error_message = "Dev alone must create one unchanged 60s/10s health check and use half the monthly checks."
  }
  assert {
    condition     = length(grafana_rule_group.monitoring.rule) == 37 && grafana_rule_group.monitoring.interval_seconds == 60 && alltrue([for r in grafana_rule_group.monitoring.rule : contains(["dev", "shared"], r.labels.environment) && !strcontains(jsonencode(r), "prod")])
    error_message = "Dev needs exactly its 22 rules and 15 shared rules, with no prod queries or shared links to prod."
  }
  assert {
    condition = alltrue([for r in grafana_rule_group.monitoring.rule : (
      startswith(r.uid, "acttub-datasource-") || startswith(r.uid, "acttub-cloud-datasource-")
    ) ? (r.no_data_state == "Alerting" && r.exec_err_state == "Alerting" && r.for == "2m") : (r.no_data_state == "KeepLast" && r.exec_err_state == "KeepLast")])
    error_message = "Selecting dev alone must preserve the datasource Error/NoData and service KeepLast contract."
  }
  assert {
    condition     = length(grafana_dashboard.monitoring) == 3 && alltrue([for d in grafana_dashboard.monitoring : !strcontains(d.config_json, "prod") && jsondecode(d.config_json).templating.list[0].query == "dev" && jsondecode(d.config_json).templating.list[0].current == { text = "dev", value = "dev" } && jsondecode(d.config_json).templating.list[0].options == [{ text = "dev", value = "dev", selected = true }]])
    error_message = "All three dashboards must offer and initially select only dev."
  }
}

run "prod_only_is_a_valid_subset" {
  command = plan
  variables {
    health_origins = { prod = "https://prod.example.test" }
  }
  assert {
    condition     = keys(grafana_synthetic_monitoring_check.health) == ["prod"] && length(grafana_rule_group.monitoring.rule) == 37 && alltrue([for r in grafana_rule_group.monitoring.rule : contains(["prod", "shared"], r.labels.environment)]) && alltrue([for d in grafana_dashboard.monitoring : jsondecode(d.config_json).templating.list[0].query == "prod" && jsondecode(d.config_json).templating.list[0].current.value == "prod"])
    error_message = "Either supported environment may be installed alone."
  }
}

run "empty_environment_set_is_rejected" {
  command = plan
  variables {
    health_origins = {}
  }
  expect_failures = [var.health_origins]
}

run "unknown_environment_is_rejected" {
  command = plan
  variables {
    health_origins = { dev = "https://dev.example.test", staging = "https://staging.example.test" }
  }
  expect_failures = [var.health_origins]
}

run "invalid_selected_origin_is_rejected" {
  command = plan
  variables {
    health_origins = { dev = "https://dev.example.test/health" }
  }
  expect_failures = [var.health_origins]
}
