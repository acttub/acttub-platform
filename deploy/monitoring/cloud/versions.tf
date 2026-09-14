terraform {
  required_version = "= 1.16.2"
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "= 4.46.0"
    }
  }
}
