#!/usr/bin/env python3
"""Isolated real deployment / HTTP / Prometheus / PostgreSQL integration test."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
ENV = {key: value for key, value in os.environ.items()
       if key in ("PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG")}


def run(argv: list, cwd=None, timeout=180, input=None) -> str:
    result = subprocess.run(argv, cwd=cwd, env=ENV, text=True, input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Only fixture credentials exist here, but still avoid dumping resolved config/logs.
        raise RuntimeError("command failed: " + " ".join(str(arg) for arg in argv[:4]) + " (output withheld)")
    return result.stdout


def wait_for(test, message: str, seconds=100):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        try:
            if test():
                return
        except (RuntimeError, KeyError, ValueError, IndexError):
            pass
        time.sleep(2)
    raise RuntimeError(message)


def main():
    api = os.environ.get("MONITORING_SMOKE_API_IMAGE")
    web = os.environ.get("MONITORING_SMOKE_WEB_IMAGE")
    if not api or not web:
        raise RuntimeError("set both MONITORING_SMOKE_API_IMAGE and MONITORING_SMOKE_WEB_IMAGE to prebuilt current app images")
    run(["docker", "image", "inspect", api, web])
    prefix = "soma520-smoke-" + str(os.getpid())
    work = Path(tempfile.mkdtemp(prefix=prefix + "-"))
    state = work / "monitoring"
    release = state / "releases/v1"
    projects = {env: prefix + "-" + env for env in ("dev", "prod")}
    monitor = prefix + "-monitor"
    app_dirs = {env: work / env for env in projects}
    manager = [sys.executable, str(ROOT / "manage.py"), "--state-dir", str(state)]

    def app(env, *args):
        directory = app_dirs[env]
        return ["docker", "compose", "--env-file", str(directory / ".env"), "--env-file", str(directory / "release.env"),
                "-f", str(directory / "compose.yml"), *args]

    def mon(*args):
        return ["docker", "compose", "--env-file", str(release / "compose.env"), "-f", str(release / "compose.yml"), *args]

    def deploy(env, sha="0123456789abcdef"):
        return run(["env", "DEPLOY_PULL_POLICY=missing", str(REPO / "deploy/home/deploy.sh"), sha, api, web], cwd=app_dirs[env])

    def prepare_app(env):
        directory = app_dirs[env]
        directory.mkdir()
        shutil.copyfile(REPO / "deploy/home/compose.yml", directory / "compose.yml")
        required = ["POSTGRES_PASSWORD", "JWT_SECRET", "ADMIN_OPS_TOKEN", "GEMINI_API_KEY", "OPENAI_API_KEY",
                    "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "TUNNEL_TOKEN"]
        values = {key: "smoke-only-unused" for key in required}
        values.update(COMPOSE_PROJECT_NAME=projects[env], AWS_REGION="ap-northeast-2", ANALYSIS_WORKER_ENABLED="false",
                      MONITORING_TOKEN="monitoring-smoke-only-" + env + "-token", MONITORING_ENVIRONMENT=env)
        (directory / ".env").write_text("\n".join(key + "=" + val for key, val in values.items()) + "\n")
        deploy(env)

    def prepare_backup(env):
        # Only isolated volumes created here. Real app volumes must already exist.
        run(["docker", "volume", "create", projects[env] + "_backup_state"])
        fixture = {"backup_target": "s3://test-backups/" + env + "/:acttub", "last_result": "success",
                   "last_success_epoch": int(time.time()) - 3600, "last_success_uri": "s3://DO-NOT-EXPORT/object",
                   "last_success_sha256": "DO-NOT-EXPORT-HASH"}
        run(["docker", "run", "--rm", "--network", "none", "-v", projects[env] + "_backup_state:/state", python_image,
             "python3", "-c", "import os,pathlib,sys; os.chmod('/state',0o700); p=pathlib.Path('/state/status.json'); p.write_text(sys.argv[1]); p.chmod(0o600)", json.dumps(fixture)])

    def query(expression):
        raw = run(mon("exec", "-T", "prometheus", "wget", "-qO-",
                      "http://localhost:9090/api/v1/query?" + urlencode({"query": expression})))
        payload = json.loads(raw)
        assert payload["status"] == "success"
        return payload["data"]["result"]

    def value(expression, expected):
        result = query(expression)
        return len(result) == 1 and float(result[0]["value"][1]) == expected

    try:
        # Docker Desktop's Linux VM stores Docker data on /var/lib/docker, not
        # its overlay root. On Linux CI the data filesystem is often mounted at /.
        docker_root = run(["docker", "info", "--format", "{{.DockerRootDir}}"] ).strip()
        mountinfo = run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "cat", "-v", "/proc:/host/proc:ro",
                         api, "/host/proc/1/mountinfo"])
        mounts = [line.split()[4] for line in mountinfo.splitlines()]
        data_mount = max((path for path in mounts if docker_root == path or docker_root.startswith(path.rstrip("/") + "/")), key=len)
        cfg = {"project": monitor, "retention_size": "1GB", "data_mountpoint": data_mount, "pdc_cluster": "test", "grafana_id": "1",
               "environments": {"dev": {"project": projects["dev"], "backup_bucket": "test-backups", "database": "acttub"}}}
        (work / "config.json").write_text(json.dumps(cfg))
        secrets = work / "secrets"
        secrets.mkdir(mode=0o700)
        for name in ("dev-token", "pdc-token"):
            token = secrets / name
            token.write_text("monitoring-smoke-only-" + name)
            token.chmod(0o600)
        prepare_app("dev")
        print("PASS dev app deployment before monitoring exists", flush=True)
        run(manager + ["--config", str(work / "config.json"), "--secrets-dir", str(secrets), "render", "v1"])
        print(run([sys.executable, str(ROOT / "tests/pdc_policy.py"), str(release)]).strip(), flush=True)
        model = json.loads(run(mon("config", "--format", "json")))
        python_image = model["services"]["backup-exporter"]["image"]
        prepare_backup("dev")
        assert "prod_scrape" not in model["networks"] and "prod_backup_state" not in model["volumes"]
        assert not (secrets / "prod-token").exists()
        for kind, resource in [("network", "_scrape"), ("volume", "_backup_state")]:
            missing = subprocess.run(["docker", kind, "inspect", projects["prod"] + resource], env=ENV, capture_output=True, timeout=30)
            assert missing.returncode != 0, "prod fixture resource existed before dev-only apply"
        run(manager + ["--without-pdc", "apply", "v1"])
        wait_for(lambda: value('count(up{job="api"} == 1)', 1), "dev API was not scraped")
        wait_for(lambda: value('count(acttub_db_probe_success == 1)', 1), "authenticated dev DB probe failed")
        wait_for(lambda: value('count(acttub_backup_state{state="ok"} == 1)', 1), "root-owned read-only dev backup state unreadable")
        assert not query('{environment="prod"}'), "dev-only configuration emitted prod metrics"
        wait_for(lambda: value('count(node_memory_MemAvailable_bytes{environment="shared"} > 0)', 1), "host available-memory metric missing")
        assert query('node_cpu_seconds_total{environment="shared",mode="idle"}'), "host CPU metrics missing"
        assert value('count(node_filesystem_avail_bytes{environment="shared",mountpoint=' + json.dumps(data_mount) + '} > 0)', 1), "data filesystem metric missing"
        run(manager + ["verify", "v1"])
        print("PASS dev-only apply/verify with no prod secret, network, volume, targets or probes", flush=True)
        for env in cfg["environments"]:
            expected = "monitoring-smoke-only-" + env + "-token"
            other = "monitoring-smoke-only-" + ("prod" if env == "dev" else "dev") + "-token"
            for port, token, code in [(9091, expected, "200"), (9091, other, "401"), (9091, "", "401")]:
                argv = app(env, "exec", "-T", "api", "curl", "-sS", "--max-time", "5", "-o", "/dev/null", "-w", "%{http_code}")
                if token:
                    argv += ["-H", "Authorization: Bearer " + token]
                actual = run(argv + [f"http://localhost:{port}/actuator/prometheus"])
                assert actual == code, "management auth contract mismatch"
            public = run(app(env, "exec", "-T", "api", "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
                             "http://localhost:8080/actuator/prometheus"))
            assert public in ("401", "403", "404"), "management endpoint accessible on public port"
            via_web = run(app(env, "exec", "-T", "web", "node", "-e",
                              "fetch('http://127.0.0.1:3000/actuator/prometheus').then(r=>process.stdout.write(String(r.status)))"))
            assert via_web in ("401", "403", "404"), "management endpoint exposed by web"
        raw = run(mon("exec", "-T", "backup-exporter", "python3", "-c",
                      "from urllib.request import urlopen; print(urlopen('http://localhost:9101/metrics').read().decode())"))
        assert "DO-NOT-EXPORT" not in raw and "s3://" not in raw
        # A runtime connection from the PDC-only query network must not reach app
        # default-network DB IPs or resolve the API scrape alias.
        db_id = run(app("dev", "ps", "-q", "db")).strip()
        db = json.loads(run(["docker", "inspect", db_id]))[0]
        db_ip = db["NetworkSettings"]["Networks"][projects["dev"] + "_default"]["IPAddress"]
        probe = """import socket,sys
