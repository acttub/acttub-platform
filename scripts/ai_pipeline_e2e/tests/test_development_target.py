from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from scripts.ai_pipeline_e2e import mcp_bridge


PROJECT_REF = "abcdefghijklmnopqrst"
FIXTURE_URL = f"https://{PROJECT_REF}.supabase.co"
KEY = hashlib.sha256(b"offline-development-target-fixture").digest()
NODE = shutil.which("node")
if NODE is None:
    raise RuntimeError("node_unavailable")


def run_node(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--input-type=module", "--eval", source],
        cwd=".",
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )


class DevelopmentTargetTests(unittest.TestCase):
    def test_node_and_python_use_the_same_project_ref_domain(self) -> None:
        expected = mcp_bridge.project_ref_hmac(KEY, PROJECT_REF)
        source = f"""
          import {{ developmentTargetHmac, projectRefFromSupabaseUrl }} from './scripts/ai_pipeline_e2e/development_target.mjs';
          const key = Buffer.from({json.dumps(KEY.hex())}, 'hex');
          const url = {json.dumps(FIXTURE_URL)};
          process.stdout.write(JSON.stringify({{ projectRef: projectRefFromSupabaseUrl(url), hmac: developmentTargetHmac(key, url) }}));
        """
        completed = run_node(source)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout), {"projectRef": PROJECT_REF, "hmac": expected})

    def test_rejects_noncanonical_or_unbound_targets(self) -> None:
        source = f"""
          import {{ assertDevelopmentTarget }} from './scripts/ai_pipeline_e2e/development_target.mjs';
          const key = Buffer.from({json.dumps(KEY.hex())}, 'hex');
          const invalid = [
            'http://{PROJECT_REF}.supabase.co',
            'https://{PROJECT_REF}.supabase.co/path',
            'https://user@{PROJECT_REF}.supabase.co',
            'https://short.supabase.co',
            'https://{PROJECT_REF}.example.com'
          ];
          let rejected = 0;
          for (const value of invalid) {{ try {{ assertDevelopmentTarget(key, value, 'hmac-sha256:' + '0'.repeat(64)); }} catch {{ rejected += 1; }} }}
          try {{ assertDevelopmentTarget(key, {json.dumps(FIXTURE_URL)}, 'hmac-sha256:' + '0'.repeat(64)); }} catch {{ rejected += 1; }}
          process.stdout.write(String(rejected));
        """
        completed = run_node(source)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "6")

    def test_platform_bootstrap_validates_target_without_exporting_run_key(self) -> None:
        source_path = Path("scripts/ai_pipeline_e2e/platform_bootstrap.mjs")
        platform_key = hmac.new(
            KEY,
            b"acttub-protected-platform-target-key.v1\0",
            hashlib.sha256,
        ).digest()
        development_target = mcp_bridge.project_ref_hmac(KEY, PROJECT_REF)
        platform_proof = "hmac-sha256:" + hmac.new(
            platform_key,
            b"acttub-protected-platform-target-proof.v1\0" + development_target.encode("ascii") + b"\0" + PROJECT_REF.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        settings = {
            "ACTTUB_DEVELOPMENT_TARGET_HMAC": development_target,
            "ACTTUB_AI_AGENT_URL": "http://127.0.0.1:43102",
            "ACTTUB_AI_REPORT_URL": "http://127.0.0.1:43103",
            "ACTTUB_AI_SUMMARY_URL": "http://127.0.0.1:43101",
            "ACTTUB_AI_TIMEOUT_MS": "120000",
            "ACTTUB_PLATFORM_TARGET_KEY_HEX": platform_key.hex(),
            "ACTTUB_PLATFORM_TARGET_PROOF_HMAC": platform_proof,
            "NEXT_PUBLIC_APP_URL": "http://127.0.0.1:43100",
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "offline-publishable-key",
            "NEXT_PUBLIC_SUPABASE_URL": FIXTURE_URL,
            "NODE_ENV": "production",
            "SUPABASE_SERVICE_ROLE_KEY": "offline-service-role-key",
        }
        with tempfile.TemporaryDirectory(prefix="protected-target-bootstrap-") as temporary:
            root = Path(temporary)
            (root / "platform_bootstrap.mjs").write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
            package = root / "node_modules" / "next"
            module = package / "dist" / "bin" / "next.mjs"
            module.parent.mkdir(parents=True)
            (package / "package.json").write_text(
                json.dumps({"name": "next", "type": "module", "exports": {"./dist/bin/next": "./dist/bin/next.mjs"}}),
                encoding="utf-8",
            )
            module.write_text(
                'process.stdout.write(JSON.stringify({key:Object.hasOwn(process.env,"ACTTUB_PLATFORM_TARGET_KEY_HEX"),proof:Object.hasOwn(process.env,"ACTTUB_PLATFORM_TARGET_PROOF_HMAC"),target:Object.hasOwn(process.env,"ACTTUB_DEVELOPMENT_TARGET_HMAC"),supabase:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)}));',
                encoding="utf-8",
            )
            command = [NODE, str(root / "platform_bootstrap.mjs"), "build"]
            completed = subprocess.run(
                command,
                input=json.dumps(settings).encode("utf-8"),
                cwd=root,
                env={"PATH": os.defpath},
                check=False,
                capture_output=True,
                timeout=10,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(completed.stdout), {"key": False, "proof": False, "target": False, "supabase": True})

            settings["ACTTUB_DEVELOPMENT_TARGET_HMAC"] = "hmac-sha256:" + "0" * 64
            rejected = subprocess.run(
                command,
                input=json.dumps(settings).encode("utf-8"),
                cwd=root,
                env={"PATH": os.defpath},
                check=False,
                capture_output=True,
                timeout=10,
            )
            self.assertEqual(rejected.returncode, 70)
            self.assertEqual(rejected.stdout, b"")


if __name__ == "__main__":
    unittest.main()
