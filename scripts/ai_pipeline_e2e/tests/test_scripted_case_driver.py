from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DRIVER = ROOT / "scripts" / "ai_pipeline_e2e" / "scripted_case_driver.mjs"
KEY = bytes(range(32))
HMAC_PREFIX = "hmac-sha256:"
CASE_IDS = (
    "SAFE-01", "SRC-01", "DB-01", "DB-02", "GUARD-01", "GUARD-02", "GUARD-03",
    "MEDIA-01", "MEDIA-02", "MEDIA-03", "LEGACY-01", "BLOCKED-01", "PAUSE-01",
    "MANUAL-01", "BOUNDARY-05", "BOUNDARY-10R", "BOUNDARY-10N", "COUNT-01", "REPORT-01",
)


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("ascii")


def mac(domain: bytes, value: object) -> str:
    return HMAC_PREFIX + hmac.new(KEY, domain + canonical(value), hashlib.sha256).hexdigest()


def passing_measurements() -> dict[str, dict[str, object]]:
    return {
        "SAFE-01": {"production_actions": 0, "forbidden_artifacts": 0, "sanitizer_canary_blocked": True},
        "SRC-01": {"four_repository_heads_clean": True, "pinned_sources_match": True, "acceptance_digests_match": True},
        "DB-01": {"migration_preflight_exact": True, "development_target_verified": True, "production_negative_verified": True},
        "DB-02": {"migration_postflight_exact": True, "optional_note_concurrency_atomic": True, "optional_note_rows": 1},
        "GUARD-01": {"required_consent_missing_blocked": True, "provider_calls": 0},
        "GUARD-02": {"adult_attestation_missing_blocked": True, "provider_calls": 0},
        "GUARD-03": {"participant_consent_missing_blocked": True, "provider_calls": 0},
        "MEDIA-01": {"duration_300_seconds_allowed": True},
        "MEDIA-02": {"duration_over_300_seconds_blocked": True, "provider_calls": 0},
        "MEDIA-03": {"unreadable_metadata_blocked": True, "provider_calls": 0},
        "LEGACY-01": {"legacy_backfill_absent": True, "legacy_delete_allowed": True},
        "BLOCKED-01": {"all_observations_blocked": True, "report_not_created": True},
        "PAUSE-01": {"manual_stop_paused": True, "report_not_created": True},
        "MANUAL-01": {"manual_stop_report_ready": True, "reports_created": 1},
        "BOUNDARY-05": {"no_normal_completion_before_five": True, "fifth_answer_boundary_valid": True},
        "BOUNDARY-10R": {"tenth_answer_terminal": True, "report_ready": True, "reports_created": 1},
        "BOUNDARY-10N": {"tenth_answer_terminal": True, "insufficient_interview_evidence": True, "reports_created": 0},
        "COUNT-01": {"answer_count_exact": True, "unknown_counts_only_toward_cap": True, "optional_note_excluded": True},
        "REPORT-01": {"successful_report_immutable": True, "failed_report_retry_reuses_inputs": True, "successful_report_rows": 1},
    }


