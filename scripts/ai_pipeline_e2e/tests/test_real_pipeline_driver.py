from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from typing import BinaryIO


ROOT = Path(__file__).resolve().parents[3]
DRIVER = ROOT / "scripts" / "ai_pipeline_e2e" / "real_pipeline_driver.mjs"
NODE = shutil.which("node")
if NODE is None:
    raise RuntimeError("node_unavailable")

MEDIA = b"offline-real-pipeline-media"
KEY = hashlib.sha256(b"offline-real-pipeline-key").digest()
PROJECT_REF = "offlinerealpipeline0"
HOST = f"{PROJECT_REF}.supabase.co"


def mac(domain: bytes, value: bytes) -> str:
    return "hmac-sha256:" + hmac.new(KEY, domain + value, hashlib.sha256).hexdigest()


def settings(*, browser: bool) -> dict[str, object]:
    return {
        "schemaVersion": "real-pipeline-settings.v1",
        "platformOrigin": "http://127.0.0.1:31415",
        "supabaseUrl": f"https://{HOST}",
        "publishableKey": "offline-publishable-key-value",
        "serviceRoleKey": "offline-service-role-key-value",
        "storageBucket": "practice-videos",
        "mimeType": "video/mp4",
        "maximumMediaBytes": len(MEDIA),
        "expectedMediaHmac": mac(b"acttub-platform-media.v1\0", MEDIA),
        "developmentTargetHmac": mac(
            b"acttub-protected-supabase-project-ref.v1\0",
            PROJECT_REF.encode("ascii"),
        ),
        "browserHandoff": (
            {
                "nonce": hashlib.sha256(b"offline-browser-nonce").hexdigest(),
                "brokerPort": 43141,
                "targetPort": 43142,
            }
            if browser
            else None
        ),
    }


