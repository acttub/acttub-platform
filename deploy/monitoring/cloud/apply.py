#!/usr/bin/env python3
"""Render rules.json·dashboards/*.json for the Grafana Cloud stack and show or apply the difference.

The repository files are the source of truth. Writes are uid-keyed upserts of the owned objects only:
the `acttub-monitoring` rule group, the three `acttub-*` dashboards and the `acttub-health-<env>`
Synthetic Monitoring checks. Nothing outside them is changed or deleted. The Slack contact point,
the PDC datasource and the Synthetic Monitoring datasource are one-time setup (docs) and only checked.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
FOLDER, GROUP, LOCAL_UID, CONTACT = "acttub-monitoring", "acttub-monitoring", "acttub-local-prometheus", "acttub-monitoring-slack"
DASHBOARDS = ("service", "operations", "infrastructure")
CHECK_BUDGET = 100000  # Free plan Synthetic Monitoring executions per month
JSON_STRING = r'"([^"\\\x00-\x1f]|\\(["\\/bfnrt]|u[0-9a-fA-F]{4}))*"'
# Basic checks support RE2 regex, not JSONPath: require the exact HealthResponse shape and order.
HEALTH_BODY = (r'^\s*\{\s*"status"\s*:\s*"ok"\s*,\s*"services"\s*:\s*\[\s*(' + JSON_STRING + r'(\s*,\s*' + JSON_STRING + r')*)?\s*\]\s*,'
               r'\s*"model"\s*:\s*' + JSON_STRING + r'\s*,\s*"keep_alive"\s*:\s*(true|false)\s*,\s*"commit"\s*:\s*' + JSON_STRING + r'\s*\}\s*$')


def load_config(path):
    c = json.loads(Path(path).read_text())
    origins = c["health_origins"]
    if not origins or any(e not in ("dev", "prod") or not re.fullmatch(r"https://[A-Za-z0-9.-]+", o) for e, o in origins.items()):
        raise ValueError("health_origins must be a nonempty subset of dev/prod HTTPS origins without a trailing slash")
    if not re.fullmatch(r"(https://[A-Za-z0-9.-]+|http://127\.0\.0\.1:[0-9]+)", c["grafana_url"]):
        raise ValueError("grafana_url must be the stack HTTPS origin")
    if not (isinstance(c["probe_id"], int) and c["probe_id"] > 0):
        raise ValueError("probe_id must be one positive public probe id")
    if not re.fullmatch(r"/[A-Za-z0-9/_-]*", c["disk_mountpoint"]) or not re.fullmatch(r"[a-z][a-z0-9-]{0,20}", c["site"]):
        raise ValueError("disk_mountpoint/site contain unexpected characters")
    if len(origins) * 60 * 24 * 31 > CHECK_BUDGET:
        raise ValueError("external checks exceed the monthly Synthetic Monitoring allowance")
    return c


def environments(c):
    return [e for e in ("dev", "prod") if e in c["health_origins"]]


def default_environment(c):
    return "prod" if "prod" in c["health_origins"] else "dev"


def number(n):
    return str(int(n)) if float(n).is_integer() else str(n)


def render_group(c):
    envs, default = environments(c), default_environment(c)
    rules = []
    for d in json.loads((ROOT / "rules.json").read_text()):
        for env in (envs if d["scope"] == "environment" else ["shared"]):
            ds = c["synthetic_datasource_uid"] if d["datasource"] == "cloud" else LOCAL_UID
            # Only the dedicated datasource rules alert on Error/NoData; services keep their last state.
            special = d["key"] in ("datasource", "cloud-datasource")
            rules.append({
                "uid": f"acttub-{d['key']}-{env}", "title": f"{d['title']} ({env})", "condition": "B",
                "folderUID": FOLDER, "ruleGroup": GROUP, "for": d["for"], "isPaused": False,
                "noDataState": "Alerting" if special else "KeepLast", "execErrState": "Alerting" if special else "KeepLast",
                "labels": {"owner": "acttub-monitoring", "environment": env, "site": c["site"], "datasource": ds,
                           "target": d["target"], "severity": d["severity"]},
                "annotations": {
                    "summary": d["title"], "condition": d["condition"], "observed_value": "{{ $values.A.Value }}",
                    "description": f"{d['condition']}; 관측값={{{{ $values.A.Value }}}}. {d['recovery']}",
                    "recovery_meaning": d["recovery"],
                    "dashboard_url": f"{c['grafana_url']}/d/acttub-{d['dashboard']}?var-environment={default if env == 'shared' else env}"
                                     "&from=now-1h&to=now&timezone=Asia%2FSeoul",
                    "runbook_url": f"{c['runbook_url']}#{d['dashboard']}",
                },
                "data": [
                    {"refId": "A", "datasourceUid": ds, "relativeTimeRange": {"from": 600, "to": 0},
                     "model": {"refId": "A", "expr": d["expr"].replace("$env", env).replace("$disk", c["disk_mountpoint"]),
                               "instant": True, "range": False, "intervalMs": 30000, "maxDataPoints": 1000}},
                    {"refId": "B", "datasourceUid": "__expr__", "relativeTimeRange": {"from": 0, "to": 0},
                     "model": {"refId": "B", "type": "math", "expression": f"$A {d['op']} {number(d['threshold'])}"}},
                ],
                # Rule-level routing: the whole notification policy tree is never written.
                "notification_settings": {"receiver": CONTACT, "group_by": ["grafana_folder", "alertname", "environment", "site", "datasource"],
                                          "group_wait": "10s", "group_interval": "1m", "repeat_interval": "1h"},
            })
    return {"title": GROUP, "folderUid": FOLDER, "interval": 60, "rules": rules}


def render_dashboards(c):
    envs, default = environments(c), default_environment(c)
    out = {}
    for name in DASHBOARDS:
        text = (ROOT / "dashboards" / f"{name}.json").read_text()
        text = text.replace("${local_uid}", LOCAL_UID).replace("${cloud_uid}", c["synthetic_datasource_uid"]).replace("${mountpoint}", c["disk_mountpoint"])
        d = json.loads(text)
        selector = dict(d["templating"]["list"][0], query=",".join(envs), current={"text": default, "value": default},
                        options=[{"text": e, "value": e, "selected": e == default} for e in envs])
        d["templating"] = dict(d["templating"], list=[selector] + d["templating"]["list"][1:])
        d["links"] = [{"title": "세 운영 화면", "type": "dashboards", "tags": ["acttub-monitoring"], "includeVars": True, "keepTime": True, "asDropdown": True},
                      {"title": "확인 절차", "type": "link", "url": c["runbook_url"], "targetBlank": True}]
        out[d["uid"]] = d
    return out


def render_checks(c):
    return {f"acttub-health-{env}": {
        "job": f"acttub-health-{env}", "target": f"{origin}/health", "probes": [c["probe_id"]],
        "frequency": 60000, "timeout": 10000, "enabled": True, "basicMetricsOnly": True, "alertSensitivity": "none",
        "labels": [{"name": "site", "value": c["site"]}, {"name": "owner", "value": "acttub-monitoring"}, {"name": "environment", "value": env}],
        "settings": {"http": {"method": "GET", "ipVersion": "V4", "validStatusCodes": [200], "failIfSSL": False, "failIfNotSSL": True,
                              "noFollowRedirects": True, "failIfBodyNotMatchesRegexp": [HEALTH_BODY]}},
    } for env, origin in c["health_origins"].items()}


# ---------- Grafana API ----------

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise RuntimeError("API redirect refused; use the final stack origin")


class Grafana:
    def __init__(self, origin, token):
        parsed = urlsplit(origin)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname == "127.0.0.1"):
            raise RuntimeError("the stack origin must use HTTPS")
        self.origin, self.token, self.opener = origin.rstrip("/"), token, build_opener(NoRedirect)

    def call(self, method, path, body=None, optional=False, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = Request(self.origin + path, data=data, method=method,
                          headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json", **(headers or {})})
        try:
            with self.opener.open(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as error:
            if optional and error.code == 404:
                return None
            # Response bodies may echo secrets (webhooks); report the status only.
            raise RuntimeError(f"{method} {path} failed with HTTP {error.code}") from None


def read_cloud(g):
    """Everything apply may touch or depends on. Raises before any write if one-time setup is missing."""
    if g.call("GET", "/api/datasources/uid/" + LOCAL_UID, optional=True) is None:
        raise RuntimeError("missing PDC datasource " + LOCAL_UID + " (one-time setup, see MONITORING-CLOUD.md)")
    if not any(p["name"] == CONTACT for p in g.call("GET", "/api/v1/provisioning/contact-points")):
        raise RuntimeError("missing contact point " + CONTACT + " (one-time setup, see MONITORING-CLOUD.md)")
    sm = next((d for d in g.call("GET", "/api/datasources") if d["type"] == "synthetic-monitoring-datasource"), None)
    if sm is None:
        raise RuntimeError("Synthetic Monitoring is not initialised on this stack")
    sm_path = f"/api/datasources/proxy/uid/{sm['uid']}/sm"
    return {
        "folder": g.call("GET", "/api/folders/" + FOLDER, optional=True),
        "group": g.call("GET", f"/api/v1/provisioning/folder/{FOLDER}/rule-groups/{GROUP}", optional=True),
        "rules": g.call("GET", "/api/v1/provisioning/alert-rules"),
        "dashboards": {uid: g.call("GET", "/api/dashboards/uid/" + uid, optional=True) for uid in ("acttub-" + n for n in DASHBOARDS)},
        "sm_path": sm_path,
        "checks": g.call("GET", sm_path + "/check/list"),
        "probes": g.call("GET", sm_path + "/probe/list"),
    }


def contains(want, have):
    """True when every key in `want` has the same value in `have` (Grafana adds ids/timestamps of its own)."""
    if isinstance(want, dict):
        return isinstance(have, dict) and all(k in have and contains(v, have[k]) for k, v in want.items())
    if isinstance(want, list):
        return isinstance(have, list) and len(want) == len(have) and all(contains(a, b) for a, b in zip(want, have))
    return want == have


def plan(c, cloud):
    probe = next((p for p in cloud["probes"] if p["id"] == c["probe_id"]), None)
    if probe is None or not probe.get("public") or probe.get("deprecated"):
        raise RuntimeError("probe_id is not a current public probe")
    group, dashboards, checks = render_group(c), render_dashboards(c), render_checks(c)
    wanted = {r["uid"] for r in group["rules"]}
    elsewhere = sorted(r["uid"] for r in cloud["rules"] if r["uid"] in wanted and (r["folderUID"], r["ruleGroup"]) != (FOLDER, GROUP))
    if elsewhere:
        raise RuntimeError("rule uid already used outside the owned group: " + ", ".join(elsewhere))
    for uid, current in cloud["dashboards"].items():
        if current and current["meta"].get("folderUid") != FOLDER:
            raise RuntimeError(uid + " exists outside the " + FOLDER + " folder")
    have = {r["uid"]: r for r in (cloud["group"] or {}).get("rules", [])}
    changes = {
        "folder": cloud["folder"] is None,
        "rules_added": sorted(wanted - set(have)),
        "rules_removed": sorted(set(have) - wanted),
        "rules_changed": sorted(r["uid"] for r in group["rules"] if r["uid"] in have and not contains(r, have[r["uid"]])),
        "dashboards": sorted(uid for uid, d in dashboards.items()
                             if not cloud["dashboards"][uid] or not contains({k: v for k, v in d.items() if k not in ("id", "version")}, cloud["dashboards"][uid]["dashboard"])),
        "checks_added": sorted(job for job in checks if not any(x["job"] == job for x in cloud["checks"])),
        "checks_changed": sorted(job for job, want in checks.items() if any(x["job"] == job and not contains(want, x) for x in cloud["checks"])),
        # Checks for environments dropped from the config are reported, never deleted by this tool.
        "checks_unmanaged": sorted(x["job"] for x in cloud["checks"] if x["job"].startswith("acttub-health-") and x["job"] not in checks),
    }
    return changes, {"group": group, "dashboards": dashboards, "checks": checks}


def empty(changes):
    return not any(v for k, v in changes.items() if k != "checks_unmanaged")


def apply(g, cloud, changes, desired, backup_dir):
    backup_dir.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_dir / f"before-{stamp}.json"
    backup.write_text(json.dumps({k: v for k, v in cloud.items() if k != "probes"}, ensure_ascii=False, indent=1))
    backup.chmod(0o600)
    if changes["folder"]:
        g.call("POST", "/api/folders", {"uid": FOLDER, "title": "Acttub 운영 모니터링"})
    for job in changes["checks_added"]:
        g.call("POST", cloud["sm_path"] + "/check/add", desired["checks"][job])
    for job in changes["checks_changed"]:
        current = next(x for x in cloud["checks"] if x["job"] == job)
        g.call("POST", cloud["sm_path"] + "/check/update", {**current, **desired["checks"][job]})
    if changes["rules_added"] or changes["rules_removed"] or changes["rules_changed"]:
        # No provenance header: the rules stay editable in the UI, as they were when first created.
        g.call("PUT", f"/api/v1/provisioning/folder/{FOLDER}/rule-groups/{GROUP}", desired["group"], headers={"X-Disable-Provenance": "true"})
    for uid in changes["dashboards"]:
        current = cloud["dashboards"][uid]
        body = dict(desired["dashboards"][uid], id=current["dashboard"]["id"] if current else None,
                    version=current["dashboard"]["version"] if current else 0)
        g.call("POST", "/api/dashboards/db", {"dashboard": body, "folderUid": FOLDER, "overwrite": False, "message": "deploy/monitoring/cloud/apply.py"})
    return backup


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["diff", "apply"])
    parser.add_argument("--config", default=str(ROOT / "cloud.json"))
    args = parser.parse_args(argv)
    c = load_config(args.config)
    token = os.environ.get("GRAFANA_TOKEN")
    if not token:
        raise RuntimeError("GRAFANA_TOKEN (stack service-account token) is required")
    g = Grafana(c["grafana_url"], token)
    cloud = read_cloud(g)
    changes, desired = plan(c, cloud)
    print(json.dumps(changes, ensure_ascii=False, indent=1))
    if empty(changes):
        print("No changes.")
        return
    if args.action == "apply":
        # Refuse if Cloud moved between the read above and now (someone else applying or editing).
        if plan(c, read_cloud(g))[0] != changes:
            raise RuntimeError("Cloud changed while planning; run again")
        backup = apply(g, cloud, changes, desired, ROOT / ".backups")
        after, _ = plan(c, read_cloud(g))
        if not empty(after):
            raise RuntimeError("applied, but a difference remains: " + json.dumps(after, ensure_ascii=False))
        print(f"Applied. Previous Cloud state saved to {backup}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print("Monitoring apply stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
