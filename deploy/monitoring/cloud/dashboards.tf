locals {
  dashboards = { for name in ["service", "operations", "infrastructure"] : name => jsondecode(templatefile("${path.module}/dashboards/${name}.json", {
    local_uid  = grafana_data_source.local.uid
    cloud_uid  = var.synthetic_datasource_uid
    mountpoint = var.disk_mountpoint
  })) }
}

resource "grafana_dashboard" "monitoring" {
  for_each  = local.dashboards
  folder    = grafana_folder.monitoring.uid
  overwrite = false
  config_json = jsonencode(merge(each.value, {
    templating = merge(each.value.templating, {
      list = [merge(each.value.templating.list[0], {
        query   = join(",", local.environments)
        current = { text = local.default_environment, value = local.default_environment }
        options = [for environment in local.environments : {
          text = environment, value = environment, selected = environment == local.default_environment
        }]
      })]
    })
    links = concat([
      { title = "세 운영 화면", type = "dashboards", tags = ["acttub-monitoring"], includeVars = true, keepTime = true, asDropdown = true },
      { title = "확인 절차", type = "link", url = var.runbook_url, targetBlank = true }
    ], [for link in var.investigation_links : merge(link, { type = "link", targetBlank = true })])
  }))
  lifecycle { prevent_destroy = true }
}
