"""The actual provider talks only to a disposable HTTP boundary, never Cloud."""
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class CloudAPI(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        state = self.server.state
        if path == "/api/org":
            return self.reply({"id": 1, "name": "Fixture"})
        if path == "/api/health":
            return self.reply({"version": "12.4.0", "database": "ok"})
        if path == "/api/frontend/settings":
            return self.reply({"featureToggles": {"alertingSimplifiedRouting": True}})
        if path.startswith("/api/v1/provisioning/alert-rules/"):
            uid = path.rsplit("/", 1)[-1]
            return self.reply(next(r for group in state["groups"].values() for r in group["rules"] if r["uid"] == uid))
        if path == "/api/v1/provisioning/alert-rules":
            return self.reply([r for group in state["groups"].values() for r in group["rules"]])
        if path == "/api/v1/provisioning/contact-points":
            return self.reply(list(state["contacts"].values()))
        if path == "/api/v1/provisioning/policies":
            return self.reply(state["policies"])
        if path == "/api/v1/check/list":
            return self.reply(list(state["checks"].values()))
        if path == "/api/v1/probe/list":
            return self.reply([{"id": 1, "name": "public-fixture", "public": True}, {"id": 2, "name": "private-fixture", "public": False}])
        for prefix, resource in [("/api/folders/", "folders"), ("/api/datasources/uid/", "datasources"), ("/api/dashboards/uid/", "dashboards"), ("/api/v1/provisioning/folder/acttub-monitoring/rule-groups/", "groups"), ("/api/v1/check/", "checks")]:
            if path.startswith(prefix):
                value = state[resource].get(path[len(prefix):])
                return self.reply(value if value is not None else {"message": "not found"}, 200 if value is not None else 404)
        return self.reply({"message": "unsupported fixture route " + path}, 404)

    def do_POST(self):
        self.mutate()

    def do_PUT(self):
        self.mutate()

    def mutate(self):
        path = unquote(urlsplit(self.path).path)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        state = self.server.state
        self.server.writes.append((self.command, path))
        if path == "/api/folders":
            state["folders"][body["uid"]] = dict(body, id=1, version=1)
            return self.reply(state["folders"][body["uid"]])
        if path == "/api/datasources" or path.startswith("/api/datasources/uid/"):
            body.update(id=1, orgId=1, secureJsonFields={})
            state["datasources"][body["uid"]] = body
            return self.reply({"datasource": body, "id": 1, "uid": body["uid"], "message": "updated"})
        if path == "/api/v1/provisioning/contact-points" or path.startswith("/api/v1/provisioning/contact-points/"):
            body["uid"] = body.get("uid") or "fixture-slack"
            body["provenance"] = "api"
            state["contacts"][body["uid"]] = body
            return self.reply(body, 202)
        if path.startswith("/api/v1/provisioning/folder/acttub-monitoring/rule-groups/"):
            for rule in body["rules"]:
                rule.update(orgID=1, ruleGroup="acttub-monitoring", folderUID="acttub-monitoring", provenance="api")
            state["groups"][body["title"]] = body
            return self.reply(body)
        if path == "/api/dashboards/db":
            dashboard = body["dashboard"]
            old = state["dashboards"].get(dashboard["uid"])
            if old and not body.get("overwrite"):
                return self.reply({"message": "exists"}, 412)
            dashboard.update(id=10 + len(state["dashboards"]), version=1 if not old else old["dashboard"]["version"] + 1)
            state["dashboards"][dashboard["uid"]] = {"dashboard": dashboard, "meta": {"folderUid": body["folderUid"], "url": "/d/" + dashboard["uid"]}}
            return self.reply({"id": dashboard["id"], "uid": dashboard["uid"], "version": dashboard["version"], "status": "success", "url": "/d/" + dashboard["uid"]})
        if path in ("/api/v1/check/add", "/api/v1/check/update"):
            body["id"] = body.get("id") or len(state["checks"]) + 1
            body["tenantId"] = 1
            state["checks"][str(body["id"])] = body
            return self.reply(body)
        return self.reply({"message": "unsupported fixture mutation " + path}, 400)


class ApplyBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), CloudAPI)
        self.server.state = {key: {} for key in ["folders", "datasources", "dashboards", "contacts", "checks", "groups"]}
        self.server.state["policies"] = {"receiver": "unrelated", "routes": [{"receiver": "finance", "object_matchers": [["team", "=", "finance"]]}]}
        self.server.state["contacts"]["unrelated"] = {"uid": "unrelated", "name": "unrelated", "type": "email", "settings": {"addresses": "fixture@example.test"}}
        self.server.state["dashboards"]["foreign"] = {"dashboard": {"uid": "foreign", "title": "Finance", "version": 7}, "meta": {"folderUid": "finance"}}
        self.server.state["datasources"]["foreign"] = {"uid": "foreign", "name": "Finance", "type": "prometheus", "url": "http://finance:9090"}
        self.server.state["datasources"]["cloud-existing"] = {"uid": "cloud-existing", "name": "Cloud Metrics", "type": "prometheus", "url": "https://cloud.example.test"}
        self.original = copy.deepcopy(self.server.state)
        self.server.writes = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory(prefix="acttub-cloud-api-")
        self.path = Path(self.temp.name)
        shutil.copytree(ROOT, self.path, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".terraform", "*.tfstate*", "*.tfplan*", ".validation", "__pycache__", "*.tfvars*"))
        (self.path / ".terraform").symlink_to(ROOT / ".terraform", target_is_directory=True)
        origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.variables = {"grafana_url": origin, "health_origins": {"dev": "https://dev.example.test", "prod": "https://prod.example.test"}, "probe_id": 1, "pdc_network_id": "fixture-pdc", "synthetic_datasource_uid": "cloud-existing"}
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("TF_VAR_", "GRAFANA_", "TF_LOG"))}
        self.env.update(GRAFANA_AUTH="fixture-token", GRAFANA_SM_URL=origin, GRAFANA_SM_ACCESS_TOKEN="fixture-sm-token", TF_VAR_slack_webhook_url="https://hooks.slack.com/services/fixture/never/send", TF_IN_AUTOMATION="1")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def command(self, *args):
        result = subprocess.run(["python3", str(self.path / "manage.py"), *args], cwd=self.path, env=self.env, text=True, capture_output=True, timeout=120)
        self.assertNotIn("fixture/never/send", result.stdout + result.stderr)
        return result

    def test_preview_apply_reapply_keeps_unrelated_resources(self):
        plan = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "changes.tfplan")
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        self.assertEqual(self.server.writes, [], "Preview must be read-only")
        applied = self.command("apply", "--plan", "changes.tfplan")
        self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr + str(self.server.writes))
        self.assertEqual(len(self.server.state["dashboards"]), 4)
        self.assertEqual(len(self.server.state["checks"]), 2)
        self.assertEqual(len(self.server.state["groups"]["acttub-monitoring"]["rules"]), 59)
        for rule in self.server.state["groups"]["acttub-monitoring"]["rules"]:
            if rule["uid"].startswith(("acttub-datasource-", "acttub-cloud-datasource-")):
                self.assertEqual((rule["noDataState"], rule["execErrState"]), ("Alerting", "Alerting"))
                self.assertIn(rule["for"], ("2m", "2m0s"))
            else:
                # promtool proves query absence; the real provider must send
                # KeepLast to Grafana, whose lifecycle differs from Prometheus.
                self.assertEqual((rule["noDataState"], rule["execErrState"]), ("KeepLast", "KeepLast"))
        writes = list(self.server.writes)
        second = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "second.tfplan")
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn("No changes", second.stdout)
        reapplied = self.command("apply", "--plan", "second.tfplan")
        self.assertEqual(reapplied.returncode, 0, reapplied.stdout + reapplied.stderr)
        self.assertEqual(self.server.writes, writes)
        self.assertEqual(self.server.state["policies"], self.original["policies"])
        self.assertEqual(self.server.state["contacts"]["unrelated"], self.original["contacts"]["unrelated"])
        self.assertEqual(self.server.state["dashboards"]["foreign"], self.original["dashboards"]["foreign"])
        self.assertEqual(self.server.state["datasources"]["foreign"], self.original["datasources"]["foreign"])
        self.variables["site"] = "alternate"
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        changed = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "update.tfplan")
        self.assertEqual(changed.returncode, 0, changed.stdout + changed.stderr)
        updated = self.command("apply", "--plan", "update.tfplan")
        self.assertEqual(updated.returncode, 0, updated.stdout + updated.stderr)
        self.assertEqual(len(self.server.state["checks"]), 2)
        self.assertEqual(len(self.server.state["dashboards"]), 4)
        self.assertTrue(all(r["labels"]["site"] == "alternate" for r in self.server.state["groups"]["acttub-monitoring"]["rules"]))
        self.assertEqual(self.server.state["policies"], self.original["policies"])

    def test_dev_only_reapply_then_expand_preserves_identities_and_rejects_shrink(self):
        self.variables["health_origins"] = {"dev": "https://dev.example.test"}
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        plan = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "dev.tfplan")
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        self.assertEqual(self.server.writes, [])
        applied = self.command("apply", "--plan", "dev.tfplan")
        self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr)
        checks = copy.deepcopy(self.server.state["checks"])
        self.assertEqual([c["job"] for c in checks.values()], ["acttub-health-dev"])
        rules = copy.deepcopy(self.server.state["groups"]["acttub-monitoring"]["rules"])
        self.assertEqual(len(rules), 37)
        self.assertNotIn("prod", json.dumps(rules))
        for name in ("service", "operations", "infrastructure"):
            dashboard = self.server.state["dashboards"]["acttub-" + name]["dashboard"]
            self.assertNotIn("prod", json.dumps(dashboard))
            selection = dashboard["templating"]["list"][0]
            self.assertEqual(selection["query"], "dev")
            self.assertEqual(selection["current"], {"text": "dev", "value": "dev"})
            self.assertEqual(selection["options"], [{"text": "dev", "value": "dev", "selected": True}])

        writes = list(self.server.writes)
        second = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "second.tfplan")
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn("No changes", second.stdout)
        reapplied = self.command("apply", "--plan", "second.tfplan")
        self.assertEqual(reapplied.returncode, 0, reapplied.stdout + reapplied.stderr)
        self.assertEqual(self.server.writes, writes)

        self.variables["health_origins"]["prod"] = "https://prod.example.test"
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        expanded = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "expand.tfplan")
        self.assertEqual(expanded.returncode, 0, expanded.stdout + expanded.stderr)
        self.assertEqual(self.server.writes, writes)
        result = self.command("apply", "--plan", "expand.tfplan")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.server.state["checks"]), 2)
        self.assertEqual(len(self.server.state["dashboards"]), 4)
        for check_id, check in checks.items():
            self.assertEqual(self.server.state["checks"][check_id], check)
        expanded_rules = {r["uid"]: r for r in self.server.state["groups"]["acttub-monitoring"]["rules"]}
        self.assertEqual(len(expanded_rules), 59)
        for rule in rules:
            if rule["labels"]["environment"] == "shared":
                rule["annotations"]["dashboard_url"] = rule["annotations"]["dashboard_url"].replace("var-environment=dev", "var-environment=prod")
            self.assertEqual(expanded_rules[rule["uid"]], rule)
        self.assertEqual(self.server.state["policies"], self.original["policies"])
        for resource, key in (("contacts", "unrelated"), ("dashboards", "foreign"), ("datasources", "foreign"), ("datasources", "cloud-existing")):
            self.assertEqual(self.server.state[resource][key], self.original[resource][key])

        stable = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "expanded-stable.tfplan")
        self.assertEqual(stable.returncode, 0, stable.stdout + stable.stderr)
        self.assertIn("No changes", stable.stdout)
        writes = list(self.server.writes)
        del self.variables["health_origins"]["prod"]
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        shrink = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "shrink.tfplan")
        self.assertNotEqual(shrink.returncode, 0)
        self.assertIn("prevent_destroy", shrink.stdout + shrink.stderr)
        self.assertEqual(self.server.writes, writes)

    def test_invalid_environment_sets_are_rejected_before_provider_writes(self):
        for origins in ({}, {"staging": "https://staging.example.test"},
                        {"dev": "https://dev.example.test", "preview": "https://preview.example.test"}):
            with self.subTest(origins=origins):
                self.variables["health_origins"] = origins
                (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
                result = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "invalid.tfplan")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("nonempty subset", result.stdout + result.stderr)
                self.assertEqual(self.server.writes, [])
                self.assertFalse((self.path / "invalid.tfplan.audit.json").exists())

    def test_dev_selection_keeps_reserved_prod_ownership_guards(self):
        self.variables["health_origins"] = {"dev": "https://dev.example.test"}
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        self.server.state["checks"]["42"] = {"id": 42, "job": "acttub-health-prod"}
        result = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "collision.tfplan")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Ownership collision: existing external health check", result.stderr)
        self.assertEqual(self.server.writes, [])
        self.server.state["checks"].clear()
        self.server.state["groups"]["foreign"] = {"rules": [{"uid": "acttub-api-errors-prod"}]}
        result = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "collision.tfplan")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Ownership collision: alert rule UID", result.stderr)
        self.assertEqual(self.server.writes, [])

    def test_existing_dashboard_without_owned_state_blocks_before_any_write(self):
        self.server.state["dashboards"]["acttub-service"] = {"dashboard": {"uid": "acttub-service", "title": "Someone else's dashboard"}, "meta": {}}
        plan = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "collision.tfplan")
        self.assertNotEqual(plan.returncode, 0)
        self.assertIn("Ownership collision", plan.stderr)
        self.assertEqual(self.server.writes, [])

    def test_drift_after_preview_blocks_apply_before_any_write(self):
        plan = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "drift.tfplan")
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        self.server.state["contacts"]["interloper"] = {"uid": "interloper", "name": "acttub-monitoring-slack", "type": "email", "settings": {"addresses": "fixture@example.test"}}
        result = self.command("apply", "--plan", "drift.tfplan")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.server.writes, [])

    def test_private_probe_is_rejected_for_public_availability(self):
        self.variables["probe_id"] = 2
        (self.path / "fixture.tfvars.json").write_text(json.dumps(self.variables))
        result = self.command("plan", "--vars", "fixture.tfvars.json", "--plan", "private.tfplan")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.server.writes, [])


if __name__ == "__main__":
    unittest.main()
