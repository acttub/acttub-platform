#!/usr/bin/env python3
"""Run the shipped PromQL, thresholds and pending periods in real promtool."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
rules = json.loads((ROOT / "rules.json").read_text())
with tempfile.TemporaryDirectory(prefix="acttub-rules-") as directory:
    path = Path(directory)
    (path / "rules.yml").write_text(json.dumps({"groups": [{
        "name": "acttub", "interval": "1m", "rules": [{
            "alert": rule["key"],
            "expr": "(" + rule["expr"].replace("$env", "dev").replace("$disk", "/") + ") " + rule["op"] + " " + str(rule["threshold"]),
            "for": rule["for"],
        } for rule in rules],
    }]}))
    tests = json.loads((ROOT / "tests/rule_cases.json").read_text())
    # Observe the exact query value/absence before Grafana's KeepLast handling.
    # A Prometheus alert disappearing is not evidence of Grafana recovery.
    expressions = {rule["key"]: rule["expr"] for rule in rules}
    for case in tests:
        for assertion in case.get("promql_expr_test", []):
            if "rule" in assertion:
                assertion["expr"] = expressions[assertion.pop("rule")].replace("$env", "dev").replace("$disk", "/")
            elif "dashboard" in assertion:
                dashboard = json.loads((ROOT / "dashboards" / (assertion.pop("dashboard") + ".json")).read_text())
                panel_id = assertion.pop("panel_id")
                panel = next(panel for panel in dashboard["panels"] if panel["id"] == panel_id)
                assertion["expr"] = panel["targets"][0]["expr"].replace("$environment", "dev").replace("${mountpoint}", "/")
    (path / "tests.yml").write_text(json.dumps({"rule_files": ["rules.yml"], "evaluation_interval": "1m", "fuzzy_compare": True, "tests": tests}))
    tool = os.environ.get("PROMTOOL", "promtool")
    subprocess.run([tool, "check", "rules", str(path / "rules.yml")], check=True)
    subprocess.run([tool, "test", "rules", str(path / "tests.yml")], cwd=path, check=True)
    dashboard_queries = []
    for file in sorted((ROOT / "dashboards").glob("*.json")):
        dashboard = json.loads(file.read_text())
        for panel in dashboard["panels"]:
            for query in panel.get("targets", []):
                dashboard_queries.append({"record": "dashboard_query_" + str(len(dashboard_queries)), "expr": query["expr"].replace("$environment", "dev").replace("${mountpoint}", "/")})
    (path / "dashboards.yml").write_text(json.dumps({"groups": [{"name": "dashboards", "rules": dashboard_queries}]}))
    subprocess.run([tool, "check", "rules", str(path / "dashboards.yml")], check=True)
