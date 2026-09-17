"""Release selection at config, Docker command and Prometheus response boundaries."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manage


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.state = Path(work.name)
        self.config = json.loads((manage.ROOT / "config.example.json").read_text())
        self.config.update(retention_size="1GB", pdc_cluster="test", grafana_id="1")

    def release(self, version, selected=("dev",)):
        release = self.state / "releases" / version
        release.mkdir(parents=True)
        config = {**self.config, "environments": {env: self.config["environments"][env] for env in selected}}
        (release / "config.json").write_text(json.dumps(config))
        return release

    def test_empty_unknown_and_malformed_environment_inputs_fail_before_render(self):
        for envs in ({}, {"staging": {}}, {"dev": self.config["environments"]["dev"], "unknown": {}},
                     None, [], ["dev"], "dev", {"dev": None}):
            with self.subTest(envs=envs):
                config = self.state / "config.json"
                config.write_text(json.dumps({**self.config, "environments": envs}))
                result = subprocess.run([sys.executable, str(manage.ROOT / "manage.py"), "--config", str(config),
                                         "--state-dir", str(self.state), "render", "invalid"], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.state / "releases/invalid").exists())
                self.assertNotIn("Traceback", result.stderr)

    def test_selected_tokens_remain_required_private_and_strict(self):
        config = self.state / "config.json"
        config.write_text(json.dumps({**self.config, "environments": {"dev": self.config["environments"]["dev"]}}))
        secrets = self.state / "secrets"
        secrets.mkdir(mode=0o700)
        args = SimpleNamespace(config=config, secrets_dir=secrets, state_dir=self.state)
        release = self.state / "releases/v1"
        for contents, mode in [(None, 0o600), ("private-NEVER-PRINT", 0o644), ("bad token-NEVER-PRINT", 0o600), ("short", 0o600)]:
            with self.subTest(mode=mode, missing=contents is None):
                if contents is not None:
                    (secrets / "dev-token").write_text(contents)
                    (secrets / "dev-token").chmod(mode)
                with self.assertRaises(manage.ConfigError) as error:
                    manage.render(args, release)
                self.assertNotIn("NEVER-PRINT", str(error.exception))
                self.assertFalse(release.exists())
        (secrets / "dev-token").write_text("private-NEVER-PRINT")
        with self.assertRaisesRegex(manage.ConfigError, "pdc-token"):
            manage.render(args, release)
        self.assertFalse(release.exists())

    def test_project_names_cannot_alias_selected_app_or_metrics_store(self):
        for selected in [("dev",), ("dev", "prod")]:
            release = self.release("names-" + str(len(selected)), selected)
            config = json.loads((release / "config.json").read_text())
            config["environments"]["dev"]["project"] = config["project"]
            (release / "config.json").write_text(json.dumps(config))
            with self.assertRaises(manage.ConfigError):
                manage.read_config(release / "config.json")
        config["environments"]["dev"]["project"] = config["environments"]["prod"]["project"]
        (release / "config.json").write_text(json.dumps(config))
        with self.assertRaises(manage.ConfigError):
            manage.read_config(release / "config.json")

    def test_apply_preflights_only_selected_resources_and_preserves_failure_pointers(self):
        dev = self.release("dev")
        both = self.release("both", ("dev", "prod"))
        args = SimpleNamespace(state_dir=self.state, without_pdc=True, command="apply")

        def model(selected):
            return {"name": self.config["project"],
                    "networks": {env + "_scrape": {"name": "acttub-" + env + "_scrape"} for env in selected},
                    "volumes": {env + "_backup_state": {"name": "acttub-" + env + "_backup_state"} for env in selected}}

        for release, selected in [(dev, ("dev",)), (both, ("dev", "prod")), (dev, ("dev",))]:
            with patch.object(manage, "check", return_value=model(selected)), patch.object(manage, "run") as run:
                manage.apply(args, release)
            commands = [call.args[0] for call in run.call_args_list]
            expected = []
            for env in selected:
                expected += [["docker", "network", "inspect", "acttub-" + env + "_scrape"],
                             ["docker", "volume", "inspect", "acttub-" + env + "_backup_state"]]
            self.assertEqual(commands[:-1], expected)
            self.assertEqual(commands[-1], manage.compose(release, "up", "-d", "--wait", "--wait-timeout", "120",
                                                          "prometheus", "node", "db-health", "backup-exporter"))
            self.assertEqual((self.state / "current").read_text().strip(), release.name)
        self.assertEqual((self.state / "previous").read_text().strip(), "both")
        next_dev = self.release("next-dev")
        for failure_call in (1, 2, 3):
            calls = 0

            def fail_command(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                if calls == failure_call:
                    raise manage.ConfigError("fixture command failure")
                return ""

            with patch.object(manage, "check", return_value=model(("dev",))), patch.object(manage, "run", side_effect=fail_command):
                with self.assertRaises(manage.ConfigError):
                    manage.apply(args, next_dev)
            self.assertEqual(calls, failure_call)
            self.assertEqual((self.state / "current").read_text().strip(), "dev")
            self.assertEqual((self.state / "previous").read_text().strip(), "both")
        changed_project = model(("dev",))
        changed_project["name"] = "new-metrics-project"
        with patch.object(manage, "check", return_value=changed_project), patch.object(manage, "run") as run:
            with self.assertRaises(manage.ConfigError):
                manage.apply(args, dev)
        run.assert_not_called()

    def test_verify_selected_health_ignores_retained_unselected_samples(self):
        for selected in [("dev",), ("dev", "prod")]:
            release = self.release("verify-" + str(len(selected)), selected)
            targets = [{"metric": {"job": job, "environment": env}, "value": [0, "1"]}
                       for job, env in [("api", env) for env in selected] + [
                           ("db-health", ""), ("backup", ""), ("node", "shared"), ("prometheus", "shared")]]
            probes = [{"metric": {"environment": env}, "value": [0, "1"]} for env in ("dev", "prod")]
            responses = {"up": {"result": targets}, **{key: {"result": probes} for key in (
                "acttub_db_probe_success", "acttub_backup_state_read_success", "acttub_backup_target_match")}}

            def query(_release, expression):
                return responses.get(expression, {"result": [{"value": [0, "123"]}]})

            with patch.object(manage, "validate"), patch.object(manage, "query", side_effect=query):
                manage.verify(release)
                for expression in responses:
                    original = responses[expression]
                    for missing in (True, False):
                        values = json.loads(json.dumps(original["result"]))
                        if missing:
                            values.pop(0)
                        else:
                            values[0]["value"][1] = "0"
                        responses[expression] = {"result": values}
                        with self.subTest(selected=selected, expression=expression, missing=missing), self.assertRaises(manage.ConfigError):
                            manage.verify(release)
                    responses[expression] = original


if __name__ == "__main__":
    unittest.main()
