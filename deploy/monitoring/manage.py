#!/usr/bin/env python3
"""Render immutable monitoring releases without printing credentials."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent


# Docker API reads Alloy needs: version negotiation, network and container lists, container inspect and logs.
# Nothing else passes (measured: discovery.docker also lists networks for its labels).
SOCKET_PROXY_COMMAND = [
    "-listenip=0.0.0.0", "-allowfrom=alloy",
    r"-allowGET=(/_ping|/v1\.[0-9]+/(_ping|version|networks|containers/json|containers/[0-9a-f]{64}/(json|logs)))",
    r"-allowHEAD=(/_ping|/v1\.[0-9]+/_ping)", "-loglevel=WARN"]


class ConfigError(Exception):
    """An error that is safe to print without its underlying input."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ConfigError(message)


def read_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    require(isinstance(config, dict), "config must be an object")
    require(re.fullmatch(r"[1-9][0-9]*(MB|GB|TB)", str(config.get("retention_size", ""))),
            "retention_size must be an explicit positive MB/GB/TB capacity after host preflight")
    for key in ("project", "pdc_cluster"):
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,60}", config.get(key, "")), "invalid " + key)
    require(re.fullmatch(r"[0-9]+", config.get("grafana_id", "")), "grafana_id must be numeric")
    require(re.fullmatch(r"/[a-zA-Z0-9/_.-]*", config.get("data_mountpoint", "")), "invalid data_mountpoint")
    envs = config.get("environments")
    require(isinstance(envs, dict) and bool(envs) and set(envs) <= {"dev", "prod"},
            "environments must be a nonempty object containing only dev and/or prod")
    for env in envs.values():
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,60}", env["project"]), "invalid app project")
        require(re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", env["backup_bucket"]), "invalid backup bucket")
        require(re.fullmatch(r"[a-zA-Z0-9_]+", env["database"]), "invalid database name")
    require(len({config["project"], *(v["project"] for v in envs.values())}) == len(envs) + 1,
            "monitoring and selected app project names must differ")
    logs = config.get("logs")
    if logs is not None:
        require(isinstance(logs, dict), "logs must be an object")
        require(re.fullmatch(r"https://[a-z0-9.-]+/loki/api/v1/push", str(logs.get("loki_url", ""))),
                "logs.loki_url must be the Cloud Loki https push URL")
        require(re.fullmatch(r"[0-9]+", str(logs.get("loki_user", ""))), "logs.loki_user must be numeric")
        selected = logs.get("environments")
        require(isinstance(selected, list) and bool(selected) and len(set(selected)) == len(selected)
                and set(selected) <= set(envs), "logs.environments must be a nonempty subset of environments")
        gid = logs.get("journal_gid")
        require(type(gid) is int and 0 < gid < 65536, "logs.journal_gid must be the host systemd-journal group id")
    return config


def write_file(path: Path, content: str) -> None:
    path.write_text(content)
    # Each release lives below a host-only 0700 state directory. Container users
    # can read their bound subdirectory, but other host users cannot traverse it.
    path.chmod(0o444)


def write_json(path: Path, content: dict) -> None:
    write_file(path, json.dumps(content, indent=2) + "\n")


def render_alloy(config: dict) -> str:
    logs = config["logs"]
    rules = "\n".join(
        "  rule {\n"
        "    source_labels = [\"__meta_docker_container_label_com_docker_compose_project\"]\n"
        "    regex         = \"" + config["environments"][env]["project"] + "\"\n"
        "    target_label  = \"environment\"\n"
        "    replacement   = \"" + env + "\"\n"
        "  }" for env in logs["environments"])
    return ((ROOT / "config.alloy").read_text().replace("@ENVIRONMENT_RULES@", rules)
            .replace("@LOKI_URL@", logs["loki_url"]).replace("@LOKI_USER@", logs["loki_user"]))


def render_compose(config: dict) -> str:
    # Only environment wiring varies; service/security/image declarations stay
    # in the Compose template. JSON flow values are also valid YAML.
    envs = config["environments"]
    networks = {"query": {}, "collectors": {"internal": True}}
    volumes = {"metrics": {}}
    for environment, app in envs.items():
        networks[environment + "_scrape"] = {"external": True, "name": app["project"] + "_scrape"}
        volumes[environment + "_backup_state"] = {"external": True, "name": app["project"] + "_backup_state"}
    source = (ROOT / "compose.yml").read_text()
    return (source.replace("@SCRAPE_NETWORKS@", ", ".join(env + "_scrape" for env in envs))
            .replace("@BACKUP_MOUNTS@", "\n".join("      - " + env + "_backup_state:/state/" + env + ":ro" for env in envs))
            .replace("@NETWORKS@", json.dumps(networks))
            .replace("@VOLUMES@", json.dumps(volumes)))


def render(args, release: Path) -> None:
    config = read_config(args.config)
    require(not release.exists(), "release already exists; use a new version to change configuration")
    tokens = {}
    logs = "logs" in config
    for name in [*(env + "-token" for env in config["environments"]), "pdc-token", *(["loki-token"] if logs else [])]:
        source = args.secrets_dir / name
        require(source.is_file() and source.stat().st_mode & 0o077 == 0,
                "token source must exist and be owner-only: " + name)
        value = source.read_text().strip()
        require(re.fullmatch(r"[A-Za-z0-9_.~+/=-]{16,4096}", value), "invalid token file: " + name)
        tokens[name] = value
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.state_dir.chmod(0o700)
    release.mkdir(parents=True)
    for name in ("prometheus", "db", "backup", "pdc"):
        (release / name).mkdir(mode=0o755)
    write_file(release / "compose.yml", render_compose(config))
    write_file(release / "exporter.py", (ROOT / "exporter.py").read_text())
    write_file(release / "pdc/pdc-entrypoint.sh", (ROOT / "pdc-entrypoint.sh").read_text())
    write_file(release / "pdc/pdc-token", tokens["pdc-token"])
    write_json(release / "config.json", config)
    if logs:
        (release / "alloy").mkdir(mode=0o755)
        write_file(release / "compose.logs.yml", (ROOT / "compose.logs.yml").read_text())
        write_file(release / "alloy/config.alloy", render_alloy(config))
        write_file(release / "alloy/loki-token", tokens["loki-token"])
    envs = config["environments"]
    env_values = {"MONITOR_PROJECT": config["project"], "RELEASE_DIR": str(release),
                  "RETENTION_SIZE": config["retention_size"], "PDC_CLUSTER": config["pdc_cluster"],
                  "GRAFANA_ID": config["grafana_id"], "DATA_MOUNTPOINT_REGEX": "^" + re.escape(config["data_mountpoint"]) + "$"}
    if logs:
        env_values["JOURNAL_GID"] = str(config["logs"]["journal_gid"])
    write_file(release / "compose.env", "\n".join(key + "='" + value + "'" for key, value in env_values.items()) + "\n")
    jobs = []
    db_config = {}
    backup_config = {}
    for environment, env in envs.items():
        alias = env["project"] + "-api:9091"
        token_name = environment + "-token"
        for folder in ("prometheus", "db"):
            write_file(release / folder / token_name, tokens[token_name])
        jobs.append({"job_name": "api-" + environment, "metrics_path": "/actuator/prometheus",
                     "authorization": {"credentials_file": "/etc/acttub/" + token_name},
                     "static_configs": [{"targets": [alias], "labels": {"environment": environment, "job": "api"}}],
                     "metric_relabel_configs": [{"action": "labeldrop", "regex": "exported_environment|exported_job"}]})
        db_config[environment] = {"url": "http://" + alias + "/actuator/health/db", "token_file": "/etc/acttub/" + token_name}
        backup_config[environment] = {"state_dir": "/state/" + environment,
                                      "target": "s3://" + env["backup_bucket"] + "/" + environment + "/:" + env["database"]}
    for job, target in [("db-health", "db-health:9101"), ("backup", "backup-exporter:9101"),
                        ("node", "node:9100"), ("prometheus", "localhost:9090")]:
        labels = {"environment": "shared"} if job in ("node", "prometheus") else {}
        jobs.append({"job_name": job, "static_configs": [{"targets": [target], "labels": labels}]})
    write_json(release / "prometheus/prometheus.json", {"global": {"scrape_interval": "30s", "scrape_timeout": "10s"}, "scrape_configs": jobs})
    write_json(release / "db/config.json", db_config)
    write_json(release / "backup/config.json", backup_config)
    print("Rendered monitoring release " + release.name + " (credentials withheld)")


def compose(release: Path, *arguments: str) -> list:
    files = ["-f", str(release / "compose.yml")]
    if (release / "compose.logs.yml").exists():
        files += ["-f", str(release / "compose.logs.yml")]
    return ["docker", "compose", "--env-file", str(release / "compose.env"), *files, *arguments]


def run(command: list, purpose: str, timeout: int = 120) -> str:
    # Parent shell variables must not override the release's Compose interpolation.
    blocked = {"MONITOR_PROJECT", "RELEASE_DIR", "RETENTION_SIZE", "PDC_CLUSTER", "GRAFANA_ID",
               "DATA_MOUNTPOINT_REGEX", "DEV_PROJECT", "PROD_PROJECT", "JOURNAL_GID"}
    environment = {k: v for k, v in os.environ.items() if k not in blocked and not k.startswith("COMPOSE_")}
    result = subprocess.run(command, capture_output=True, text=True, env=environment, timeout=timeout)
    require(result.returncode == 0, purpose + " failed (command output withheld)")
    return result.stdout


def validate(release: Path) -> dict:
    cfg = read_config(release / "config.json")
    model = json.loads(run(compose(release, "config", "--format", "json"), "Compose validation"))
    require(model["name"] == cfg["project"], "project name does not match release")
    scrape_networks = {env + "_scrape" for env in cfg["environments"]}
    backup_volumes = {env + "_backup_state" for env in cfg["environments"]}
    topology = {"prometheus": {"query", "collectors"} | scrape_networks,
                "pdc": {"query"}, "node": {"collectors"}, "backup-exporter": {"collectors"},
                "db-health": {"collectors"} | scrape_networks}
    logs = "logs" in cfg
    if logs:
        topology.update({"alloy": {"logs", "docker-api"}, "socket-proxy": {"docker-api"}})
    require(set(model["services"]) == set(topology), "unexpected monitoring services")
    for name, networks in topology.items():
        service = model["services"][name]
        require(set(service.get("networks", {})) == networks, name + " networks violate isolation")
        require(not service.get("ports") and not service.get("network_mode"), "published ports/network mode forbidden")
        require("@sha256:" in service["image"], "images must have immutable digests")
        require(service.get("read_only") and service.get("cap_drop") == ["ALL"] and not service.get("privileged"),
                "container privilege restriction is missing")
        require(not service.get("environment") and not service.get("env_file"), "unexpected container environment")
        for volume in service.get("volumes", []):
            socket = (name == "socket-proxy" and volume["type"] == "bind" and volume["source"] == "/var/run/docker.sock"
                      and volume["target"] == "/var/run/docker.sock" and volume.get("read_only"))
            require("docker.sock" not in volume["source"] or socket, "Docker socket is only for socket-proxy, read-only")
            require(volume.get("read_only") or (name, volume["type"], volume["target"]) in {
                        ("prometheus", "volume", "/prometheus"), ("alloy", "volume", "/var/lib/alloy/data")},
                    "only metrics and log position storage may be writable")
    pdc = model["services"]["pdc"]
    expected = ["-cluster=" + cfg["pdc_cluster"], "-gcloud-hosted-grafana-id=" + cfg["grafana_id"],
                "-use-gossh=false", "-ssh-flag=-o PermitRemoteOpen=prometheus:9090",
                "-ssh-key-file=/home/pdc/.ssh/grafana_pdc", "-metrics-addr=127.0.0.1:8090", "-log.level=warn"]
    require(pdc["command"] == expected, "PDC flags must restrict OpenSSH forwarding to prometheus:9090")
    require(pdc["entrypoint"] == ["/bin/sh", "/etc/acttub/pdc-entrypoint.sh"], "unexpected PDC entrypoint")
    require(pdc.get("tmpfs") == ["/home/pdc/.ssh:uid=30000,gid=30000,mode=0700"],
            "PDC SSH tmpfs must be /home/pdc/.ssh with uid=30000,gid=30000,mode=0700 as one mount")
    own_networks = {"query", "collectors"} | ({"logs", "docker-api"} if logs else set())
    require(set(model["networks"]) == own_networks | scrape_networks, "unexpected network")
    require(set(model["volumes"]) == {"metrics"} | backup_volumes | ({"alloy-data"} if logs else set()), "unexpected volume")
    if logs:
        alloy = model["services"]["alloy"]
        require(alloy["command"] == ["run", "/etc/acttub/config.alloy", "--storage.path=/var/lib/alloy/data",
                                     "--server.http.listen-addr=127.0.0.1:12345", "--disable-reporting"],
                "Alloy must listen on loopback only and disable usage reporting")
        require(alloy.get("user") == "473:473" and alloy.get("group_add") == [str(cfg["logs"]["journal_gid"])],
                "Alloy must run as its non-root user with only the journal group added")
        binds = {v["target"]: v["source"] for v in alloy["volumes"] if v["type"] == "bind"}
        require(set(binds) == {"/etc/acttub", "/var/log/journal"} and binds["/var/log/journal"] == "/var/log/journal"
                and binds["/etc/acttub"].endswith("/alloy"), "Alloy may bind only its release config and the host journal")
        proxy = model["services"]["socket-proxy"]
        require(proxy["command"] == SOCKET_PROXY_COMMAND, "socket-proxy must pass only Alloy's Docker API reads")
        require(alloy.get("mem_limit") and proxy.get("mem_limit"), "Alloy/socket-proxy memory limit is missing")
        require(model["networks"]["docker-api"].get("internal"), "docker-api network must be internal")
    backup_mounts = {(v["source"], v["target"]) for v in model["services"]["backup-exporter"]["volumes"]
                     if v["type"] == "volume"}
    require(backup_mounts == {(env + "_backup_state", "/state/" + env) for env in cfg["environments"]},
            "backup state mounts must match selected environments")
    for environment, app in cfg["environments"].items():
        network = model["networks"][environment + "_scrape"]
        require(network.get("external") and network["name"] == app["project"] + "_scrape", "scrape network mismatch")
        volume = model["volumes"][environment + "_backup_state"]
        require(volume.get("external") and volume["name"] == app["project"] + "_backup_state", "backup volume mismatch")
    require(model["networks"]["collectors"].get("internal"), "collectors network must be internal")
    for network in own_networks:
        require(not model["networks"][network].get("external") and
                model["networks"][network]["name"] == cfg["project"] + "_" + network,
                "monitor networks must be owned by this project")
    require(model["volumes"]["metrics"]["name"] == cfg["project"] + "_metrics", "metrics volume must remain stable")
    prom = model["services"]["prometheus"]
    require("--storage.tsdb.retention.time=30d" in prom["command"] and
            "--storage.tsdb.retention.size=" + cfg["retention_size"] in prom["command"], "retention contract missing")
    require(not any("enable-admin-api" in flag or "enable-lifecycle" in flag for flag in prom["command"]),
            "Prometheus mutation APIs must remain disabled")
    print("Compose isolation and retention validated")
    return model


def check(release: Path) -> dict:
    model = validate(release)
    prom = model["services"]["prometheus"]["image"]
    pdc = model["services"]["pdc"]
    run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "/bin/promtool",
         "-v", str(release / "prometheus") + ":/etc/acttub:ro", prom,
         "check", "config", "/etc/acttub/prometheus.json"], "promtool check config")
    # Validate flags with the pinned PDC binary, then the actual OpenSSH parser.
    run(["docker", "run", "--rm", "--network", "none", pdc["image"], *pdc["command"], "-h"], "PDC flags")
    if "alloy" in model["services"]:
        run(["docker", "run", "--rm", "--network", "none", "-v", str(release / "alloy") + ":/etc/acttub:ro",
             model["services"]["alloy"]["image"], "validate", "/etc/acttub/config.alloy"], "alloy validate")
    ssh = run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "ssh", pdc["image"],
               "-G", "-o", "PermitRemoteOpen=prometheus:9090", "localhost"], "OpenSSH destination policy")
    require("permitremoteopen prometheus:9090" in ssh.splitlines(), "OpenSSH allow-list not effective")
    print("Pinned Prometheus/PDC/OpenSSH configuration accepted (no Cloud connection attempted)")
    return model


