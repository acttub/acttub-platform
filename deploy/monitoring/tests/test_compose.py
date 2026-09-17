"""Rendered Compose is the deployment boundary; never print resolved secrets."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manage

ROOT = Path(__file__).resolve().parents[1]


class ComposeContractTest(unittest.TestCase):
    def test_selected_environments_have_only_their_resources_and_secrets(self):
        for selected in [("dev",), ("prod",), ("dev", "prod")]:
            with self.subTest(selected=selected), tempfile.TemporaryDirectory() as tmp:
                work = Path(tmp)
                config = json.loads((ROOT / "config.example.json").read_text())
                config.update(project="monitor-contract", retention_size="1GB", pdc_cluster="test", grafana_id="1")
                config["environments"] = {env: config["environments"][env] for env in selected}
                (work / "config.json").write_text(json.dumps(config))
                secrets = work / "secrets"
                secrets.mkdir(mode=0o700)
                for name in [*(env + "-token" for env in selected), "pdc-token"]:
                    (secrets / name).write_text("secret-NEVER-PRINT-" + name)
                    (secrets / name).chmod(0o600)
                command = [sys.executable, str(ROOT / "manage.py"), "--config", str(work / "config.json"),
                           "--secrets-dir", str(secrets), "--state-dir", str(work / "state"), "render", "v1"]
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn("secret-NEVER-PRINT", result.stdout + result.stderr)
                release = work / "state/releases/v1"
                # Real Compose resolves the template and validate checks security,
                # external resources and stable metrics storage for every subset.
                model = manage.validate(release)
                self.assertEqual(set(model["networks"]), {"query", "collectors"} | {env + "_scrape" for env in selected})
                self.assertEqual(set(model["volumes"]), {"metrics"} | {env + "_backup_state" for env in selected})
                self.assertEqual(model["volumes"]["metrics"]["name"], "monitor-contract_metrics")
                for name in ("db", "backup"):
                    self.assertEqual(set(json.loads((release / name / "config.json").read_text())), set(selected))
                for name in ("db", "prometheus"):
                    self.assertEqual({p.name for p in (release / name).glob("*-token")}, {env + "-token" for env in selected})
                jobs = json.loads((release / "prometheus/prometheus.json").read_text())["scrape_configs"]
                api_jobs = [job for job in jobs if job["job_name"].startswith("api-")]
                self.assertEqual({job["job_name"] for job in api_jobs}, {"api-" + env for env in selected})
                for job in api_jobs:
                    env = job["static_configs"][0]["labels"]["environment"]
                    self.assertEqual(job["static_configs"][0]["targets"], [config["environments"][env]["project"] + "-api:9091"])
                before = {p.relative_to(release): p.read_bytes() for p in release.rglob("*") if p.is_file()}
                duplicate = subprocess.run(command, capture_output=True, text=True)
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertEqual(before, {p.relative_to(release): p.read_bytes() for p in release.rglob("*") if p.is_file()})
                self.assertEqual((work / "state").stat().st_mode & 0o777, 0o700)
                self.assertTrue(all(p.stat().st_mode & 0o777 == 0o444 for p in release.rglob("*") if p.is_file()))
                if selected == ("dev",):
                    # Accidental prod attachment or a mount of prod state must be
                    # rejected even if it remains read-only and unpublished.
                    for extra in ("network", "volume", "mount"):
                        altered = json.loads(json.dumps(model))
                        if extra == "network":
                            altered["networks"]["prod_scrape"] = {"external": True, "name": "acttub-prod_scrape"}
                        elif extra == "volume":
                            altered["volumes"]["prod_backup_state"] = {"external": True, "name": "acttub-prod_backup_state"}
                        else:
                            altered["services"]["backup-exporter"]["volumes"].append({"type": "volume", "source": "prod_backup_state", "target": "/state/prod", "read_only": True})
                        with patch.object(manage, "run", return_value=json.dumps(altered)), self.assertRaises(manage.ConfigError):
                            manage.validate(release)

    def test_app_owns_scrape_network_and_missing_monitoring_token_does_not_block_deploy(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            required = ["POSTGRES_PASSWORD", "JWT_SECRET", "ADMIN_OPS_TOKEN", "GEMINI_API_KEY",
                        "OPENAI_API_KEY", "S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID",
                        "AWS_SECRET_ACCESS_KEY", "TUNNEL_TOKEN"]
            (work / ".env").write_text("COMPOSE_PROJECT_NAME=test-dev\n" + "\n".join(key + "=test-only" for key in required))
            (work / "release.env").write_text("API_IMAGE=test/api:local\nWEB_IMAGE=test/web:local\n")
            (work / "compose.yml").write_text((ROOT.parent / "home/compose.yml").read_text())
            result = subprocess.run(["docker", "compose", "--env-file", str(work / ".env"),
                                     "--env-file", str(work / "release.env"), "-f", str(work / "compose.yml"),
                                     "config", "--format", "json"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            model = json.loads(result.stdout)
            api = model["services"]["api"]
            self.assertEqual(set(api["networks"]), {"default", "scrape"})
            self.assertEqual(api["networks"]["scrape"]["aliases"], ["test-dev-api"])
            self.assertEqual(api["environment"]["MANAGEMENT_SERVER_PORT"], "9091")
            self.assertEqual(api["environment"]["MONITORING_TOKEN"], "")
            self.assertFalse(model["networks"]["scrape"].get("external", False))
            for name, service in model["services"].items():
                if name != "api":
                    self.assertEqual(set(service["networks"]), {"default"})

    def test_rendered_project_is_isolated_and_has_a_bounded_persistent_store(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            cfg = {
                "project": "monitor-contract", "retention_size": "1GB", "data_mountpoint": "/",
                "pdc_cluster": "test", "grafana_id": "1",
                "environments": {env: {"project": f"test-{env}", "backup_bucket": "test-backups", "database": "acttub"}
                                 for env in ("dev", "prod")},
            }
            (work / "config.json").write_text(json.dumps(cfg))
            secrets = work / "secrets"
            secrets.mkdir(mode=0o700)
            for name in ("dev-token", "prod-token", "pdc-token"):
                (secrets / name).write_text("secret-NEVER-PRINT-" + name)
                (secrets / name).chmod(0o600)
            result = subprocess.run([sys.executable, str(ROOT / "manage.py"), "--config", str(work / "config.json"),
                                     "--secrets-dir", str(secrets), "--state-dir", str(work / "state"),
                                     "render", "test-v1"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("secret-NEVER-PRINT", result.stdout + result.stderr)
            release = work / "state/releases/test-v1"
            validate = [sys.executable, str(ROOT / "manage.py"), "--state-dir", str(work / "state"), "validate", "test-v1"]
            validation = subprocess.run(validate, capture_output=True, text=True)
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)
            result = subprocess.run(["docker", "compose", "--env-file", str(release / "compose.env"),
                                     "-f", str(release / "compose.yml"), "config", "--format", "json"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("secret-NEVER-PRINT", result.stdout)
            model = json.loads(result.stdout)
            services = model["services"]
            self.assertEqual(set(services["pdc"]["networks"]), {"query"})
            self.assertIn("-ssh-flag=-o PermitRemoteOpen=prometheus:9090", services["pdc"]["command"])
            self.assertIn("-use-gossh=false", services["pdc"]["command"])
            self.assertEqual(set(services["db-health"]["networks"]), {"collectors", "dev_scrape", "prod_scrape"})
            self.assertIn("--storage.tsdb.retention.time=30d", services["prometheus"]["command"])
            self.assertIn("--storage.tsdb.retention.size=1GB", services["prometheus"]["command"])
            self.assertTrue(any(v["type"] == "volume" and v["target"] == "/prometheus"
                                for v in services["prometheus"]["volumes"]))
            for service in services.values():
                self.assertFalse(service.get("ports"))
                self.assertNotIn("default", service["networks"])
                self.assertNotIn("docker.sock", json.dumps(service))
            backup = services["backup-exporter"]
            self.assertTrue(all(v["read_only"] for v in backup["volumes"]))
            self.assertFalse(backup.get("environment"))
            self.assertEqual(backup["user"], "0:0")
            self.assertEqual(backup["cap_drop"], ["ALL"])
            self.assertTrue(model["networks"]["dev_scrape"]["external"])
            self.assertTrue(model["networks"]["prod_scrape"]["external"])
            source = release / "compose.yml"
            original = source.read_text()
            source.chmod(0o600)
            for unsafe in [original.replace("PermitRemoteOpen=prometheus:9090", "PermitRemoteOpen=*:*"),
                           original.replace("networks: [query]\n", "networks: [query, dev_scrape]\n")]:
                source.write_text(unsafe)
                refused = subprocess.run(validate, capture_output=True, text=True)
                self.assertNotEqual(refused.returncode, 0, "unsafe PDC config was accepted")
                self.assertNotIn("secret-NEVER-PRINT", refused.stdout + refused.stderr)


if __name__ == "__main__":
    unittest.main()
