#!/usr/bin/env python3
"""Preview/apply this one Terraform module with ownership and drift checks.

Only GET requests are made here. The official Grafana provider performs writes.
The saved plan and its audit receipt are sensitive, local, short-lived files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
ADDRESSES = {
    "grafana_folder.monitoring", "grafana_data_source.local",
    "grafana_contact_point.slack", "grafana_rule_group.monitoring",
    'grafana_dashboard.monitoring["service"]',
    'grafana_dashboard.monitoring["operations"]',
    'grafana_dashboard.monitoring["infrastructure"]',
    'grafana_synthetic_monitoring_check.health["dev"]',
    'grafana_synthetic_monitoring_check.health["prod"]',
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise RuntimeError("API redirect refused; use the final official API origin")


def request_json(origin, path, token, optional=False):
    parsed = urlsplit(origin)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname == "127.0.0.1"):
        raise RuntimeError("API origins must use HTTPS (loopback HTTP is for local tests only)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("API origin must not contain credentials or query parameters")
    request = Request(origin.rstrip("/") + path, headers={"Authorization": "Bearer " + token})
    try:
        with build_opener(NoRedirect).open(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        if optional and error.code == 404:
            return None
        # Do not print provider response bodies, URLs containing credentials or tokens.
        raise RuntimeError("API read failed with HTTP " + str(error.code) + " at " + path) from None


def tf(*args, capture=True):
    env = {k: v for k, v in os.environ.items() if not k.startswith("TF_LOG")}
    result = subprocess.run([os.environ.get("TERRAFORM", "terraform"), *args], cwd=ROOT, env=env, text=True, capture_output=capture)
    if result.returncode:
        if capture:
            # Terraform may return details containing secrets. Operator can rerun
            # the exact read-only command in a private terminal to investigate.
            raise RuntimeError("Terraform " + args[0] + " failed (exit " + str(result.returncode) + ")")
        raise RuntimeError("Terraform command failed")
    return result.stdout if capture else ""


def state_resources():
    data = json.loads(tf("show", "-json"))
    module = data.get("values", {}).get("root_module", {})
    if module.get("child_modules"):
        raise RuntimeError("Use a separate Terraform state for this monitoring module")
    resources = {r["address"]: r["values"] for r in module.get("resources", [])}
    if set(resources) - ADDRESSES:
        raise RuntimeError("This state contains resources outside the monitoring ownership boundary")
    return resources


def inventory(variables, resources):
    token = os.environ["GRAFANA_AUTH"]
    origin = variables["grafana_url"]
    read = lambda path, optional=False: request_json(origin, path, token, optional)
    features = read("/api/frontend/settings").get("featureToggles", {})
    if features.get("alertingSimplifiedRouting") is False:
        raise RuntimeError("This stack disables rule-level notification settings")
    cloud_uid = variables["synthetic_datasource_uid"]
    if not cloud_uid or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in cloud_uid):
        raise RuntimeError("Invalid existing Cloud Metrics datasource UID")
    if cloud_uid == "acttub-local-prometheus" or read("/api/datasources/uid/" + cloud_uid).get("type") != "prometheus":
        raise RuntimeError("Synthetic Monitoring needs its separate existing Cloud Metrics datasource")
    probes = request_json(os.environ["GRAFANA_SM_URL"], "/api/v1/probe/list", os.environ["GRAFANA_SM_ACCESS_TOKEN"])
    selected = next((p for p in probes if p["id"] == variables["probe_id"]), None)
    if selected is None or selected.get("public") is not True or selected.get("deprecated") is True:
        raise RuntimeError("Select one current public Synthetic Monitoring probe")
    objects = {}
    paths = {
        "grafana_folder.monitoring": "/api/folders/acttub-monitoring",
        "grafana_data_source.local": "/api/datasources/uid/acttub-local-prometheus",
        "grafana_rule_group.monitoring": "/api/v1/provisioning/folder/acttub-monitoring/rule-groups/acttub-monitoring",
    }
    paths.update({'grafana_dashboard.monitoring["' + key + '"]': "/api/dashboards/uid/acttub-" + key for key in ["service", "operations", "infrastructure"]})
    for address, path in paths.items():
        value = read(path, True)
        objects[address] = value
        if value is not None and address not in resources:
            raise RuntimeError("Ownership collision: " + address + "; restore the protected state or audit an explicit import first")
    group = objects["grafana_rule_group.monitoring"]
    definitions = json.loads((ROOT / "rules.json").read_text())
    desired_uids = {"acttub-" + r["key"] + "-" + env for r in definitions for env in (["dev", "prod"] if r["scope"] == "environment" else ["shared"])}
    known_rule_uids = {r["uid"] for r in resources.get("grafana_rule_group.monitoring", {}).get("rule", [])}
    objects["rules_by_uid"] = sorted([r for r in read("/api/v1/provisioning/alert-rules") if r["uid"] in desired_uids], key=lambda r: r["uid"])
    if {r["uid"] for r in objects["rules_by_uid"]} - known_rule_uids:
        raise RuntimeError("Ownership collision: alert rule UID already exists outside this state")
    if group:
        expected = {r["uid"] for r in resources["grafana_rule_group.monitoring"].get("rule", [])}
        if {r["uid"] for r in group["rules"]} - expected:
            raise RuntimeError("Untracked rules in owned group; refusing to replace the group")
    contacts = [c for c in read("/api/v1/provisioning/contact-points") if c["name"] == "acttub-monitoring-slack"]
    known = {c["uid"] for c in resources.get("grafana_contact_point.slack", {}).get("slack", [])}
    if {c["uid"] for c in contacts} - known:
        raise RuntimeError("Ownership collision: untracked contact point integration")
    objects["contacts"] = sorted(contacts, key=lambda c: c["uid"])
    checks = request_json(os.environ["GRAFANA_SM_URL"], "/api/v1/check/list", os.environ["GRAFANA_SM_ACCESS_TOKEN"])
    objects["checks"] = sorted([c for c in checks if c["job"] in ["acttub-health-dev", "acttub-health-prod"]], key=lambda c: c["id"])
    for check in objects["checks"]:
        address = 'grafana_synthetic_monitoring_check.health["' + check["job"].removeprefix("acttub-health-") + '"]'
        if str(check["id"]) != str(resources.get(address, {}).get("id", "")):
            raise RuntimeError("Ownership collision: existing external health check")
    # Root policy is intentionally neither written nor imported.
    return objects


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def sources_digest():
    paths = sorted(p for p in ROOT.rglob("*") if p.is_file() and ".terraform" not in p.parts and ".validation" not in p.parts and (p.suffix in [".tf", ".tmpl"] or p.name == "rules.json" or p.parent.name == "dashboards"))
    return digest({str(p.relative_to(ROOT)): p.read_text() for p in paths})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "apply"])
    parser.add_argument("--vars", help="Non-secret .tfvars.json file; only needed for plan")
    parser.add_argument("--plan", required=True, help="Sensitive saved .tfplan path")
    args = parser.parse_args()
    os.umask(0o077)
    plan = Path(args.plan).resolve()
    receipt = Path(str(plan) + ".audit.json")
    if plan.suffix != ".tfplan":
        raise RuntimeError("Saved plans must use the ignored .tfplan suffix")
    for name in ["GRAFANA_AUTH", "GRAFANA_SM_URL", "GRAFANA_SM_ACCESS_TOKEN"]:
        if not os.environ.get(name):
            raise RuntimeError("Required protected environment variable: " + name)
    resources = state_resources()
    if args.action == "plan":
        if not args.vars:
            raise RuntimeError("plan requires --vars with a non-secret JSON variable file")
        variables_path = Path(args.vars).resolve()
        variables = json.loads(variables_path.read_text())
        if "slack_webhook_url" in variables:
            raise RuntimeError("Supply Slack credentials through TF_VAR_slack_webhook_url, never the variable file")
        before = inventory(variables, resources)
        tf("plan", "-input=false", "-no-color", "-var-file=" + str(variables_path), "-out=" + str(plan), capture=False)
        if digest(before) != digest(inventory(variables, resources)):
            raise RuntimeError("Cloud changed during preview; regenerate the plan")
        rendered = json.loads(tf("show", "-json", str(plan)))
        changes = rendered.get("resource_changes", [])
        if any(c["address"] not in ADDRESSES or "delete" in c["change"]["actions"] for c in changes):
            raise RuntimeError("Plan changes ownership or deletes a resource; separate review required")
        receipt.write_text(json.dumps({"plan": hashlib.sha256(plan.read_bytes()).hexdigest(), "sources": sources_digest(), "inventory": digest(before), "grafana_url": variables["grafana_url"], "sm_url": os.environ["GRAFANA_SM_URL"], "probe_id": variables["probe_id"], "synthetic_datasource_uid": variables["synthetic_datasource_uid"]}, indent=2) + "\n")
        plan.chmod(0o600)
        receipt.chmod(0o600)
        print("Preview only. Review the saved plan before running apply with the same path.")
    else:
        audit = json.loads(receipt.read_text())
        if audit["plan"] != hashlib.sha256(plan.read_bytes()).hexdigest() or audit["sources"] != sources_digest() or audit["sm_url"] != os.environ["GRAFANA_SM_URL"]:
            raise RuntimeError("Plan, module or API target changed; regenerate and review the plan")
        if audit["inventory"] != digest(inventory(audit, resources)):
            raise RuntimeError("Cloud drift since preview; regenerate and review the plan")
        tf("apply", "-input=false", "-no-color", str(plan), capture=False)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print("Monitoring apply stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