def pointer(state: Path, name: str, version: str) -> None:
    path = state / (name + ".tmp")
    path.write_text(version + "\n")
    path.replace(state / name)


def apply(args, release: Path) -> None:
    if not release.exists():
        require(args.command != "rollback", "rollback requires an existing release")
        render(args, release)
    model = check(release)
    current = args.state_dir / "current"
    if current.exists():
        old = current.read_text().strip()
        old_cfg = read_config(args.state_dir / "releases" / old / "config.json")
        require(old_cfg["project"] == model["name"], "cannot change project/metrics volume during apply or rollback")
    for environment in read_config(release / "config.json")["environments"]:
        run(["docker", "network", "inspect", model["networks"][environment + "_scrape"]["name"]], "app-owned scrape network preflight")
        run(["docker", "volume", "inspect", model["volumes"][environment + "_backup_state"]["name"]], "read-only backup state volume preflight")
    # --without-pdc also skips alloy: neither connects to Cloud.
    services = ["prometheus", "node", "db-health", "backup-exporter"] if args.without_pdc else []
    # Orphan removal stops alloy when "logs" is removed or an older release is rolled back.
    run(compose(release, "up", "-d", "--remove-orphans", "--wait", "--wait-timeout", "120", *services),
        "monitoring apply", timeout=180)
    if current.exists() and current.read_text().strip() != release.name:
        pointer(args.state_dir, "previous", current.read_text().strip())
    pointer(args.state_dir, "current", release.name)
    print("Monitoring release " + release.name + " applied; metrics volume preserved")