def settings() -> dict[str, object]:
    foundation_measurements = {
        "SAFE-01": passing_measurements()["SAFE-01"],
        "SRC-01": passing_measurements()["SRC-01"],
        "DB-01": passing_measurements()["DB-01"],
        "migration_postflight_exact": True,
    }
    foundation_core = {"schemaVersion": "scripted-case-foundation.v1", "measurements": foundation_measurements}
    identifier = "00000000-0000-4000-8000-000000000001"
    session_path = f"/api/v1/practice-sessions/{identifier}"
    plans = {}
    for case_id in CASE_IDS[4:]:
        if case_id.startswith("GUARD-"):
            plans[case_id] = [{"method": "POST", "path": "/api/v1/practice-upload-intents", "body": {"adultConfirmed": False}, "headers": {}, "parallelGroup": None}]
        elif case_id.startswith("MEDIA-"):
            plans[case_id] = [{"method": "POST", "path": f"/api/v1/practice-upload-intents/{identifier}/finalize", "body": {"storagePath": "opaque"}, "headers": {}, "parallelGroup": None}]
        elif case_id == "LEGACY-01":
            plans[case_id] = [{"method": "DELETE", "path": session_path, "body": None, "headers": {"idempotency-key": identifier}, "parallelGroup": None}]
        elif case_id == "COUNT-01":
            plans[case_id] = [
                {"method": "PUT", "path": f"{session_path}/optional-note", "body": {"content": "synthetic-a"}, "headers": {}, "parallelGroup": 1},
                {"method": "PUT", "path": f"{session_path}/optional-note", "body": {"content": "synthetic-b"}, "headers": {}, "parallelGroup": 1},
                {"method": "GET", "path": session_path, "body": None, "headers": {}, "parallelGroup": None},
            ]
        elif case_id == "REPORT-01":
            plans[case_id] = [{"method": "POST", "path": f"{session_path}/report/retry", "body": None, "headers": {}, "parallelGroup": None}]
        else:
            plans[case_id] = [{"method": "GET", "path": session_path, "body": None, "headers": {}, "parallelGroup": None}]
    cleanup_plan = [
        {"method": "DELETE", "path": session_path, "body": None, "headers": {"idempotency-key": identifier}, "parallelGroup": None},
        {"method": "GET", "path": f"{session_path}/deletion/{identifier}", "body": None, "headers": {}, "parallelGroup": None},
    ]
    return {
        "schemaVersion": "scripted-case-settings.v1",
        "platformOrigin": "http://127.0.0.1:43100",
        "timeoutMs": 1000,
        "foundation": {**foundation_core, "resultHmac": mac(b"acttub-scripted-case-foundation.v1\0", foundation_core)},
        "scenarioPlans": plans,
        "cleanupPlan": cleanup_plan,
        "planHmac": mac(b"acttub-scripted-case-plan.v1\0", {"scenarioPlans": plans, "cleanupPlan": cleanup_plan}),
    }


def private_file(data: bytes = b""):
    item = tempfile.TemporaryFile()
    os.fchmod(item.fileno(), 0o600)
    item.write(data)
    item.flush()
    item.seek(0)
    return item


