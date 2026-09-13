variable "health_origins" {
  description = "Public HTTPS origins, without paths, credentials, or query strings."
  type        = map(string)
  validation {
    condition     = toset(keys(var.health_origins)) == toset(["dev", "prod"]) && alltrue([for origin in values(var.health_origins) : can(regex("^https://[A-Za-z0-9.-]+$", origin))])
    error_message = "Supply exactly dev and prod public HTTPS origins without a trailing slash."
  }
}

variable "probe_id" {
  description = "One public Synthetic Monitoring probe ID, obtained from the actual stack."
  type        = number
  validation {
    condition     = var.probe_id > 0 && floor(var.probe_id) == var.probe_id
    error_message = "Select one positive public probe ID."
  }
}

variable "site" {
  description = "Bounded, non-personal shared host/site label."
  type        = string
  default     = "home"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,20}$", var.site))
    error_message = "Use a short lowercase site label."
  }
}

variable "pdc_network_id" {
  description = "Actual Cloud PDC network ID. This is not the agent signing token."
  type        = string
  validation {
    condition     = length(var.pdc_network_id) > 0
    error_message = "A real PDC network ID is required."
  }
}

variable "synthetic_datasource_uid" {
  description = "Existing Grafana Cloud Metrics datasource receiving Synthetic Monitoring. Read only; never managed here."
  type        = string
}

variable "slack_webhook_url" {
  description = "Protected incoming webhook already bound to #서비스-장애; supplied through TF_VAR_slack_webhook_url. State and saved plans contain this secret."
  type        = string
  sensitive   = true
}

variable "grafana_url" {
  description = "Actual stack HTTPS URL. GRAFANA_AUTH is the separate service-account token."
  type        = string
  validation {
    condition     = can(regex("^(https://[A-Za-z0-9.-]+|http://127\\.0\\.0\\.1:[0-9]+)$", var.grafana_url))
    error_message = "Supply the stack HTTPS origin, without credentials."
  }
}

variable "disk_mountpoint" {
  description = "Actual node_exporter mountpoint containing the data disk. Verify on the host."
  type        = string
  default     = "/"
  validation {
    condition     = can(regex("^/[A-Za-z0-9/_-]*$", var.disk_mountpoint))
    error_message = "Use a literal absolute mountpoint without PromQL metacharacters."
  }
}

variable "runbook_url" {
  type    = string
  default = "https://github.com/acttub/acttub-platform/blob/dev/docs/deploy/MONITORING-CLOUD.md"
}

variable "investigation_links" {
  description = "Optional Sentry/Langfuse project links without tokens or personal data. Use the dashboard environment and time range when investigating."
  type        = list(object({ title = string, url = string }))
  default     = []
  validation {
    condition     = alltrue([for link in var.investigation_links : contains(["Sentry", "Langfuse"], link.title) && can(regex("^https://[A-Za-z0-9.-]+/[^?@#]*$", link.url))])
    error_message = "Use HTTPS Sentry/Langfuse project paths without credentials, query strings or fragments."
  }
}