def query(release: Path, expression: str) -> dict:
    raw = run(compose(release, "exec", "-T", "prometheus", "wget", "-qO-",
                      "http://localhost:9090/api/v1/query?" + urlencode({"query": expression})), "Prometheus query")
    result = json.loads(raw)
    require(result.get("status") == "success", "Prometheus query failed")
    return result["data"]


def verify(release: Path) -> None:
    validate(release)
    config = read_config(release / "config.json")
    environments = set(config["environments"])
    targets = query(release, "up")["result"]
    observed = {(item["metric"]["job"], item["metric"].get("environment", "")): float(item["value"][1]) for item in targets}
    expected = {("api", env) for env in environments} | {
        ("db-health", ""), ("backup", ""), ("node", "shared"), ("prometheus", "shared")}
    require(all(observed.get(target) == 1 for target in expected), "required scrape target missing or down")
    for expression in ("acttub_db_probe_success", "acttub_backup_state_read_success", "acttub_backup_target_match"):
        values = query(release, expression)["result"]
        # A prior wider release may still have recent samples in the retained
        # TSDB. Only the selected environments determine this release's health.
        require(environments <= {v["metric"].get("environment") for v in values if v["value"][1] == "1"},
                expression + " must be 1 in all selected environments")
    mount = config["data_mountpoint"]
    for expression in ('node_cpu_seconds_total{environment="shared",mode="idle"}',
                       'node_memory_MemAvailable_bytes{environment="shared"}',
                       'node_filesystem_avail_bytes{environment="shared",mountpoint=' + json.dumps(mount) + '}'):
        require(bool(query(release, expression)["result"]), "required host CPU/memory/data-filesystem metric missing")
    print("Selected APIs, authenticated DB probes, readable matching backup states and shared host scrape verified")