def fake_wrapper(
    *,
    settings_fd: int,
    media_fd: int,
    key_fd: int,
    receipt_fd: int,
    handoff_fd: int | None,
    ack_fd: int | None,
    cleanup_fd: int,
    failure_mode: str | None,
) -> bytes:
    source = f"""
      import crypto from "node:crypto";
      import fs from "node:fs";
      import {{ runRealPipeline, canonicalJson }} from {json.dumps(DRIVER.as_uri())};
      const failureMode = {json.dumps(failure_mode)};
      let externalCalls = 0;
      globalThis.fetch = async () => {{ externalCalls += 1; throw new Error("offline"); }};
      const id = () => crypto.randomUUID();
      const opaque = () => crypto.randomBytes(32).toString("hex");
      const clone = (value) => structuredClone(value);
      const primaryUserId = id();
      const temporaryUserId = id();
      const cookieJar = () => ({{ header: () => `sb-${{opaque()}}=${{opaque()}}` }});
      const primary = {{ userId: primaryUserId, accessToken: opaque(), refreshToken: opaque(), cookieJar: cookieJar() }};
      const temporary = {{ userId: temporaryUserId, accessToken: opaque(), refreshToken: opaque(), cookieJar: cookieJar() }};
      const intents = new Map();
      const sessions = new Map();
      const storage = new Set();
      const replays = new Map();
      const deletions = new Map();
      let mainSessionId = null;
      let temporaryPresent = false;
      let temporaryDeleteCount = 0;
      let lifecycleDeleteCount = 0;
      let removeCount = 0;
      let bundleCleanupCount = 0;

      const reportSection = (observationId, answerId, kind) => ({{
        status: "confirmed",
        content: opaque(),
        observationEvidenceIds: kind === "actor" ? [] : [observationId],
        turnEvidenceIds: kind === "encouragement" || kind === "review" ? [] : [answerId],
        timestampRange: kind === "review" ? {{ startMs: 0, endMs: 1 }} : null,
      }});
      const makeReport = (session) => {{
        const observationId = session.observations[0].id;
        const answerId = session.reportEvidenceAnswerTurnIds[0];
        return {{
          sessionId: session.sessionId,
          sourceRunId: session.runs.find((run) => run.stage === "report").id,
          schemaVersion: "report.v1",
          completionReason: "hard_limit_report_ready",
          oneLineSummary: reportSection(observationId, answerId, "normal"),
          primaryReviewPoint: reportSection(observationId, answerId, "review"),
          confirmedEvidence: reportSection(observationId, answerId, "normal"),
          actorDiscovery: reportSection(observationId, answerId, "actor"),
          groundedEncouragement: reportSection(observationId, answerId, "encouragement"),
          nextPracticeStep: reportSection(observationId, answerId, "normal"),
          createdAt: "2026-01-01T00:00:00.000Z",
        }};
      }};
      const makeSession = (body) => {{
        const sourceRunId = id();
        const observationId = id();
        return {{
          sessionId: body.sessionId,
          userId: primaryUserId,
          summary: {{ sourceRunId, normalizedSummary: {{ schemaVersion: "scene-summary.v1" }} }},
          observations: [{{ id: observationId, sourceRunId, confirmationState: "pending", blockedForQuestioning: true }}],
          transcript: [],
          runs: [{{ id: sourceRunId, stage: "summary", status: "completed" }}],
          substantiveAnswerCount: 0,
          reportEvidenceObservationIds: [],
          reportEvidenceAnswerTurnIds: [],
          interviewStatus: "ready",
          completionReason: null,
          report: null,
          storagePath: body.storagePath,
          uploadIntentId: body.uploadIntentId,
        }};
      }};
      const sessionFromPath = (path) => {{
        const match = path.match(/^\\/api\\/v1\\/practice-sessions\\/([0-9a-f-]{{36}})(?:\\/|$)/u);
        return match ? sessions.get(match[1]) : null;
      }};
      const adapterFactory = async () => ({{
        async establishExistingPrimary() {{ return primary; }},
        async createTemporaryUserSession() {{ temporaryPresent = true; return temporary; }},
        async deleteTemporaryUser() {{
          if (!temporaryPresent) return {{ deleted: true, deletedCount: 0 }};
          temporaryPresent = false;
          temporaryDeleteCount += 1;
          if (failureMode === "receipt-write") fs.closeSync({receipt_fd});
          return {{ deleted: true, deletedCount: 1 }};
        }},
        async uploadMedia(_session, storagePath, media) {{
          if (!(media instanceof Buffer) || media.length < 1 || storage.has(storagePath)) throw new Error("stub");
          storage.add(storagePath);
          return {{ uploaded: true }};
        }},
        async removeMedia(storagePath) {{ storage.delete(storagePath); removeCount += 1; return {{ removed: true }}; }},
        async mediaExists(storagePath) {{ return {{ exists: storage.has(storagePath) }}; }},
        async cleanupSessionBundle(actor, bundle) {{
          const session = sessions.get(bundle.sessionId);
          if (session && session.userId !== actor.userId) throw new Error("stub");
          sessions.delete(bundle.sessionId);
          if (storage.delete(bundle.storagePath)) removeCount += 1;
          intents.delete(bundle.uploadIntentId);
          bundleCleanupCount += 1;
          if (sessions.has(bundle.sessionId) || storage.has(bundle.storagePath) || intents.has(bundle.uploadIntentId)) throw new Error("stub");
          return {{ absent: true }};
        }},
        async api(actor, request) {{
          const {{ method, path, body, headers }} = request;
          if (method === "POST" && path === "/api/v1/terms/acceptances") return {{ status: 200, data: {{ accepted: true, requiredConsentAccepted: true, aiProcessingConsentAccepted: true }} }};
          if (method === "POST" && path === "/api/v1/practice-upload-intents") {{
            const uploadIntentId = body.uploadIntentId, sessionId = body.sessionId, storagePath = `users/${{actor.userId}}/practice-sessions/${{sessionId}}/take.mp4`;
            intents.set(uploadIntentId, {{ sessionId, storagePath }});
            return {{ status: 201, data: {{ uploadIntent: {{ uploadIntentId, sessionId, storagePath, storageBucket: "practice-videos" }} }} }};
          }}
          const finalize = path.match(/^\\/api\\/v1\\/practice-upload-intents\\/([0-9a-f-]{{36}})\\/finalize$/u);
          if (method === "POST" && finalize) {{
            if (failureMode === "finalize") return {{ status: 503, data: {{ safeCode: "offline" }} }};
            const intent = intents.get(finalize[1]);
            return {{ status: 200, data: {{ uploadIntentId: finalize[1], storagePath: intent.storagePath, mediaMetadataVersion: "iso-bmff-duration.v1", durationMs: 1 }} }};
          }}
          if (method === "POST" && path === "/api/v1/practice-sessions") {{
            const session = makeSession(body);
            sessions.set(session.sessionId, session);
            if (mainSessionId === null) mainSessionId = session.sessionId;
            if (failureMode === "session-response-lost") return {{ status: 599, data: {{ safeCode: "offline" }} }};
            return {{ status: 201, data: {{ session: clone(session), summaryRun: clone(session.runs[0]) }} }};
          }}
          const confirmation = path.match(/^\\/api\\/v1\\/practice-sessions\\/([0-9a-f-]{{36}})\\/observations\\/([0-9a-f-]{{36}})\\/confirmation$/u);
          if (method === "POST" && confirmation) {{
            const session = sessions.get(confirmation[1]);
            session.observations[0].confirmationState = "accepted";
            session.observations[0].blockedForQuestioning = false;
            return {{ status: 200, data: clone(session) }};
          }}
          if (method === "POST" && path.endsWith("/interview/start")) {{
            const session = sessionFromPath(path);
            session.runs.push({{ id: id(), stage: "agent", status: "completed" }});
            session.interviewStatus = "active";
            return {{ status: 200, data: {{ done: false, agentTurn: {{ id: id() }} }} }};
          }}
          if (method === "POST" && path.endsWith("/interview/turns")) {{
            if (replays.has(body.requestId)) return {{ status: 200, data: clone(replays.get(body.requestId)) }};
            const session = sessionFromPath(path);
            const actorTurn = {{ id: id(), role: "actor", kind: "answer" }};
            session.transcript.push(actorTurn);
            session.substantiveAnswerCount += 1;
            session.runs.push({{ id: id(), stage: "agent", status: "completed" }});
            const done = session.substantiveAnswerCount === 5;
            let response;
            if (done) {{
              session.interviewStatus = "completed";
              session.completionReason = "hard_limit_report_ready";
              session.reportEvidenceObservationIds = [session.observations[0].id];
              session.reportEvidenceAnswerTurnIds = session.transcript.map((turn) => turn.id);
              session.runs.push({{ id: id(), stage: "report", status: "completed" }});
              session.report = makeReport(session);
              response = {{ actorTurn, agentTurn: {{ id: id() }}, done: true, completionReason: session.completionReason, reportReady: true, reportEvidence: {{ observationIds: session.reportEvidenceObservationIds, answerTurnIds: session.reportEvidenceAnswerTurnIds }}, report: clone(session.report) }};
            }} else {{
              response = {{ actorTurn, agentTurn: {{ id: id() }}, done: false, completionReason: null, reportReady: false, reportEvidence: {{ observationIds: [], answerTurnIds: [] }}, report: null }};
            }}
            replays.set(body.requestId, clone(response));
            return {{ status: 200, data: response }};
          }}
          if (method === "GET" && path.endsWith("/report")) {{
            const session = sessionFromPath(path);
            if (!session || actor.userId !== session.userId) return {{ status: 404, data: {{ safeCode: "not_found" }} }};
            if (failureMode === "report") return {{ status: 200, data: {{ schemaVersion: "report.v1" }} }};
            return {{ status: 200, data: clone(session.report) }};
          }}
          if (method === "POST" && path.endsWith("/report/retry")) return {{ status: 200, data: clone(sessionFromPath(path).report) }};
          if (method === "DELETE") {{
            const sessionId = path.split("/").at(-1), requestId = headers["Idempotency-Key"], session = sessions.get(sessionId);
            if (!session || actor.userId !== session.userId) return {{ status: 404, data: {{ safeCode: "not_found" }} }};
            storage.delete(session.storagePath);
            intents.delete(session.uploadIntentId);
            sessions.delete(sessionId);
            lifecycleDeleteCount += 1;
            deletions.set(`${{sessionId}}:${{requestId}}`, {{ requestId, status: "completed", storageDeleted: true, rowsDeleted: true }});
            return {{ status: 202, data: {{ requestId, status: "completed" }} }};
          }}
          const deletion = path.match(/^\\/api\\/v1\\/practice-sessions\\/([0-9a-f-]{{36}})\\/deletion\\/([0-9a-f-]{{36}})$/u);
          if (method === "GET" && deletion) return {{ status: 200, data: clone(deletions.get(`${{deletion[1]}}:${{deletion[2]}}`)) }};
          if (method === "GET" && path.startsWith("/api/v1/practice-sessions/")) {{
            const session = sessionFromPath(path);
            if (!session || actor.userId !== session.userId) return {{ status: 404, data: {{ safeCode: "not_found" }} }};
            return {{ status: 200, data: {{ session: clone(session) }} }};
          }}
          throw new Error("unhandled-stub-request");
        }},
      }});

      let result = null;
      let caught = null;
      try {{
        result = await runRealPipeline({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {receipt_fd},
          handoffFd: {"null" if handoff_fd is None else handoff_fd},
          handoffAckFd: {"null" if ack_fd is None else ack_fd}, cleanupFd: {cleanup_fd},
          cleanupTimeoutMs: failureMode === "cleanup-silent" ? 100 : 30000, adapterFactory,
        }});
      }} catch (error) {{ caught = error; }}
      let valid = externalCalls === 0;
      if (failureMode === null) {{
        valid = valid && caught === null && result?.completed === true && result?.deletionLifecycleVerified === true;
        valid = valid && result?.browserHandoffAcknowledged === {str(handoff_fd is not None).lower()};
        valid = valid && temporaryDeleteCount === 1 && lifecycleDeleteCount === 1 && sessions.size === 1 && storage.size === 1;
        const main = sessions.get(mainSessionId);
        const expectedBinding = `hmac-sha256:${{crypto.createHmac("sha256", Buffer.from({json.dumps(KEY.hex())}, "hex")).update(Buffer.from("acttub-browser-binding.v1\\0", "ascii")).update(Buffer.from(canonicalJson([mainSessionId, main.report.sourceRunId]), "ascii")).digest("hex")}}`;
        valid = valid && result?.browserBindingHmac === expectedBinding;
      }} else if (failureMode === "finalize") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_HTTP_FAILED" && sessions.size === 0 && storage.size === 0 && removeCount === 1;
      }} else if (failureMode === "report") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_CONTRACT_FAILED" && sessions.size === 0 && storage.size === 0 && lifecycleDeleteCount === 1;
      }} else if (failureMode === "session-response-lost") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_HTTP_FAILED" && sessions.size === 0 && storage.size === 0 && intents.size === 0;
        valid = valid && lifecycleDeleteCount === 0 && bundleCleanupCount === 1;
      }} else if (failureMode === "handoff-ack") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_AUTH_FAILED" && sessions.size === 0 && storage.size === 0 && intents.size === 0;
      }} else if (failureMode === "receipt-write") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_BAD_INPUT" && sessions.size === 0 && storage.size === 0 && intents.size === 0;
      }} else if (failureMode === "cleanup-ack") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_CLEANUP_FAILED" && sessions.size === 0 && storage.size === 0;
      }} else if (failureMode === "cleanup-silent") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_CLEANUP_FAILED" && sessions.size === 0 && storage.size === 0 && intents.size === 0;
      }} else {{ valid = false; }}
      primary.accessToken = ""; primary.refreshToken = ""; temporary.accessToken = ""; temporary.refreshToken = "";
      process.exitCode = valid ? 0 : 90;
    """
    return source.encode("utf-8")