class ScriptedCaseDriverTests(unittest.TestCase):
    def run_driver(self, *, cleanup: bool = True, mutate: str = "none") -> tuple[subprocess.CompletedProcess[str], bytes]:
        config = settings()
        if mutate == "foundation":
            config["foundation"]["measurements"]["SAFE-01"]["production_actions"] = 1
        files = [private_file(canonical(config)), private_file(KEY), private_file()]
        measurements = passing_measurements()
        source = f"""
          import {{ runScriptedCases }} from {json.dumps(DRIVER.as_uri())};
          const values = {json.dumps(measurements, separators=(',', ':'))};
          let cleaned = 0;
          const factory = async () => ({{
            async runCase(caseId) {{ return structuredClone(values[caseId]); }},
            async finish() {{ return {{ cleaned: true, optionalNoteConcurrencyAtomic: true, optionalNoteRows: 1 }}; }},
            async cleanup() {{ cleaned += 1; return {{ cleaned: {str(cleanup).lower()} }}; }},
          }});
          try {{
            const receipt = await runScriptedCases({{settingsFd:{files[0].fileno()},macKeyFd:{files[1].fileno()},receiptFd:{files[2].fileno()},adapterFactory:factory}});
            if (cleaned !== 1 || receipt.caseCount !== 19) process.exitCode = 71;
          }} catch {{ process.exitCode = 70; }}
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            pass_fds=tuple(item.fileno() for item in files),
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        files[2].seek(0)
        receipt = files[2].read()
        for item in files:
            item.close()
        return completed, receipt

    def test_import_is_inert_and_success_receipt_is_closed_authenticated_and_safe(self) -> None:
        imported = subprocess.run(["node", str(DRIVER)], cwd=ROOT, capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(imported.returncode, 0)
        self.assertEqual(imported.stdout, "")
        self.assertEqual(imported.stderr, "")

        completed, raw = self.run_driver()
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, "")
        self.assertEqual(completed.stderr, "")
        receipt = json.loads(raw)
        self.assertEqual(
            set(receipt),
            {"schemaVersion", "completed", "caseCount", "providerCredentialPresent", "cleanupVerified", "cases", "scenarioHmac", "resultHmac"},
        )
        self.assertEqual([item["caseId"] for item in receipt["cases"]], list(CASE_IDS))
        self.assertEqual(receipt["cases"][3]["measurements"], passing_measurements()["DB-02"])
        self.assertFalse(receipt["providerCredentialPresent"])
        core = dict(receipt)
        result_hmac = core.pop("resultHmac")
        self.assertEqual(result_hmac, mac(b"acttub-scripted-case-receipt.v1\0", core))
        serialized = raw.decode("ascii")
        for forbidden in ("http://", "https://", "cookie", "token", "storage", "sessionId", "uploadIntentId", "error", "payload", "text"):
            self.assertNotIn(forbidden, serialized)

    def test_forged_foundation_and_cleanup_failure_leave_no_receipt(self) -> None:
        forged, forged_receipt = self.run_driver(mutate="foundation")
        self.assertEqual(forged.returncode, 70)
        self.assertEqual(forged_receipt, b"")
        cleanup, cleanup_receipt = self.run_driver(cleanup=False)
        self.assertEqual(cleanup.returncode, 70)
        self.assertEqual(cleanup_receipt, b"")

    def test_default_adapter_uses_only_loopback_versioned_api_and_derives_guard_result(self) -> None:
        source = f"""
          import {{ createLoopbackScenarioAdapter }} from {json.dumps(DRIVER.as_uri())};
          const calls = [];
          const adapter = createLoopbackScenarioAdapter({{
            platformOrigin: 'http://127.0.0.1:43100', timeoutMs: 1000,
            scenarioPlans: {{'GUARD-01':[{{method:'POST',path:'/api/v1/practice-upload-intents',body:{{adultConfirmed:true}},headers:{{}},parallelGroup:null}}]}},
          }}, async (url, options) => {{
            calls.push([String(url), options.method]);
            return new Response(JSON.stringify({{error:{{code:'terms_required'}}}}), {{status:403,headers:{{'content-type':'application/json'}}}});
          }});
          const result = await adapter.runCase('GUARD-01');
          if (JSON.stringify(result) !== JSON.stringify({{required_consent_missing_blocked:true,provider_calls:0}})) process.exitCode=71;
          if (JSON.stringify(calls) !== JSON.stringify([['http://127.0.0.1:43100/api/v1/practice-upload-intents','POST']])) process.exitCode=72;
        """
        completed = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT, capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "")
        self.assertEqual(completed.stderr, "")

    def test_default_adapter_runs_optional_note_writes_concurrently_and_synthetic_media_is_local(self) -> None:
        source = f"""
          import {{ createLoopbackScenarioAdapter, syntheticIsoBmff, unreadableSyntheticMedia }} from {json.dumps(DRIVER.as_uri())};
          const sessionPath='/api/v1/practice-sessions/00000000-0000-4000-8000-000000000001';
          const plan=[
            {{method:'PUT',path:sessionPath+'/optional-note',body:{{content:'a'}},headers:{{}},parallelGroup:1}},
            {{method:'PUT',path:sessionPath+'/optional-note',body:{{content:'b'}},headers:{{}},parallelGroup:1}},
            {{method:'GET',path:sessionPath,body:null,headers:{{}},parallelGroup:null}},
          ];
          const transcript=[];
          for(let index=0;index<5;index+=1) transcript.push({{id:'a'+index,role:'actor',kind:'answer'}});
          for(let index=0;index<5;index+=1) transcript.push({{id:'u'+index,role:'actor',kind:'unknown'}});
          transcript.push({{id:'n',role:'actor',kind:'optional_note'}});
          let active=0,maxActive=0,calls=0;
          const adapter=createLoopbackScenarioAdapter({{platformOrigin:'http://127.0.0.1:43100',timeoutMs:1000,scenarioPlans:{{'COUNT-01':plan}}}},async()=>{{
            calls+=1; active+=1; maxActive=Math.max(maxActive,active);
            await new Promise(resolve=>setTimeout(resolve,10)); active-=1;
            const body=calls<3?{{optionalNote:'safe'}}:{{session:{{transcript,substantiveAnswerCount:5,reportEvidenceAnswerTurnIds:[]}}}};
            return new Response(JSON.stringify(body),{{status:200,headers:{{'content-type':'application/json'}}}});
          }});
          const result=await adapter.runCase('COUNT-01');
          const finished=await adapter.finish();
          if(!result.answer_count_exact||!result.unknown_counts_only_toward_cap||!result.optional_note_excluded)process.exitCode=71;
          if(maxActive!==2||!finished.optionalNoteConcurrencyAtomic||finished.optionalNoteRows!==1)process.exitCode=72;
          const exact=syntheticIsoBmff(300000),over=syntheticIsoBmff(300001),bad=unreadableSyntheticMedia();
          if(!Buffer.isBuffer(exact)||!Buffer.isBuffer(over)||!Buffer.isBuffer(bad)||exact.equals(over)||bad.includes(Buffer.from('moov')))process.exitCode=73;
        """
        completed = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT, capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "")
        self.assertEqual(completed.stderr, "")


if __name__ == "__main__":
    unittest.main()
