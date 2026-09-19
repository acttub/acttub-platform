"""Exercise the rendered PDC service's SSH tmpfs at the Compose/Docker boundary."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manage


class PdcTmpfsTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory(prefix="soma520-tmpfs-")
        self.addCleanup(work.cleanup)
        self.work = Path(work.name)
        config = json.loads((manage.ROOT / "config.example.json").read_text())
        config.update(project="soma520-tmpfs-" + uuid.uuid4().hex[:12], retention_size="1GB",
                      pdc_cluster="test", grafana_id="1")
        config["environments"] = {"dev": config["environments"]["dev"]}
        (self.work / "config.json").write_text(json.dumps(config))
        secrets = self.work / "secrets"
        secrets.mkdir(mode=0o700)
        for name in ("dev-token", "pdc-token"):
            (secrets / name).write_text("fixture-NEVER-PRINT-" + name)
            (secrets / name).chmod(0o600)
        self.release = self.work / "state/releases/v1"
        manage.render(SimpleNamespace(config=self.work / "config.json", secrets_dir=secrets,
                                      state_dir=self.work / "state"), self.release)
        self.source = self.release / "compose.yml"
        self.source.chmod(0o600)

    def command(self, *args):
        return subprocess.run(args, capture_output=True, text=True, timeout=120)

    def check_command(self, *args):
        result = self.command(*args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def docker_mount(self, malformed=False):
        model = json.loads(self.check_command(*manage.compose(self.release, "config", "--format", "json")))
        pdc = model["services"]["pdc"]
        # Keep the real image, mounts and security settings. Replace only the
        # tunnel process with a filesystem probe; no network or Cloud access.
        pdc.pop("networks")
        pdc.update(network_mode="none", restart="no", entrypoint=["/bin/sh", "-ec"],
                   command=["stat -c '%u:%g:%a' /home/pdc/.ssh; touch /home/pdc/.ssh/probe"])
        fixture = self.work / "pdc.json"
        fixture.write_text(json.dumps({"name": model["name"], "services": {"pdc": pdc}}))
        compose = ["docker", "compose", "-p", model["name"], "-f", str(fixture)]
        try:
            created = self.command(*compose, "create", "pdc")
            if malformed:
                self.assertNotEqual(created.returncode, 0, "Docker accepted the original split tmpfs")
                self.assertRegex(created.stderr, r"invalid mount path: '?(gid=30000|mode=0700)'?")
                self.assertIn("mount path must be absolute", created.stderr)
                print("PASS Docker rejected original split tmpfs: " + created.stderr.strip().splitlines()[-1])
                return
            self.assertEqual(created.returncode, 0, created.stdout + created.stderr)
            container = self.check_command(*compose, "ps", "-aq", "pdc")
            mount = json.loads(self.check_command("docker", "inspect", "--format", "{{json .HostConfig.Tmpfs}}", container))
            self.assertEqual(mount, {"/home/pdc/.ssh": "uid=30000,gid=30000,mode=0700"})
            self.assertEqual(self.check_command("docker", "start", "-a", container), "30000:30000:700")
            self.assertEqual(self.check_command("docker", "inspect", "--format", "{{.State.ExitCode}}", container), "0")
            print("PASS rendered PDC tmpfs: Docker create accepted uid/gid/mode; writable by 30000:30000 with mode 700")
        finally:
            self.check_command(*compose, "down", "--remove-orphans", "--timeout", "1")
            label = "label=com.docker.compose.project=" + model["name"]
            self.assertEqual(self.check_command("docker", "ps", "-aq", "--filter", label), "")

    def test_rendered_pdc_tmpfs_is_private_and_writable_in_docker(self):
        self.docker_mount()

    def test_original_unquoted_flow_list_is_rejected_by_docker(self):
        lines = self.source.read_text().splitlines(keepends=True)
        self.source.write_text("".join("    tmpfs: [/home/pdc/.ssh:uid=30000,gid=30000,mode=0700]\n"
                                       if line.startswith("    tmpfs:") else line for line in lines))
        self.docker_mount(malformed=True)

    def test_validation_rejects_missing_split_or_changed_private_tmpfs(self):
        original = self.source.read_text()
        prefix, tail = original.split("    tmpfs:", 1)
        _, suffix = tail.split("\n", 1)
        for mount in (None, "[/home/pdc/.ssh:uid=30000,gid=30000,mode=0700]",
                      '["/tmp/.ssh:uid=30000,gid=30000,mode=0700"]',
                      '["/home/pdc/.ssh:gid=30000,mode=0700"]',
                      '["/home/pdc/.ssh:uid=0,gid=30000,mode=0700"]',
                      '["/home/pdc/.ssh:uid=30000,gid=0,mode=0700"]',
                      '["/home/pdc/.ssh:uid=30000,gid=30000,mode=0755"]',
                      '["/home/pdc/.ssh:uid=30000,gid=30000,mode=0700", "/tmp"]'):
            with self.subTest(mount=mount):
                self.source.write_text(prefix + ("    tmpfs: " + mount + "\n" if mount else "") + suffix)
                with self.assertRaisesRegex(manage.ConfigError, "PDC SSH tmpfs"):
                    manage.validate(self.release)


if __name__ == "__main__":
    unittest.main()
