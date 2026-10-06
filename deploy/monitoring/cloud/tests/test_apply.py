"""apply.py renders the owned configuration and talks only to a disposable HTTP boundary, never Cloud."""
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from unittest import mock
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import apply  # noqa: E402

SM = "/api/datasources/proxy/uid/sm-ds/sm"


def config(**origins):
    return {"grafana_url": "https://example.grafana.net", "health_origins": origins or {"dev": "https://dev.example.test", "prod": "https://prod.example.test"},
            "probe_id": 1, "synthetic_datasource_uid": "cloud-metrics", "site": "home", "disk_mountpoint": "/",
            "runbook_url": "https://github.com/acttub/acttub-platform/blob/dev/docs/deploy/MONITORING-CLOUD.md"}


class RenderTest(unittest.TestCase):
    def test_two_environments_render_59_rules_three_dashboards_two_checks_with_prod_landing(self):
        c = config()
        rules = apply.render_group(c)["rules"]
        self.assertEqual(len(rules), 59)
        self.assertEqual(len({r["uid"] for r in rules}), 59)
        dashboards = apply.render_dashboards(c)
        self.assertEqual(sorted(dashboards), ["acttub-infrastructure", "acttub-operations", "acttub-service"])
        for d in dashboards.values():
            self.assertEqual((d["timezone"], d["time"]["from"]), ("Asia/Seoul", "now-1h"))
            self.assertEqual(d["templating"]["list"][0]["name"], "environment")
            self.assertEqual(d["templating"]["list"][0]["current"]["value"], "prod")
            self.assertNotIn("${", json.dumps(d))
        self.assertEqual(sorted(apply.render_checks(c)), ["acttub-health-dev", "acttub-health-prod"])

    def test_single_environment_is_a_clean_subset(self):
        for env, other in (("dev", "prod"), ("prod", "dev")):
            c = config(**{env: "https://" + env + ".example.test"})
            rules = apply.render_group(c)["rules"]
            self.assertEqual(len(rules), 37)
            self.assertTrue(all(r["labels"]["environment"] in (env, "shared") for r in rules))
            self.assertEqual(sorted(apply.render_checks(c)), ["acttub-health-" + env])
            if env == "dev":
                for d in apply.render_dashboards(c).values():
                    self.assertNotIn("prod", json.dumps(d))
            self.assertTrue(all("var-environment=" + env in r["annotations"]["dashboard_url"] for r in rules))

    def test_only_datasource_rules_alert_on_error_or_nodata_and_every_rule_routes_to_slack_hourly(self):
        for r in apply.render_group(config())["rules"]:
            special = r["uid"].startswith(("acttub-datasource-", "acttub-cloud-datasource-"))
            self.assertEqual(r["noDataState"], "Alerting" if special else "KeepLast", r["uid"])
            self.assertEqual(r["execErrState"], "Alerting" if special else "KeepLast", r["uid"])
            n = r["notification_settings"]
            self.assertEqual((n["receiver"], n["group_wait"], n["group_interval"], n["repeat_interval"]), ("acttub-monitoring-slack", "10s", "1m", "1h"))
            self.assertTrue({"environment", "site", "datasource"} <= set(n["group_by"]))

    def test_slack_annotations_carry_unit_criterion_and_only_explanatory_conditions(self):
        rules = {r["uid"]: r["annotations"] for r in apply.render_group(config())["rules"]}
        memory, missing, flag, backup = (rules["acttub-" + k] for k in ("memory-shared", "api-metric-dev", "collect-api-dev", "backup-age-prod"))
        self.assertEqual((memory["criterion"], memory["observed_value"]), ("10% 미만, 5분 지속", '{{ printf "%.1f" $values.A.Value }}%'))
        self.assertNotIn("detail", memory)
        self.assertEqual((missing["criterion"], missing["observed_value"]), ("1개 이상, 2분 지속", '{{ printf "%.0f" $values.A.Value }}개'))
        self.assertIn("Hikari", missing["detail"])
        self.assertEqual(flag["criterion"], "2분 지속")
        self.assertNotIn("observed_value", flag)
        self.assertEqual(backup["criterion"], "26시간 초과")
        self.assertEqual({d["unit"] for d in json.loads((ROOT / "rules.json").read_text())} - {"", "%", "초", "건", "회", "개"}, set())

    def test_health_check_accepts_only_the_real_health_contract(self):
        pattern = apply.render_checks(config())["acttub-health-prod"]["settings"]["http"]["failIfBodyNotMatchesRegexp"][0]
        ok = '{"status":"ok","services":["summary","coach","report"],"model":"test","keep_alive":false,"commit":"unknown"}'
        self.assertTrue(re.search(pattern, ok))
        self.assertFalse(re.search(pattern, '{"status":"down","nested":{"status":"ok"}}'))
        self.assertFalse(re.search(pattern, '<html>"status":"ok"</html>'))

    def test_bad_configuration_is_rejected(self):
        for bad in ({"health_origins": {}}, {"health_origins": {"staging": "https://x.test"}}, {"health_origins": {"dev": "https://x.test/"}},
                    {"probe_id": 0}, {"disk_mountpoint": "/(.*)"}):
            with self.subTest(bad=bad), tempfile.NamedTemporaryFile("w", suffix=".json") as f:
                json.dump({**config(), **bad}, f)
                f.flush()
                with self.assertRaises(ValueError):
                    apply.load_config(f.name)