def input_failure_wrapper(
    *, settings_fd: int, media_fd: int, key_fd: int, receipt_fd: int, cleanup_fd: int
) -> bytes:
    source = f"""
      import {{ runRealPipeline }} from {json.dumps(DRIVER.as_uri())};
      let calls = 0, caught = null;
      try {{
        await runRealPipeline({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {receipt_fd}, cleanupFd: {cleanup_fd},
          adapterFactory: async () => {{ calls += 1; throw new Error("must-not-run"); }},
        }});
      }} catch (error) {{ caught = error; }}
      process.exitCode = calls === 0 && caught?.safeCode === "REAL_PIPELINE_BAD_INPUT" ? 0 : 91;
    """
    return source.encode("utf-8")


def private_file(contents: bytes) -> BinaryIO:
    item = tempfile.TemporaryFile()
    os.fchmod(item.fileno(), 0o600)
    item.write(contents)
    item.flush()
    item.seek(0)
    return item


class RealPipelineDriverTests(unittest.TestCase):
    def run_stub(
        self, *, browser: bool = False, failure_mode: str | None = None
    ) -> tuple[dict[str, object] | None, dict[str, object] | None]:
        raw_settings = json.dumps(settings(browser=browser), separators=(",", ":")).encode("utf-8")
        files = [
            private_file(raw_settings),
            private_file(MEDIA),
            private_file(KEY),
            private_file(b""),
        ]
        handoff_parent: socket.socket | None = None
        ack_parent: socket.socket | None = None
        handoff_child: socket.socket | None = None
        ack_child: socket.socket | None = None
        cleanup_parent, cleanup_child = socket.socketpair()
        cleanup_frames: list[dict[str, object]] = []
        cleanup_error: list[BaseException] = []

        def cleanup_broker() -> None:
            pending = b""
            try:
                while chunk := cleanup_parent.recv(4096):
                    pending += chunk
                    while b"\n" in pending:
                        raw, pending = pending.split(b"\n", 1)
                        frame = json.loads(raw)
                        cleanup_frames.append(frame)
                        if failure_mode == "cleanup-silent":
                            continue
                        if frame["operation"] == "plan":
                            cleanup_parent.sendall(json.dumps({
                                "schemaVersion": "cleanup-plan-ack.invalid" if failure_mode == "cleanup-ack" else "cleanup-plan-ack.v1",
                                "operation": "plan",
                                "resourceAlias": frame["resourceAlias"],
                                "planReceiptHmac": "hmac-sha256:" + hashlib.sha256(raw).hexdigest(),
                            }, separators=(",", ":")).encode("ascii") + b"\n")
                        elif frame["operation"] == "complete":
                            cleanup_parent.sendall(json.dumps({
                                "schemaVersion": "cleanup-complete-ack.v1",
                                "operation": "complete",
                                "resourceAlias": frame["resourceAlias"],
                                "planReceiptHmac": frame["planReceiptHmac"],
                                "outcome": frame["outcome"],
                            }, separators=(",", ":")).encode("ascii") + b"\n")
            except (OSError, BaseException) as error:
                if not isinstance(error, OSError):
                    cleanup_error.append(error)

        broker_thread = threading.Thread(target=cleanup_broker, daemon=True)
        broker_thread.start()
        try:
            pass_fds = [item.fileno() for item in files] + [cleanup_child.fileno()]
            if browser:
                handoff_parent, handoff_child = socket.socketpair()
                ack_parent, ack_child = socket.socketpair()
                pass_fds.extend([handoff_child.fileno(), ack_child.fileno()])
            process = subprocess.Popen(
                (NODE, "--input-type=module"),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=tuple(pass_fds),
                close_fds=True,
                env={"PATH": os.defpath},
            )
            assert process.stdin is not None
            process.stdin.write(
                fake_wrapper(
                    settings_fd=files[0].fileno(),
                    media_fd=files[1].fileno(),
                    key_fd=files[2].fileno(),
                    receipt_fd=files[3].fileno(),
                    handoff_fd=handoff_child.fileno() if handoff_child else None,
                    ack_fd=ack_child.fileno() if ack_child else None,
                    cleanup_fd=cleanup_child.fileno(),
                    failure_mode=failure_mode,
                )
            )
            process.stdin.close()
            if handoff_child:
                handoff_child.close()
            if ack_child:
                ack_child.close()
            cleanup_child.close()
            handoff: dict[str, object] | None = None
            if browser:
                assert handoff_parent is not None and ack_parent is not None
                handoff_parent.settimeout(5)
                chunks: list[bytes] = []
                while not chunks or not b"".join(chunks).endswith(b"\n"):
                    chunks.append(handoff_parent.recv(4096))
                raw_handoff = b"".join(chunks)
                handoff = json.loads(raw_handoff)
                target = (
                    f"127.0.0.1\0{handoff['targetPort']}\0{handoff['targetPath']}"
                ).encode("ascii")
                semantic = {
                    "schemaVersion": "browser-session-handoff-receipt.v1",
                    "operation": "browser_session_handoff",
                    "success": True,
                    "cookieCount": 2,
                    "cookieHeadersHmac": mac(
                        b"acttub-browser-session-handoff-cookies.v1\0",
                        b"offline-cookie-headers",
                    ),
                    "nonceHmac": mac(
                        b"acttub-browser-session-handoff-nonce.v1\0",
                        str(handoff["nonce"]).encode("ascii"),
                    ),
                    "targetHmac": mac(
                        b"acttub-browser-session-handoff-target.v1\0", target
                    ),
                    "developmentTargetHmac": handoff["developmentTargetHmac"],
                }
                if failure_mode == "handoff-ack":
                    semantic["nonceHmac"] = "hmac-sha256:" + "0" * 64
                ack = {
                    **semantic,
                    "resultHmac": mac(
                        b"acttub-browser-session-handoff-receipt.v1\0",
                        json.dumps(
                            semantic,
                            sort_keys=True,
                            separators=(",", ":"),
                            ensure_ascii=True,
                        ).encode("ascii"),
                    ),
                }
                ack_parent.sendall(
                    json.dumps(ack, separators=(",", ":")).encode("ascii") + b"\n"
                )
                ack_parent.shutdown(socket.SHUT_WR)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(stdout, b"")
            self.assertEqual(stderr, b"")
            self.assertEqual(process.returncode, 0)
            try:
                cleanup_parent.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            broker_thread.join(timeout=2)
            self.assertFalse(cleanup_error)
            plans = [frame for frame in cleanup_frames if frame["operation"] == "plan"]
            completes = [frame for frame in cleanup_frames if frame["operation"] == "complete"]
            if failure_mode in {"cleanup-ack", "cleanup-silent"}:
                self.assertEqual((len(plans), len(completes)), (1, 0))
            elif failure_mode is None:
                self.assertEqual(len(completes), len(plans) - 1)
                self.assertFalse(any(frame["outcome"] == "retained" for frame in completes))
            else:
                self.assertEqual(len(completes), len(plans))
                self.assertTrue(all(cleanup_frames.index(plan) < cleanup_frames.index(completes[index]) for index, plan in enumerate(plans)))
            files[3].seek(0)
            receipt_raw = files[3].read()
            if failure_mode is not None:
                self.assertEqual(receipt_raw, b"")
            receipt = json.loads(receipt_raw) if failure_mode is None else None
            return receipt, handoff
        finally:
            for item in (handoff_parent, ack_parent, handoff_child, ack_child, cleanup_parent, cleanup_child):
                if item is not None:
                    item.close()
            for item in files:
                item.close()

    def test_source_is_import_inert_and_live_only(self) -> None:
        checked = subprocess.run(
            (NODE, "--check", str(DRIVER)), capture_output=True, check=False
        )
        self.assertEqual(checked.returncode, 0, checked.stderr.decode("utf-8"))
        direct = subprocess.run((NODE, str(DRIVER)), capture_output=True, check=False)
        self.assertEqual((direct.returncode, direct.stdout, direct.stderr), (0, b"", b""))
        imported = subprocess.run(
            (NODE, "--input-type=module"),
            input=(
                f'let calls=0;globalThis.fetch=async()=>{{calls+=1;}};await import({json.dumps(DRIVER.as_uri())});process.exitCode=calls===0?0:1;'
            ).encode("utf-8"),
            capture_output=True,
            check=False,
            env={"PATH": os.defpath},
        )
        self.assertEqual((imported.returncode, imported.stdout, imported.stderr), (0, b"", b""))
        source = DRIVER.read_text(encoding="utf-8")
        for required in (
            "listUsers",
            "generateLink",
            "verifyOtp",
            "createServerClient",
            "createTemporaryUserSession",
            "deleteTemporaryUser",
            "browser-session-handoff.v1",
            "browser-session-handoff-receipt.v1",
            "deletionLifecycleVerified",
            "browserBindingHmac",
        ):
            self.assertIn(required, source)
        for forbidden in (
            "signInWithPassword",
            "primaryEmail",
            "primaryPassword",
            "process.stdout",
            "process.stderr",
            "console.",
            "browser-auth-handoff.v1",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn('const targetPath = `/practice/history/${mainSessionId}`', source)

    def test_offline_pipeline_receipt_and_deletion_lifecycle(self) -> None:
        receipt, handoff = self.run_stub()
        assert receipt is not None
        self.assertIsNone(handoff)
        self.assertEqual(
            set(receipt),
            {
                "schemaVersion",
                "completed",
                "mainSessionCount",
                "substantiveAnswerCount",
                "reportSectionCount",
                "acceptedObservationCount",
                "crossUserDenied",
                "crossUserDeniedOperationCount",
                "replayVerified",
                "immutableReportVerified",
                "browserHandoffAcknowledged",
                "deletionLifecycleVerified",
                "temporaryUserDeleted",
                "mediaByteCount",
                "mediaHmac",
                "lineageHmac",
                "reportHmac",
                "browserBindingHmac",
                "resultHmac",
            },
        )
        self.assertFalse(receipt["browserHandoffAcknowledged"])
        semantic = dict(receipt)
        result_hmac = semantic.pop("resultHmac")
        encoded = json.dumps(
            semantic, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        ).encode("ascii")
        self.assertEqual(
            result_hmac,
            mac(b"acttub-real-pipeline-receipt.v1\0", encoded),
        )
        serialized = json.dumps(receipt, separators=(",", ":"))
        self.assertNotIn(HOST, serialized)
        self.assertNotIn("practice/history", serialized)

    def test_private_browser_handoff_waits_for_ack_and_binds_main_session(self) -> None:
        receipt, handoff = self.run_stub(browser=True)
        assert receipt is not None and handoff is not None
        self.assertTrue(receipt["browserHandoffAcknowledged"])
        self.assertEqual(
            set(handoff),
            {
                "schemaVersion",
                "supabaseUrl",
                "publishableKey",
                "accessToken",
                "refreshToken",
                "nonce",
                "brokerPort",
                "targetPort",
                "targetPath",
                "developmentTargetHmac",
            },
        )
        self.assertEqual(handoff["schemaVersion"], "browser-session-handoff.v1")
        self.assertRegex(
            str(handoff["targetPath"]),
            r"^/practice/history/[0-9a-f]{8}-[0-9a-f-]{27}$",
        )
        self.assertNotIn("targetPath", settings(browser=True)["browserHandoff"])

    def test_tampered_browser_handoff_ack_deletes_main_session(self) -> None:
        receipt, handoff = self.run_stub(browser=True, failure_mode="handoff-ack")
        self.assertIsNone(receipt)
        self.assertIsNotNone(handoff)

    def test_failure_cleanup_removes_uploaded_or_created_artifacts(self) -> None:
        for mode in ("finalize", "report", "session-response-lost", "receipt-write"):
            with self.subTest(mode=mode):
                receipt, handoff = self.run_stub(failure_mode=mode)
                self.assertIsNone(receipt)
                self.assertIsNone(handoff)

    def test_cleanup_broker_rejects_hostile_ack_before_session_mutation(self) -> None:
        receipt, handoff = self.run_stub(failure_mode="cleanup-ack")
        self.assertIsNone(receipt)
        self.assertIsNone(handoff)

    def test_silent_cleanup_broker_fails_bounded_before_session_mutation(self) -> None:
        started = __import__("time").monotonic()
        receipt, handoff = self.run_stub(failure_mode="cleanup-silent")
        self.assertLess(__import__("time").monotonic() - started, 2)
        self.assertIsNone(receipt)
        self.assertIsNone(handoff)

    def test_cleanup_protocol_is_strict_ordered_and_silent(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")
        for required in (
            '"cleanup-plan.v1"',
            '"cleanup-plan-ack.v1"',
            '"cleanup-complete.v1"',
            '"cleanup-complete-ack.v1"',
            '"run-session-bundle"',
            '"temporary-rls-account"',
            "await planCleanup",
            "await completeCleanup",
        ):
            self.assertIn(required, source)
        self.assertNotIn("console.", source)
        self.assertLess(source.index("await planCleanup(cleanupChannel, \"run-session-bundle\""), source.index('"/api/v1/practice-upload-intents"'))
        self.assertLess(source.index("validateEmptyReceiptFd(receiptFd)"), source.index("await adapterFactory(settings"))
        self.assertLess(source.index("writePrivateJson(receiptFd, receipt)"), source.index("keepMain = true"))
        self.assertNotIn('completeCleanup(cleanupChannel, "run-session-bundle", mainArtifact.planReceiptHmac, "retained")', source)
        for table in ("practice_sessions", "practice_takes", "observations", "ai_runs", "ai_reports", "upload_intents"):
            self.assertIn(f'"{table}"', source)

    def test_duplicate_tampered_and_non_private_inputs_fail_before_adapter(self) -> None:
        good = json.dumps(settings(browser=False), separators=(",", ":")).encode("utf-8")
        duplicate = b'{"schemaVersion":"real-pipeline-settings.v1",' + good[1:]
        tampered_item = settings(browser=False)
        tampered_item["expectedMediaHmac"] = "hmac-sha256:" + "0" * 64
        tampered = json.dumps(tampered_item, separators=(",", ":")).encode("utf-8")
        off_target_item = settings(browser=False)
        off_target_item["platformOrigin"] = "https://127.0.0.1:31415"
        off_target = json.dumps(off_target_item, separators=(",", ":")).encode("utf-8")
        for label, raw, public_mode, receipt_contents in (
            ("duplicate", duplicate, False, b""),
            ("media-hmac", tampered, False, b""),
            ("off-target", off_target, False, b""),
            ("public-mode", good, True, b""),
            ("nonempty-receipt", good, False, b"preexisting"),
        ):
            with self.subTest(label=label):
                files = [private_file(raw), private_file(MEDIA), private_file(KEY), private_file(receipt_contents)]
                cleanup_parent, cleanup_child = socket.socketpair()
                try:
                    if public_mode:
                        os.fchmod(files[0].fileno(), 0o644)
                    process = subprocess.run(
                        (NODE, "--input-type=module"),
                        input=input_failure_wrapper(
                            settings_fd=files[0].fileno(),
                            media_fd=files[1].fileno(),
                            key_fd=files[2].fileno(),
                            receipt_fd=files[3].fileno(),
                            cleanup_fd=cleanup_child.fileno(),
                        ),
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        pass_fds=tuple(item.fileno() for item in files) + (cleanup_child.fileno(),),
                        check=False,
                        env={"PATH": os.defpath},
                    )
                    self.assertEqual((process.returncode, process.stdout, process.stderr), (0, b"", b""))
                finally:
                    cleanup_parent.close()
                    cleanup_child.close()
                    for item in files:
                        item.close()


if __name__ == "__main__":
    unittest.main()
