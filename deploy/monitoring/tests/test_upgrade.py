"""Releases rendered by older tool versions stay usable, and render ignores the caller's umask."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manage

FIXTURES = Path(__file__).resolve().parent / "fixtures"
LOGS = {"loki_url": "https://logs-prod-000.grafana.net/loki/api/v1/push", "loki_user": "123456",
        "environments": ["dev"], "journal_gid": 999}


class UpgradeTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.work = Path(work.name)
        self.state = self.work / "state"
        config = json.loads((manage.ROOT / "config.example.json").read_text())
        config.update(project="monitor-upgrade", retention_size="1GB", pdc_cluster="test", grafana_id="1", logs=LOGS)
        config["environments"] = {"dev": config["environments"]["dev"]}
        self.config = config
        self.secrets = self.work / "secrets"
        self.secrets.mkdir(mode=0o700)
        for name in ("dev-token", "pdc-token", "loki-token"):
            (self.secrets / name).write_text("secret-NEVER-PRINT-" + name)
            (self.secrets / name).chmod(0o600)

    def render(self, version):
        (self.work / "config.json").write_text(json.dumps(self.config))
        args = SimpleNamespace(config=self.work / "config.json", secrets_dir=self.secrets, state_dir=self.state)
        manage.render(args, self.state / "releases" / version)
        return self.state / "releases" / version

    def legacy(self, version):
        """A release as the SOMA-1095 tool left it: logs without journal_gid, root Alloy, "alloy" volume."""
        release = self.render(version)
        for name in ("config.json", "compose.logs.yml", "compose.env"):
            (release / name).chmod(0o644)
        config = json.loads((release / "config.json").read_text())
        del config["logs"]["journal_gid"]
        (release / "config.json").write_text(json.dumps(config))
        shutil.copyfile(FIXTURES / "compose.logs.soma1095.yml", release / "compose.logs.yml")
        env = (release / "compose.env").read_text().splitlines()
        (release / "compose.env").write_text("\n".join(line for line in env if not line.startswith("JOURNAL_GID=")) + "\n")
        return release

    @staticmethod
    def fake_docker(command, purpose, timeout=120):
        # Real Compose model; pinned-image probes and container starts are faked.
        if command[:2] == ["docker", "compose"] and "config" in command:
            return subprocess.run(command, capture_output=True, text=True, check=True).stdout
        return "permitremoteopen prometheus:9090\n" if "-G" in command else ""

    def test_upgrade_from_and_rollback_to_a_release_without_journal_gid(self):
        old = self.legacy("old")
        self.assertNotIn("journal_gid", json.loads((old / "config.json").read_text())["logs"])
        self.assertEqual(manage.validate(old)["services"]["alloy"].get("user"), None)
        new = self.render("new")
        args = SimpleNamespace(state_dir=self.state, without_pdc=False, command="apply")
        with patch.object(manage, "run", side_effect=self.fake_docker):
            manage.apply(args, old)
            manage.apply(args, new)
            self.assertEqual(((self.state / "current").read_text().strip(), (self.state / "previous").read_text().strip()),
                             ("new", "old"))
            args.command = "rollback"
            manage.apply(args, old)
            self.assertEqual(((self.state / "current").read_text().strip(), (self.state / "previous").read_text().strip()),
                             ("old", "new"))
            args.command = "apply"
            manage.apply(args, new)
            self.assertEqual((self.state / "current").read_text().strip(), "new")
        healthy = [{"metric": {"job": job, "environment": env}, "value": [0, "1"]}
                   for job, env in [("api", "dev"), ("db-health", ""), ("backup", ""), ("node", "shared"), ("prometheus", "shared")]]

        def query(_release, expression):
            if expression == "up":
                return {"result": healthy}
            if expression.startswith("acttub_"):
                return {"result": [{"metric": {"environment": "dev"}, "value": [0, "1"]}]}
            return {"result": [{"value": [0, "1"]}]}

        with patch.object(manage, "query", side_effect=query):
            for release in (old, new):
                manage.verify(release)

    def test_older_shape_is_not_a_loophole(self):
        old = self.legacy("old")
        model = manage.validate(old)
        for change in ("journal-bind", "new-volume-path", "extra-group"):
            altered = json.loads(json.dumps(model))
            alloy = altered["services"]["alloy"]
            if change == "journal-bind":
                alloy["volumes"].append({"type": "bind", "source": "/var/log/journal", "target": "/var/log/journal", "read_only": True})
            elif change == "new-volume-path":
                alloy["volumes"] = [v if v["type"] != "volume" else {**v, "target": "/var/lib/alloy/data"} for v in alloy["volumes"]]
            else:
                alloy["group_add"] = ["999"]
            with self.subTest(change=change), patch.object(manage, "run", return_value=json.dumps(altered)), \
                    self.assertRaises(manage.ConfigError):
                manage.validate(old)
        # A new render still requires journal_gid.
        self.config["logs"] = {k: v for k, v in LOGS.items() if k != "journal_gid"}
        with self.assertRaisesRegex(manage.ConfigError, "journal_gid"):
            self.render("no-gid")

    def test_render_modes_ignore_umask(self):
        previous = os.umask(0o077)
        try:
            release = self.render("strict-umask")
        finally:
            os.umask(previous)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        directories = [release.parent, release, *(p for p in release.rglob("*") if p.is_dir())]
        self.assertEqual({p.name: p.stat().st_mode & 0o777 for p in directories},
                         {p.name: 0o755 for p in directories})
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o444 for p in release.rglob("*") if p.is_file()))


if __name__ == "__main__":
    unittest.main()
