resource "grafana_dashboard" "monitoring" {
  for_each  = toset(["service", "operations", "infrastructure"])
  folder    = grafana_folder.monitoring.uid
  overwrite = false
  config_json = jsonencode(merge(jsondecode(templatefile("${path.module}/dashboards/${each.key}.json", {
    local_uid  = grafana_data_source.local.uid
    cloud_uid  = var.synthetic_datasource_uid
    mountpoint = var.disk_mountpoint
    })), {
    links = concat([
      { title = "세 운영 화면", type = "dashboards", tags = ["acttub-monitoring"], includeVars = true, keepTime = true, asDropdown = true },
      { title = "확인 절차", type = "link", url = var.runbook_url, targetBlank = true }
    ], [for link in var.investigation_links : merge(link, { type = "link", targetBlank = true })])
  }))
  lifecycle { prevent_destroy = true }
}
