#!/usr/bin/env python3
"""Exercise the pinned PDC image's actual OpenSSH remote SOCKS allow-list locally.

No Grafana credentials or requests: a temporary SSH server substitutes only the
external tunnel peer. The client binary, configured hostname/port restriction and
forwarded TCP/HTTP requests are real.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def main(release: Path):
    prefix = "soma520-ssh-" + str(os.getpid())
    work = Path(tempfile.mkdtemp(prefix=prefix + "-"))
    keys = work / "keys"
    keys.mkdir(mode=0o777)
    keys.chmod(0o777)  # Generated disposable test key, no operational credential.
    names = [prefix + suffix for suffix in ("-http", "-gateway", "-client")]

    def run(*args, timeout=45):
        result = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError("local SSH fixture command failed (output withheld)")
        return result.stdout

    model = json.loads(run("docker", "compose", "--env-file", str(release / "compose.env"),
                           "-f", str(release / "compose.yml"), "config", "--format", "json"))
    pdc = model["services"]["pdc"]
    image = pdc["image"]
    python = model["services"]["backup-exporter"]["image"]
    flag = next(item for item in pdc["command"] if item.startswith("-ssh-flag="))
    option = flag.removeprefix("-ssh-flag=-o ")
    try:
        run("docker", "network", "create", prefix)
        run("docker", "run", "--rm", "--network", "none", "--entrypoint", "ssh-keygen", "-v", str(keys) + ":/keys", image,
            "-q", "-t", "ed25519", "-N", "", "-f", "/keys/id")
        http = "from http.server import HTTPServer,SimpleHTTPRequestHandler; from threading import Thread; Thread(target=HTTPServer(('0.0.0.0',9091),SimpleHTTPRequestHandler).serve_forever,daemon=True).start(); HTTPServer(('0.0.0.0',9090),SimpleHTTPRequestHandler).serve_forever()"
        run("docker", "run", "-d", "--name", names[0], "--network", prefix, "--network-alias", "prometheus", "--network-alias", "forbidden",
            python, "python3", "-c", http)
        server = "ssh-keygen -A >/dev/null; mkdir -p /root/.ssh /run/sshd; cp /keys/id.pub /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys; passwd -d root >/dev/null; exec /usr/sbin/sshd -D -e -o PasswordAuthentication=no -o PermitRootLogin=prohibit-password -o AllowTcpForwarding=remote"
        run("docker", "run", "-d", "--name", names[1], "--user", "0:0", "--network", prefix, "--network-alias", "gateway",
            "-v", str(keys) + ":/keys:ro", "--entrypoint", "/bin/sh", image, "-ec", server)
        # The same OpenSSH implementation and exact rendered restriction as PDC.
        time.sleep(1)
        run("docker", "run", "-d", "--name", names[2], "--network", prefix, "-v", str(keys) + ":/keys:ro",
            "--entrypoint", "ssh", image, "-N", "-T", "-R", "127.0.0.1:1080", "-o", option,
            "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ExitOnForwardFailure=yes",
            "-o", "ConnectTimeout=3", "-i", "/keys/id", "root@gateway")
        client = r'''
import socket,time
def request(host,port):
 s=socket.create_connection(('127.0.0.1',1080),timeout=3)
 with s:
  s.sendall(b'\x05\x01\x00')
  assert s.recv(2)==b'\x05\x00'
  target=host.encode(); s.sendall(b'\x05\x01\x00\x03'+bytes([len(target)])+target+port.to_bytes(2,'big'))
  reply=s.recv(10)
  if len(reply)<2 or reply[1]!=0: return False
  s.sendall(b'GET / HTTP/1.0\r\nHost: prometheus\r\n\r\n')
  return b'200 OK' in s.recv(1024)
for attempt in range(30):
 try:
  if request('prometheus',9090): break
 except OSError: pass
 time.sleep(.2)
else: raise SystemExit('allowed Prometheus HTTP destination did not work')
for host,port in [('forbidden',9090),('prometheus',9091)]:
 try: allowed=request(host,port)
 except OSError: allowed=False
 assert not allowed, 'SSH forwarded a forbidden destination or port'
print('PASS actual OpenSSH forwarding: Prometheus HTTP allowed, other hostname and port denied')
'''
        print(run("docker", "run", "--rm", "--network", "container:" + names[1], python,
                  "python3", "-c", client).strip())
    finally:
        for name in reversed(names):
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20)
        subprocess.run(["docker", "network", "rm", prefix], capture_output=True, timeout=20)
        shutil.rmtree(work)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
