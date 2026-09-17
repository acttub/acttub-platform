#!/usr/bin/env python3
"""Install checksum-verified official tools locally; never change system tools."""
import hashlib
import io
import os
from pathlib import Path
import platform
import subprocess
import tarfile
from urllib.request import urlopen
import zipfile

CACHE = Path(__file__).resolve().parents[1] / ".validation/tools"
system = {"Darwin": "darwin", "Linux": "linux"}[platform.system()]
arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64"}[platform.machine()]


def download(url):
    with urlopen(url, timeout=60) as response:
        return response.read()


def install(name, version, base, archive, checksum_file, member):
    binary = Path(os.environ.get(name.upper(), str(CACHE / name)))
    if not binary.exists():
        sums = download(base + "/" + checksum_file).decode()
        expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip("*") == archive)
        data = download(base + "/" + archive)
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("Official checksum mismatch for " + archive)
        if archive.endswith(".zip"):
            content = zipfile.ZipFile(io.BytesIO(data)).read(member)
        else:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as compressed:
                content = compressed.extractfile(member).read()
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(content)
        binary.chmod(0o755)
    result = subprocess.run([str(binary), "version" if name == "terraform" else "--version"], capture_output=True, text=True, check=True)
    if version not in result.stdout + result.stderr:
        raise RuntimeError("Expected " + name + " " + version)
    print(name + " " + version + " ready")


install("terraform", "1.16.2", "https://releases.hashicorp.com/terraform/1.16.2", "terraform_1.16.2_" + system + "_" + arch + ".zip", "terraform_1.16.2_SHA256SUMS", "terraform")
package = "prometheus-3.14.0." + system + "-" + arch
install("promtool", "3.14.0", "https://github.com/prometheus/prometheus/releases/download/v3.14.0", package + ".tar.gz", "sha256sums.txt", package + "/promtool")
