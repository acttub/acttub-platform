"""Path-redacting source checkpoint and detached-worktree gate.

Repository locations enter only as open directory descriptors.  Returned records
contain aliases and Git object identifiers, never machine-specific paths.
"""

from __future__ import annotations

import hashlib
import hmac
import fcntl
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any

try:
    from .controller import EXPECTED_BRANCHES
except ImportError:  # pragma: no cover - direct script import fallback
    sys.path.insert(0, os.path.dirname(__file__))
    from controller import EXPECTED_BRANCHES

_HEX40 = re.compile(r"^[a-f0-9]{40}$")
_LOCKFILES = {
    "platform": "pnpm-lock.yaml",
    "summary": "uv.lock",
    "agent": "uv.lock",
    "report": "uv.lock",
}
_MAX_LOCKFILE_BYTES = 64 * 1024 * 1024


class RepositoryGateRejected(ValueError):
    """A fixed-message repository gate rejection."""


def _reject() -> None:
    raise RepositoryGateRejected("repository_gate_rejected")


def _directory_path(fd: int, *, private: bool) -> str:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        info = os.fstat(fd)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
            _reject()
        if private and stat.S_IMODE(info.st_mode) & 0o077:
            _reject()
        if sys.platform == "darwin":
            raw_path = fcntl.fcntl(fd, 50, b"\0" * 1024)
            resolved = raw_path.split(b"\0", 1)[0].decode("utf-8")
        else:
            resolved = os.path.realpath(f"/dev/fd/{fd}")
        resolved_info = os.stat(resolved, follow_symlinks=False)
        if not stat.S_ISDIR(resolved_info.st_mode) or resolved_info.st_ino != info.st_ino or resolved_info.st_dev != info.st_dev:
            _reject()
        return resolved
    except RepositoryGateRejected:
        raise
    except (OSError, OverflowError, ValueError):
        _reject()


def _git(repo_path: str, *arguments: str, maximum: int = 1024 * 1024) -> bytes:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=repo_path,
            env={"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        _reject()
    if completed.returncode != 0 or len(completed.stdout) > maximum or b"\x00" in completed.stdout:
        _reject()
    return completed.stdout.rstrip(b"\n")


def _read_lockfile(repo_fd: int, alias: str) -> str:
    try:
        fd = os.open(_LOCKFILES[alias], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=repo_fd)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > _MAX_LOCKFILE_BYTES:
                _reject()
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = os.read(fd, 1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_LOCKFILE_BYTES:
                    _reject()
                digest.update(chunk)
        finally:
            os.close(fd)
    except RepositoryGateRejected:
        raise
    except (KeyError, OSError, OverflowError, ValueError):
        _reject()
    return digest.hexdigest()


def inspect_repository(alias: str, directory_fd: int) -> dict[str, Any]:
    """Require the expected feature branch, clean tree, and upstream equality."""

    if alias not in EXPECTED_BRANCHES or alias not in _LOCKFILES:
        _reject()
    path = _directory_path(directory_fd, private=False)
    try:
        branch = _git(path, "rev-parse", "--abbrev-ref", "HEAD").decode("ascii")
        head = _git(path, "rev-parse", "HEAD").decode("ascii")
        tree = _git(path, "rev-parse", "HEAD^{tree}").decode("ascii")
        upstream = _git(path, "rev-parse", "@{u}").decode("ascii")
        status = _git(path, "status", "--porcelain=v1", "--untracked-files=normal")
    except UnicodeDecodeError:
        _reject()
    if (
        branch != EXPECTED_BRANCHES[alias]
        or _HEX40.fullmatch(head) is None
        or _HEX40.fullmatch(tree) is None
        or _HEX40.fullmatch(upstream) is None
        or not hmac_compare(head, upstream)
        or status
    ):
        _reject()
    return {
        "alias": alias,
        "branch": branch,
        "head": head,
        "tree": tree,
        "clean": True,
        "upstreamEqual": True,
        "lockfileSha256": _read_lockfile(directory_fd, alias),
    }


def hmac_compare(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)


@dataclass
class DetachedWorktree:
    alias: str
    primary_fd: int = field(repr=False)
    cwd: str = field(repr=False)
    before: dict[str, Any] = field(repr=False)
    _removed: bool = field(default=False, init=False, repr=False)

    def attestation(self) -> dict[str, Any]:
        if self._removed:
            _reject()
        try:
            branch = _git(self.cwd, "rev-parse", "--abbrev-ref", "HEAD").decode("ascii")
            head = _git(self.cwd, "rev-parse", "HEAD").decode("ascii")
            tree = _git(self.cwd, "rev-parse", "HEAD^{tree}").decode("ascii")
            status = _git(self.cwd, "status", "--porcelain=v1", "--untracked-files=normal")
        except UnicodeDecodeError:
            _reject()
        after = inspect_repository(self.alias, self.primary_fd)
        if branch != "HEAD" or head != self.before["head"] or tree != self.before["tree"] or status or after != self.before:
            _reject()
        return {
            "head": head,
            "tree": tree,
            "clean": True,
            "detached": True,
            "primaryWorktreeUntouched": True,
        }

    def remove(self) -> None:
        if self._removed:
            return
        primary_path = _directory_path(self.primary_fd, private=False)
        _git(primary_path, "worktree", "remove", "--force", self.cwd)
        if os.path.lexists(self.cwd):
            _reject()
        self._removed = True

    def __enter__(self) -> "DetachedWorktree":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.remove()


def create_detached_worktree(alias: str, repository_fd: int, private_parent_fd: int) -> DetachedWorktree:
    """Create an isolated checkout below an owner-only directory."""

    before = inspect_repository(alias, repository_fd)
    repository_path = _directory_path(repository_fd, private=False)
    parent_path = _directory_path(private_parent_fd, private=True)
    name = f"worktree-{alias}"
    destination = os.path.join(parent_path, name)
    if os.path.lexists(destination):
        _reject()
    _git(repository_path, "worktree", "add", "--detach", "--quiet", destination, before["head"])
    try:
        result = DetachedWorktree(alias=alias, primary_fd=repository_fd, cwd=destination, before=before)
        result.attestation()
        return result
    except BaseException:
        try:
            _git(repository_path, "worktree", "remove", "--force", destination)
        except RepositoryGateRejected:
            pass
        raise
