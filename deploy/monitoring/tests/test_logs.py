"""Optional Alloy log shipping: rendered release, socket-proxy boundary and line filters."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manage

LOGS = {"loki_url": "https://logs-prod-000.grafana.net/loki/api/v1/push", "loki_user": "123456",
        "environments": ["dev"]}


def alloy_stages():
    """(kind, pattern, replacement) in config.alloy order; Alloy string escapes match JSON's."""
    source = (manage.ROOT / "config.alloy").read_text()
    stages = []
    for kind, body in re.findall(r"stage\.(drop|replace) \{(.*?)\n  \}", source, re.S):
        expression = json.loads('"' + re.search(r'expression\s*=\s*"((?:[^"\\]|\\.)*)"', body).group(1) + '"')
        replacement = re.search(r'replace\s*=\s*"([^"]*)"', body)
        stages.append((kind, re.compile(expression), replacement and replacement.group(1)))
    return stages


def process(line):
    """Apply drop/replace stages like loki.process: every capture group is replaced."""
    for kind, pattern, replacement in alloy_stages():
        if kind == "drop":
            if pattern.search(line):
                return None
            continue
        def swap(match):
            text, start = match.group(0), match.start()
            for group in range(len(match.groups()), 0, -1):
                if match.start(group) >= 0:
                    a, b = match.start(group) - start, match.end(group) - start
                    text = text[:a] + replacement + text[b:]
            return text
        line = pattern.sub(swap, line)
    return line


class LogsReleaseTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.work = Path(work.name)
        self.config = json.loads((manage.ROOT / "config.example.json").read_text())
        self.config.update(project="monitor-logs", retention_size="1GB", pdc_cluster="test", grafana_id="1", logs=LOGS)
        self.secrets = self.work / "secrets"
        self.secrets.mkdir(mode=0o700)
        for name in ("dev-token", "prod-token", "pdc-token", "loki-token"):
            (self.secrets / name).write_text("secret-NEVER-PRINT-" + name)
            (self.secrets / name).chmod(0o600)

    def render(self, config, version="v1"):
        (self.work / "config.json").write_text(json.dumps(config))
        result = subprocess.run([sys.executable, str(manage.ROOT / "manage.py"), "--config", str(self.work / "config.json"),
                                 "--secrets-dir", str(self.secrets), "--state-dir", str(self.work / "state"),
                                 "render", version], capture_output=True, text=True)
        self.assertNotIn("secret-NEVER-PRINT", result.stdout + result.stderr)
        return result, self.work / "state/releases" / version

    def test_logs_release_gives_the_socket_only_to_the_read_only_proxy(self):
        result, release = self.render(self.config)
        self.assertEqual(result.returncode, 0, result.stderr)
        model = manage.validate(release)
        self.assertEqual(set(model["services"]["alloy"]["networks"]), {"logs", "docker-api"})
        self.assertEqual(set(model["services"]["socket-proxy"]["networks"]), {"docker-api"})
        self.assertTrue(model["networks"]["docker-api"]["internal"])
        self.assertNotIn("secret-NEVER-PRINT", json.dumps(model))
        sockets = [(name, v) for name, service in model["services"].items()
                   for v in service.get("volumes", []) if "docker.sock" in v["source"]]
        self.assertEqual([(name, v["read_only"]) for name, v in sockets], [("socket-proxy", True)])
        alloy = (release / "alloy/config.alloy").read_text()
        self.assertEqual(alloy.count('"tcp://socket-proxy:2375"'), 2)
        self.assertNotIn("docker.sock", alloy)
        self.assertIn('regex         = "acttub-dev"', alloy)
        self.assertNotIn("acttub-prod", alloy)
        self.assertIn(LOGS["loki_url"], alloy)
        self.assertNotRegex(alloy, r"@[A-Z_]+@")
        self.assertEqual((release / "alloy/loki-token").stat().st_mode & 0o777, 0o444)
        # The pinned Alloy binary must accept the rendered pipeline.
        manage.run(["docker", "run", "--rm", "--network", "none", "-v", str(release / "alloy") + ":/etc/acttub:ro",
                    model["services"]["alloy"]["image"], "validate", "/etc/acttub/config.alloy"], "alloy validate")

        allow_get = re.compile(manage.SOCKET_PROXY_COMMAND[2].split("=", 1)[1])
        cid = "a" * 64
        for path in ("/_ping", "/v1.51/networks", "/v1.51/containers/json", f"/v1.51/containers/{cid}/json", f"/v1.51/containers/{cid}/logs"):
            self.assertTrue(allow_get.fullmatch(path), path)
        for path in (f"/v1.51/containers/{cid}/archive", f"/v1.51/containers/{cid}/export", "/v1.51/images/json",
                     "/v1.51/secrets", "/v1.51/networks/x", "/v1.51/containers/json/../../exec", f"/v1.51/containers/{cid}/logs/x"):
            self.assertFalse(allow_get.fullmatch(path), path)

        unsafe = []
        for change in ("socket-on-alloy", "socket-elsewhere", "socket-writable", "proxy-allows-post", "proxy-any-client",
                       "proxy-outbound", "docker-api-routable", "public-listen", "extra-network", "no-memory-limit"):
            altered = json.loads(json.dumps(model))
            alloy_service, proxy = altered["services"]["alloy"], altered["services"]["socket-proxy"]
            socket = next(v for v in proxy["volumes"] if "docker.sock" in v["source"])
            if change == "socket-on-alloy":
                alloy_service["volumes"].append(dict(socket))
            elif change == "socket-elsewhere":
                altered["services"]["node"]["volumes"].append(dict(socket))
            elif change == "socket-writable":
                socket["read_only"] = False
            elif change == "proxy-allows-post":
                proxy["command"].append("-allowPOST=.*")
            elif change == "proxy-any-client":
                proxy["command"][1] = "-allowfrom=0.0.0.0/0"
            elif change == "proxy-outbound":
                proxy["networks"]["logs"] = None
            elif change == "docker-api-routable":
                altered["networks"]["docker-api"]["internal"] = False
            elif change == "public-listen":
                alloy_service["command"][3] = "--server.http.listen-addr=0.0.0.0:12345"
            elif change == "extra-network":
                alloy_service["networks"]["collectors"] = None
            else:
                proxy.pop("mem_limit")
            with patch.object(manage, "run", return_value=json.dumps(altered)):
                try:
                    manage.validate(release)
                except manage.ConfigError:
                    continue
            unsafe.append(change)
        self.assertEqual(unsafe, [])

    def test_without_logs_no_alloy_and_bad_logs_config_is_refused(self):
        config = {k: v for k, v in self.config.items() if k != "logs"}
        result, release = self.render(config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((release / "compose.logs.yml").exists())
        self.assertNotIn("alloy", manage.validate(release)["services"])
        self.assertEqual(manage.compose(release, "ps").count("-f"), 1)
        for bad in ({**LOGS, "loki_url": "http://logs-prod-000.grafana.net/loki/api/v1/push"},
                    {**LOGS, "loki_user": "user"}, {**LOGS, "environments": []},
                    {**LOGS, "environments": ["staging"]}, {**LOGS, "environments": ["dev", "dev"]}, []):
            with self.subTest(bad=bad):
                result, release = self.render({**self.config, "logs": bad}, "bad")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(release.exists())
        (self.secrets / "loki-token").unlink()
        result, _ = self.render(self.config, "no-token")
        self.assertIn("loki-token", result.stderr)


class LogLineFilterTest(unittest.TestCase):
    def test_noise_is_dropped_and_secrets_are_masked(self):
        cases = {
            '10.0.0.1 "GET /health HTTP/1.1" 200 120 0.003 "web:3000" 200': None,
            '10.0.0.1 "HEAD /actuator/health HTTP/1.1" 200 0 0.001 "api:8080" 200': None,
            '10.0.0.1 "GET /healthy-recipes HTTP/1.1" 200 1 0.1 "web:3000" 200':
                '10.0.0.1 "GET /healthy-recipes HTTP/1.1" 200 1 0.1 "web:3000" 200',
            '10.0.0.1 "GET /v2/auth/callback?code=abc123&state=xyz HTTP/1.1" 302 0 0.1 "api:8080" 302':
                '10.0.0.1 "GET /v2/auth/callback HTTP/1.1" 302 0 0.1 "api:8080" 302',
            # JSON nginx/api lines (SOMA-1094 format).
            '{"time":"2026-11-23T11:00:00+09:00","trace_id":"' + "a" * 32 + '","port":"3000","method":"GET","path":"/health","status":"200"}': None,
            '{"@timestamp":"2026-11-23T02:00:00Z","level":"INFO","message":"request","method":"GET","route":"/actuator/prometheus","status":200}': None,
            '{"time":"t","trace_id":"' + "b" * 32 + '","port":"8080","method":"GET","path":"/healthy","status":"200"}':
                '{"time":"t","trace_id":"' + "b" * 32 + '","port":"8080","method":"GET","path":"/healthy","status":"200"}',
            '{"@timestamp":"2026-11-23T02:00:00Z","level":"INFO","logger_name":"com.acttub.x","message":"request","trace_id":"c1","user_id":"7f9c4e2a-1b3d-4c5e-8f9a-0b1c2d3e4f5a","route":"/v2/scripts/{id}","status":200,"took_ms":12}':
                '{"@timestamp":"2026-11-23T02:00:00Z","level":"INFO","logger_name":"com.acttub.x","message":"request","trace_id":"c1","user_id":"7f9c4e2a-1b3d-4c5e-8f9a-0b1c2d3e4f5a","route":"/v2/scripts/{id}","status":200,"took_ms":12}',
            # nginx error lines keep the full request line, query included.
            '2026/11/23 11:00:00 [error] 29#29: *7 connect() failed (111), client: 172.18.0.5, server: , '
            'request: "GET /v2/search?q=%EC%B6%98%ED%96%A5 HTTP/1.1", upstream: "http://172.18.0.3:3000/v2/search?q=x", '
            'host: "acttub.com", referrer: "https://acttub.com/s?q=y"':
                '2026/11/23 11:00:00 [error] 29#29: *7 connect() failed (111), client: 172.18.0.5, server: , '
                'request: "GET /v2/search HTTP/1.1", upstream: "http://172.18.0.3:3000/v2/search", '
                'host: "acttub.com", referrer: "https://acttub.com/s"',
            "upload https://b.s3.amazonaws.com/k?X-Amz-Credential=AKIA/x&X-Amz-Signature=deadbeef done":
                "upload https://b.s3.amazonaws.com/k?X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED] done",
            "Authorization: Bearer abc.def-ghi rejected": "Authorization: Bearer [REDACTED] rejected",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl expired": "jwt [REDACTED] expired",
            '{"level":"WARN","token":"s3cr3t","user_id":"7f9c"}': '{"level":"WARN","token":"[REDACTED]","user_id":"7f9c"}',
            "mail to actor.kim+1@example.co.kr failed": "mail to [EMAIL] failed",
            "practice 7f9c4e2a-1b3d-4c5e-8f9a-0b1c2d3e4f5a analyzed in 812 ms":
                "practice 7f9c4e2a-1b3d-4c5e-8f9a-0b1c2d3e4f5a analyzed in 812 ms",
        }
        for line, expected in cases.items():
            with self.subTest(line=line):
                self.assertEqual(process(line), expected)


if __name__ == "__main__":
    unittest.main()
