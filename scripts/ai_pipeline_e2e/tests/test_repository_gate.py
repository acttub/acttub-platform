from __future__ import annotations

import os
import subprocess
import tempfile
import unittest

from scripts.ai_pipeline_e2e import controller, repository_gate


class RepositoryGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.remote = os.path.join(self.temporary.name, "remote.git")
        self.repository = os.path.join(self.temporary.name, "repository")
        self.private = os.path.join(self.temporary.name, "private")
        os.mkdir(self.private, 0o700)
        self.run_git("git", "init", "--bare", "--quiet", self.remote, cwd=self.temporary.name)
        self.run_git("git", "init", "--quiet", self.repository, cwd=self.temporary.name)
        self.run_git("git", "config", "user.email", "offline@example.invalid", cwd=self.repository)
        self.run_git("git", "config", "user.name", "Offline Test", cwd=self.repository)
        self.run_git("git", "checkout", "-b", controller.EXPECTED_BRANCHES["platform"], cwd=self.repository)
        with open(os.path.join(self.repository, "pnpm-lock.yaml"), "wb") as lockfile:
            lockfile.write(b"lockfileVersion: offline\n")
        self.run_git("git", "add", "pnpm-lock.yaml", cwd=self.repository)
        self.run_git("git", "commit", "--quiet", "-m", "offline fixture", cwd=self.repository)
        self.run_git("git", "remote", "add", "origin", self.remote, cwd=self.repository)
        self.run_git("git", "push", "--quiet", "-u", "origin", controller.EXPECTED_BRANCHES["platform"], cwd=self.repository)
        self.repository_fd = os.open(self.repository, os.O_RDONLY | os.O_DIRECTORY)
        self.private_fd = os.open(self.private, os.O_RDONLY | os.O_DIRECTORY)

    def tearDown(self) -> None:
        os.close(self.repository_fd)
        os.close(self.private_fd)
        self.temporary.cleanup()

    @staticmethod
    def run_git(*args: str, cwd: str) -> None:
        subprocess.run(args, cwd=cwd, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def test_clean_upstream_checkpoint_and_detached_worktree_are_path_redacted(self) -> None:
        checkpoint = repository_gate.inspect_repository("platform", self.repository_fd)
        self.assertEqual(checkpoint["branch"], controller.EXPECTED_BRANCHES["platform"])
        self.assertTrue(checkpoint["clean"])
        self.assertTrue(checkpoint["upstreamEqual"])
        self.assertNotIn(self.repository, repr(checkpoint))
        worktree = repository_gate.create_detached_worktree("platform", self.repository_fd, self.private_fd)
        try:
            attestation = worktree.attestation()
            self.assertEqual(attestation["head"], checkpoint["head"])
            self.assertTrue(attestation["detached"])
            self.assertTrue(attestation["primaryWorktreeUntouched"])
            self.assertNotIn(self.private, repr(worktree))
        finally:
            worktree.remove()
        self.assertEqual(repository_gate.inspect_repository("platform", self.repository_fd), checkpoint)

    def test_dirty_wrong_branch_and_upstream_divergence_fail_closed(self) -> None:
        with open(os.path.join(self.repository, "untracked.txt"), "wb") as item:
            item.write(b"dirty")
        with self.assertRaisesRegex(repository_gate.RepositoryGateRejected, "^repository_gate_rejected$"):
            repository_gate.inspect_repository("platform", self.repository_fd)
        os.unlink(os.path.join(self.repository, "untracked.txt"))

        self.run_git("git", "checkout", "--quiet", "--detach", cwd=self.repository)
        with self.assertRaises(repository_gate.RepositoryGateRejected):
            repository_gate.inspect_repository("platform", self.repository_fd)
        self.run_git("git", "checkout", "--quiet", controller.EXPECTED_BRANCHES["platform"], cwd=self.repository)

        with open(os.path.join(self.repository, "pnpm-lock.yaml"), "ab") as lockfile:
            lockfile.write(b"local")
        self.run_git("git", "add", "pnpm-lock.yaml", cwd=self.repository)
        self.run_git("git", "commit", "--quiet", "-m", "local divergence", cwd=self.repository)
        with self.assertRaises(repository_gate.RepositoryGateRejected):
            repository_gate.inspect_repository("platform", self.repository_fd)


if __name__ == "__main__":
    unittest.main()