class FakeGrafana(BaseHTTPRequestHandler):
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
        s, path = self.server.state, unquote(urlsplit(self.path).path)
        if self.headers.get("Authorization") != "Bearer test-token":
            return self.reply({"message": "unauthorized"}, 401)
        routes = {
            "/api/datasources": s["datasources"],
            "/api/v1/provisioning/contact-points": s["contacts"],
            "/api/v1/provisioning/alert-rules": [r for g in s["groups"].values() for r in g["rules"]],
            SM + "/check/list": list(s["checks"].values()),
            SM + "/probe/list": [{"id": 1, "public": True}, {"id": 2, "public": False}],
        }
        if path in routes:
            return self.reply(routes[path])
        for prefix, table in (("/api/datasources/uid/", "ds_by_uid"), ("/api/folders/", "folders"), ("/api/dashboards/uid/", "dashboards"),
                              ("/api/v1/provisioning/folder/acttub-monitoring/rule-groups/", "groups"), ("/api/v1/provisioning/templates/", "templates")):
            if path.startswith(prefix):
                value = s[table].get(path[len(prefix):])
                return self.reply(value, 200) if value is not None else self.reply({"message": "not found"}, 404)
        self.reply({"message": "unsupported " + path}, 404)

    def do_POST(self):
        self.write()

    def do_PUT(self):
        self.write()

    def write(self):
        s, path = self.server.state, unquote(urlsplit(self.path).path)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        s["writes"].append((self.command, path))
        if path == "/api/folders":
            s["folders"][body["uid"]] = {"uid": body["uid"], "title": body["title"]}
        elif path == "/api/dashboards/db":
            d = body["dashboard"]
            old = s["dashboards"].get(d["uid"])
            if old and not body["overwrite"] and d["version"] != old["dashboard"]["version"]:
                return self.reply({"message": "version-mismatch"}, 412)
            d = dict(d, id=old["dashboard"]["id"] if old else 100 + len(s["dashboards"]), version=(old["dashboard"]["version"] + 1) if old else 1)
            s["dashboards"][d["uid"]] = {"dashboard": d, "meta": {"folderUid": body["folderUid"]}}
        elif path.startswith("/api/v1/provisioning/folder/acttub-monitoring/rule-groups/"):
            body["rules"] = [dict(r, id=i, orgID=1, updated="now") for i, r in enumerate(body["rules"])]
            s["groups"][path.rsplit("/", 1)[-1]] = body
        elif path.startswith("/api/v1/provisioning/templates/"):
            name = path.rsplit("/", 1)[-1]
            s["templates"][name] = {"name": name, "template": body["template"].strip(), "version": "v%d" % len(s["writes"])}
        elif path == SM + "/check/add":
            s["checks"][body["job"]] = dict(body, id=len(s["checks"]) + 1, tenantId=9, created=1.0)
        elif path == SM + "/check/update":
            s["checks"][body["job"]] = body
        else:
            return self.reply({"message": "unsupported write " + path}, 404)
        self.reply({"status": "success"})


class ApplyTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGrafana)
        self.server.state = {
            "datasources": [{"uid": "acttub-local-prometheus", "type": "prometheus"}, {"uid": "sm-ds", "type": "synthetic-monitoring-datasource"}],
            "ds_by_uid": {"acttub-local-prometheus": {"uid": "acttub-local-prometheus"}},
            "contacts": [{"name": "acttub-monitoring-slack", "uid": "slack"}],
            "folders": {}, "dashboards": {"foreign": {"dashboard": {"uid": "foreign", "id": 7, "version": 3}, "meta": {"folderUid": "finance"}}},
            "groups": {}, "templates": {}, "checks": {"other": {"job": "other", "id": 99}}, "writes": [],
        }
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.work = tempfile.TemporaryDirectory()
        self.cfg = Path(self.work.name) / "cloud.json"
        self.cfg.write_text(json.dumps(dict(config(), grafana_url="http://127.0.0.1:%d" % self.server.server_port)))
        self.env = mock.patch.dict(os.environ, {"GRAFANA_TOKEN": "test-token"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.work.cleanup()

    def run_cli(self, action):
        out = io.StringIO()
        with redirect_stdout(out), mock.patch.object(Path, "mkdir"), mock.patch.object(Path, "write_text"), mock.patch.object(Path, "chmod"):
            apply.main([action, "--config", str(self.cfg)])
        return out.getvalue()

    def test_diff_never_writes(self):
        output = self.run_cli("diff")
        self.assertIn('"acttub-health-prod"', output)
        self.assertEqual(self.server.state["writes"], [])

    def test_first_apply_creates_everything_then_nothing_is_left_and_foreign_objects_are_untouched(self):
        foreign = copy.deepcopy((self.server.state["dashboards"]["foreign"], self.server.state["checks"]["other"]))
        self.run_cli("apply")
        s = self.server.state
        self.assertEqual(len(s["groups"]["acttub-monitoring"]["rules"]), 59)
        self.assertEqual(sorted(k for k in s["dashboards"] if k != "foreign"), ["acttub-infrastructure", "acttub-operations", "acttub-service"])
        self.assertEqual(sorted(k for k in s["checks"] if k != "other"), ["acttub-health-dev", "acttub-health-prod"])
        self.assertEqual((s["dashboards"]["foreign"], s["checks"]["other"]), foreign)
        self.assertEqual(s["templates"]["acttub-slack"]["template"], (ROOT / "slack.tmpl").read_text().strip())
        writes = len(s["writes"])
        self.assertIn("No changes.", self.run_cli("apply"))
        self.assertEqual(len(s["writes"]), writes)

    def test_ui_edit_of_an_owned_dashboard_is_reported_and_reverted(self):
        self.run_cli("apply")
        self.server.state["dashboards"]["acttub-service"]["dashboard"]["title"] = "edited in UI"
        self.assertIn('"acttub-service"', self.run_cli("diff"))
        self.run_cli("apply")
        self.assertEqual(self.server.state["dashboards"]["acttub-service"]["dashboard"]["title"], "Acttub · 서비스 전체")

    def test_contact_point_not_calling_the_template_is_reported_never_written(self):
        output = self.run_cli("diff")
        self.assertTrue(json.loads(output[:output.index("}") + 1])["contact_unwired"])
        self.server.state["contacts"][0]["settings"] = {"title": apply.TEMPLATE_CALLS[0], "text": apply.TEMPLATE_CALLS[1]}
        self.run_cli("apply")
        output = self.run_cli("diff")
        self.assertFalse(json.loads(output[:output.index("}") + 1])["contact_unwired"])
        self.assertIn("No changes.", output)
        self.assertFalse(any("contact-points" in path for _, path in self.server.state["writes"]))

    def test_missing_one_time_setup_stops_before_any_write(self):
        self.server.state["contacts"] = []
        with self.assertRaisesRegex(RuntimeError, "contact point"):
            self.run_cli("apply")
        self.assertEqual(self.server.state["writes"], [])

    def test_owned_dashboard_in_another_folder_stops_before_any_write(self):
        self.server.state["dashboards"]["acttub-service"] = {"dashboard": {"uid": "acttub-service", "id": 1, "version": 1}, "meta": {"folderUid": "someone-else"}}
        with self.assertRaisesRegex(RuntimeError, "outside"):
            self.run_cli("apply")
        self.assertEqual(self.server.state["writes"], [])

    def test_dropped_environment_check_is_reported_not_deleted(self):
        self.run_cli("apply")
        self.cfg.write_text(json.dumps(dict(json.loads(self.cfg.read_text()), health_origins={"dev": "https://dev.example.test"})))
        output = self.run_cli("apply")
        self.assertIn("acttub-health-prod", json.loads(output[:output.index("}") + 1])["checks_unmanaged"])
        self.assertIn("acttub-health-prod", self.server.state["checks"])


if __name__ == "__main__":
    unittest.main()