def preflight(data_dir: Path) -> None:
    require(sys.platform.startswith("linux"), "host preflight must run on the actual Linux server; no host measurement recorded")
    usage = shutil.disk_usage(data_dir)
    print(json.dumps({"data_directory": str(data_dir), "disk_total_bytes": usage.total,
                      "disk_available_bytes": usage.free, "host_memory": Path("/proc/meminfo").read_text().splitlines()[:3]}, indent=2))
    print("Measure ingest and reserve WAL/compaction plus application disk headroom before choosing retention_size; this does not prove 30-day capacity")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("monitoring.json"))
    parser.add_argument("--secrets-dir", type=Path, default=Path("secrets"))
    parser.add_argument("--state-dir", type=Path, default=Path("/svc/acttub/monitoring"))
    parser.add_argument("--data-dir", type=Path, default=Path("/var/lib/docker"))
    parser.add_argument("--without-pdc", action="store_true", help="start collectors only; no Cloud connection (local verification / initial setup)")
    parser.add_argument("command", choices=["render", "validate", "check", "apply", "rollback", "version", "verify", "preflight", "capacity"])
    parser.add_argument("version", nargs="?")
    args = parser.parse_args()
    try:
        args.state_dir = args.state_dir.resolve()
        require(not any(c in str(args.state_dir) for c in "\n\r'$"), "unsupported state directory characters")
        if args.command == "preflight":
            preflight(args.data_dir)
            return 0
        if args.version is None:
            marker = "previous" if args.command == "rollback" else "current"
            args.version = (args.state_dir / marker).read_text().strip()
        require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}", args.version), "invalid release version")
        release = args.state_dir / "releases" / args.version
        if args.command in ("render", "apply", "rollback"):
            args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            with (args.state_dir / ".lock").open("w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                if args.command == "render":
                    render(args, release)
                else:
                    apply(args, release)
        elif args.command == "validate":
            validate(release)
        elif args.command == "check":
            check(release)
        elif args.command == "verify":
            verify(release)
        elif args.command == "version":
            model = validate(release)
            print(json.dumps({"version": args.version, "project": model["name"],
                              "images": {k: v["image"] for k, v in model["services"].items()}}, indent=2))
        elif args.command == "capacity":
            values = query(release, "sum(rate(prometheus_tsdb_head_samples_appended_total[5m]))")["result"]
            require(len(values) == 1, "at least five minutes of Prometheus ingestion are needed")
            samples = float(values[0]["value"][1])
            print(json.dumps({"samples_per_second": samples, "estimated_30d_sample_bytes_at_2_bytes_per_sample": samples * 86400 * 30 * 2,
                              "retention_size": read_config(release / "config.json")["retention_size"]}, indent=2))
            print("Estimate excludes WAL/index/compaction; compare actual volume growth and host free space, retaining at least 20% storage headroom")
        return 0
    except ConfigError as error:
        print("monitoring: " + str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        print("monitoring: invalid or unreadable configuration (details withheld)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