for host,port in [(sys.argv[1],5432),(sys.argv[2],9091)]:
 try:
  socket.create_connection((host,port),timeout=2).close()
 except OSError: continue
 raise SystemExit('PDC query network reached a forbidden target')
socket.create_connection(('prometheus',9090),timeout=2).close()
"""
        run(["docker", "run", "--rm", "--network", monitor + "_query", python_image,
             "python3", "-c", probe, db_ip, projects["dev"] + "-api"])
        for container_id in run(mon("ps", "-q")).split():
            container = json.loads(run(["docker", "inspect", container_id]))[0]
            assert not any(container["NetworkSettings"]["Ports"].values()), "published host port found"
        print("PASS public endpoint denial and actual query-network DB/API isolation", flush=True)

        before = run(mon("ps", "-q")).split()
        deploy("dev")
        assert run(mon("ps", "-q")).split() == before, "app deploy recreated monitoring"
        timestamp = query("time()")[1]
        historical = 'up{job="api",environment="dev"} @ ' + str(timestamp)
        assert value(historical, 1)
        run(mon("up", "-d", "--force-recreate", "--wait", "prometheus"))
        assert value(historical, 1), "historical metrics lost after Prometheus recreation"
        print("PASS app deploy independence and Prometheus historical persistence", flush=True)

        # The pinned Prometheus exposes separate float/histogram counters.
        wait_for(lambda: value('count(rate(prometheus_tsdb_head_samples_appended_total[5m]))', 2),
                 "typed ingestion counters were not ready for capacity estimation")
        capacity, _ = json.JSONDecoder().raw_decode(run(manager + ["capacity", "v1"]))
        assert capacity["samples_per_second"] > 0, "capacity estimation lost active ingestion"
        print("PASS capacity estimation across float and histogram counters", flush=True)

        # Add prod only after dev-only collection succeeded. A new immutable
        # release must keep the same metrics volume and earlier dev samples.
        (secrets / "prod-token").write_text("monitoring-smoke-only-prod-token")
        (secrets / "prod-token").chmod(0o600)
        prepare_app("prod")
        prepare_backup("prod")
        cfg["environments"]["prod"] = {"project": projects["prod"], "backup_bucket": "test-backups", "database": "acttub"}
        (work / "config.json").write_text(json.dumps(cfg))
        run(manager + ["--config", str(work / "config.json"), "--secrets-dir", str(secrets), "render", "v2"])
        run(manager + ["--without-pdc", "apply", "v2"])
        release = state / "releases/v2"
        wait_for(lambda: value('count(up{job="api"} == 1)', 2), "both APIs were not scraped after expansion")
        wait_for(lambda: value('count(acttub_db_probe_success == 1)', 2), "both DB probes failed after expansion")
        wait_for(lambda: value('count(acttub_backup_state{state="ok"} == 1)', 2), "both backup states unreadable after expansion")
        run(manager + ["verify", "v2"])
        assert value(historical, 1), "expansion lost historical dev metrics"
        print("PASS expansion to both environments with retained dev history", flush=True)

        run(app("dev", "stop", "db"))
        wait_for(lambda: value('acttub_db_probe_success{environment="dev"}', 0), "DB outage was not observed")
        assert value('acttub_db_probe_success{environment="prod"}', 1), "dev outage affected prod probe"
        public = run(app("dev", "exec", "-T", "web", "node", "-e",
                         "fetch('http://127.0.0.1:3000/health').then(r=>process.stdout.write(String(r.status)))"))
        assert public == "200", "DB outage changed public health contract"
        run(app("dev", "up", "-d", "--wait", "db"))
        wait_for(lambda: value('acttub_db_probe_success{environment="dev"}', 1), "DB recovery was not observed")
        print("PASS DB failure and recovery, prod isolation, unchanged public health", flush=True)

        run(mon("stop"))
        stopped = run(mon("ps", "-aq")).split()
        deploy("dev", "fedcba9876543210")
        assert run(mon("ps", "-aq")).split() == stopped, "app deploy recreated stopped monitoring"
        assert not run(mon("ps", "-q")).strip(), "app deploy started monitoring"
        run(manager + ["--without-pdc", "apply", "v2"])
        assert value(historical, 1), "metrics lost while monitoring was stopped"
        # Reapply, then roll back to dev-only without touching the prod app or
        # deleting the monitoring store. Recent unselected samples may remain.
        prod_containers = run(app("prod", "ps", "-q")).split()
        run(manager + ["--without-pdc", "apply", "v2"])
        run(manager + ["--without-pdc", "rollback", "v1"])
        release = state / "releases/v1"
        wait_for(lambda: value('acttub_db_probe_success{environment="dev"}', 1), "dev probe did not recover after rollback")
        run(manager + ["verify", "v1"])
        assert run(app("prod", "ps", "-q")).split() == prod_containers, "collector rollback changed prod app containers"
        for service in ("db-health", "backup-exporter"):
            metrics = run(mon("exec", "-T", service, "python3", "-c",
                              "from urllib.request import urlopen; print(urlopen('http://localhost:9101/metrics').read().decode())"))
            assert 'environment="prod"' not in metrics, "dev-only rollback still probes prod"
        assert value(historical, 1), "rollback lost metrics"
        print("PASS stopped-monitor app deploy, immutable reapply and dev-only rollback with retained metrics", flush=True)
        print("PASS monitoring integration; actual home-server/Cloud/Slack not tested", flush=True)
    finally:
        # The unique prefix and temp directory were created by this process. Only
        # test-owned stacks/volumes are removed, after monitoring detaches scrape.
        for version in ("v2", "v1"):
            path = state / "releases" / version
            if (path / "compose.env").exists():
                subprocess.run(["docker", "compose", "--env-file", str(path / "compose.env"), "-f", str(path / "compose.yml"),
                                "down", "-v", "--remove-orphans"], env=ENV, capture_output=True, timeout=60)
                break
        for env, directory in app_dirs.items():
            if (directory / "release.env").exists():
                subprocess.run(app(env, "down", "-v", "--remove-orphans"), env=ENV, capture_output=True, timeout=60)
            subprocess.run(["docker", "volume", "rm", projects[env] + "_backup_state"], env=ENV, capture_output=True, timeout=30)
        shutil.rmtree(work)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, subprocess.TimeoutExpired) as error:
        print("FAIL monitoring smoke: " + str(error), file=sys.stderr)
        sys.exit(1)
