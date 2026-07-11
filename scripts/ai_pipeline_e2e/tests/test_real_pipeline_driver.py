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
    provider_cleanup_fd: int,
    isolated_cleanup_fd: int,
    provider_receipt_fd: int,
    isolated_receipt_fd: int,
    locator_fd: int,
    failure_mode: str | None,
    stop_after_provider: bool = False,
    upload_audit_fd: int | None = None,
) -> bytes:
    source = f"""
      import crypto from "node:crypto";
      import fs from "node:fs";
      import {{ runRealProviderPhase, runIsolatedDataPhase, runBrowserAuthPhase, canonicalJson }} from {json.dumps(DRIVER.as_uri())};
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
      let providerFactoryCount = 0;
      let isolatedFactoryCount = 0;
      let browserFactoryCount = 0;
      let providerSessionCreateCount = 0;
      let isolatedSessionCreateCount = 0;
      let temporaryCreatePhase = null;
      const uploadAuditFd = {"null" if upload_audit_fd is None else upload_audit_fd};

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
      const adapterFactory = async (_settings, context) => {{
        const phase = context?.phase;
        if (phase === "real-provider") providerFactoryCount += 1;
        else if (phase === "isolated-data") isolatedFactoryCount += 1;
        else if (phase === "browser-auth") browserFactoryCount += 1;
        else throw new Error("bad-phase");
        return ({{
        async establishExistingPrimary() {{ return {{ userId: primaryUserId, accessToken: opaque(), refreshToken: opaque(), cookieJar: cookieJar() }}; }},
        async createTemporaryUserSession() {{ temporaryPresent = true; temporaryCreatePhase = phase; return {{ userId: temporaryUserId, accessToken: opaque(), refreshToken: opaque(), cookieJar: cookieJar() }}; }},
        async deleteTemporaryUser() {{
          if (!temporaryPresent) return {{ deleted: true, deletedCount: 0 }};
          temporaryPresent = false;
          temporaryDeleteCount += 1;
          if (failureMode === "receipt-write") fs.closeSync({isolated_receipt_fd});
          return {{ deleted: true, deletedCount: 1 }};
        }},
        async uploadMedia(_session, storagePath, media) {{
          if (!(media instanceof Buffer) || media.length < 1 || storage.has(storagePath)) throw new Error("stub");
          storage.add(storagePath);
          if (phase === "real-provider" && uploadAuditFd !== null) {{
            const marker = Buffer.from([1]);
            fs.writeSync(uploadAuditFd, marker, 0, marker.length, fs.fstatSync(uploadAuditFd).size);
            fs.fsyncSync(uploadAuditFd);
          }}
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
            if (phase === "real-provider") providerSessionCreateCount += 1;
            if (phase === "isolated-data") isolatedSessionCreateCount += 1;
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
      }}); }};

      let result = null, providerResult = null, isolatedResult = null, browserResult = null;
      let caught = null;
      try {{
        providerResult = await runRealProviderPhase({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {provider_receipt_fd},
          cleanupFd: {provider_cleanup_fd}, cleanupTimeoutMs: failureMode === "cleanup-silent" ? 100 : 30000,
          adapterFactory,
        }});
        const main = sessions.get(mainSessionId);
        const locator = {{ uploadIntentId: main.uploadIntentId, sessionId: main.sessionId, storagePath: main.storagePath }};
        const locatorBytes = Buffer.from(canonicalJson(locator), "ascii");
        fs.ftruncateSync({locator_fd}, 0); fs.writeSync({locator_fd}, locatorBytes, 0, locatorBytes.length, 0); fs.fsyncSync({locator_fd});
        locatorBytes.fill(0);
        if ({str(stop_after_provider).lower()}) process.kill(process.pid, "SIGKILL");
        isolatedResult = await runIsolatedDataPhase({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {isolated_receipt_fd},
          mainLocatorFd: {locator_fd}, providerReceiptFd: {provider_receipt_fd}, cleanupFd: {isolated_cleanup_fd},
          adapterFactory,
        }});
        if ({str(handoff_fd is not None).lower()}) {{
          browserResult = await runBrowserAuthPhase({{
            settingsFd: {settings_fd}, macKeyFd: {key_fd}, receiptFd: {receipt_fd},
            mainLocatorFd: {locator_fd}, providerReceiptFd: {provider_receipt_fd}, isolatedDataReceiptFd: {isolated_receipt_fd},
            handoffFd: {"null" if handoff_fd is None else handoff_fd}, handoffAckFd: {"null" if ack_fd is None else ack_fd},
            adapterFactory,
          }});
        }}
        result = {{ provider: providerResult, isolated: isolatedResult, browser: browserResult }};
      }} catch (error) {{ caught = error; }}
      let valid = externalCalls === 0;
      if (failureMode === null) {{
        valid = valid && caught === null && result?.provider?.completed === true && result?.isolated?.completed === true;
        valid = valid && (result?.browser?.completed === true) === {str(handoff_fd is not None).lower()};
        valid = valid && temporaryDeleteCount === 1 && lifecycleDeleteCount === 1 && sessions.size === 1 && storage.size === 1;
        const main = sessions.get(mainSessionId);
        const expectedBinding = `hmac-sha256:${{crypto.createHmac("sha256", Buffer.from({json.dumps(KEY.hex())}, "hex")).update(Buffer.from("acttub-browser-binding.v1\\0", "ascii")).update(Buffer.from(canonicalJson([mainSessionId, main.report.sourceRunId]), "ascii")).digest("hex")}}`;
        valid = valid && result?.provider?.browserBindingHmac === expectedBinding;
        valid = valid && providerFactoryCount === 1 && isolatedFactoryCount === 1 && browserFactoryCount === {1 if handoff_fd is not None else 0};
        valid = valid && providerSessionCreateCount === 1 && isolatedSessionCreateCount === 1 && temporaryCreatePhase === "isolated-data";
      }} else if (failureMode === "finalize") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_HTTP_FAILED" && sessions.size === 0 && storage.size === 0 && removeCount === 1;
      }} else if (failureMode === "report") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_CONTRACT_FAILED" && sessions.size === 0 && storage.size === 0 && lifecycleDeleteCount === 1;
      }} else if (failureMode === "session-response-lost") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_HTTP_FAILED" && sessions.size === 0 && storage.size === 0 && intents.size === 0;
        valid = valid && lifecycleDeleteCount === 0 && bundleCleanupCount === 1;
      }} else if (failureMode === "handoff-ack") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_AUTH_FAILED" && sessions.size === 1 && storage.size === 1;
        valid = valid && providerResult?.completed === true && isolatedResult?.completed === true && browserResult === null;
      }} else if (failureMode === "receipt-write") {{
        valid = valid && caught?.safeCode === "REAL_PIPELINE_BAD_INPUT" && sessions.size === 1 && storage.size === 1;
        valid = valid && providerResult?.completed === true && isolatedResult === null && temporaryDeleteCount === 1 && lifecycleDeleteCount === 1;
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
    *, settings_fd: int, media_fd: int, key_fd: int, receipt_fd: int, cleanup_fd: int,
) -> bytes:
    source = f"""
      import {{ runRealProviderPhase }} from {json.dumps(DRIVER.as_uri())};
      let calls = 0, caught = null;
      try {{
        await runRealProviderPhase({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {receipt_fd}, cleanupFd: {cleanup_fd},
          adapterFactory: async () => {{ calls += 1; throw new Error("must-not-run"); }},
        }});
      }} catch (error) {{ caught = error; }}
      process.exitCode = calls === 0 && caught?.safeCode === "REAL_PIPELINE_BAD_INPUT" ? 0 : 91;
    """
    return source.encode("utf-8")


def isolated_resume_validation_wrapper(
    *, settings_fd: int, media_fd: int, key_fd: int, receipt_fd: int,
    locator_fd: int, provider_receipt_fd: int, cleanup_fd: int,
) -> bytes:
    source = f"""
      import {{ runIsolatedDataPhase }} from {json.dumps(DRIVER.as_uri())};
      let calls = 0, phase = null, caught = null;
      try {{
        await runIsolatedDataPhase({{
          settingsFd: {settings_fd}, mediaFd: {media_fd}, macKeyFd: {key_fd}, receiptFd: {receipt_fd},
          mainLocatorFd: {locator_fd}, providerReceiptFd: {provider_receipt_fd}, cleanupFd: {cleanup_fd},
          adapterFactory: async (_settings, context) => {{
            calls += 1;
            phase = context?.phase ?? null;
            throw new Error("stop-after-checkpoint-validation");
          }},
        }});
      }} catch (error) {{ caught = error; }}
      process.exitCode = calls === 1 && phase === "isolated-data" &&
        caught?.safeCode === "REAL_PIPELINE_CONTRACT_FAILED" ? 0 : 91;
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
    ) -> tuple[
        dict[str, object] | None,
        dict[str, object] | None,
        dict[str, object] | None,
        dict[str, object] | None,
    ]:
        raw_settings = json.dumps(settings(browser=browser), separators=(",", ":")).encode("utf-8")
        files = [
            private_file(raw_settings),
            private_file(MEDIA),
            private_file(KEY),
            private_file(b""),
            private_file(b""),
            private_file(b""),
            private_file(b""),
        ]
        handoff_parent: socket.socket | None = None
        ack_parent: socket.socket | None = None
        handoff_child: socket.socket | None = None
        ack_child: socket.socket | None = None
        provider_cleanup_parent, provider_cleanup_child = socket.socketpair()
        isolated_cleanup_parent, isolated_cleanup_child = socket.socketpair()
        cleanup_frames: list[dict[str, object]] = []
        cleanup_error: list[BaseException] = []

        def cleanup_broker(channel: socket.socket) -> None:
            pending = b""
            try:
                while chunk := channel.recv(4096):
                    pending += chunk
                    while b"\n" in pending:
                        raw, pending = pending.split(b"\n", 1)
                        frame = json.loads(raw)
                        cleanup_frames.append(frame)
                        if failure_mode == "cleanup-silent":
                            continue
                        if frame["operation"] == "plan":
                            channel.sendall(json.dumps({
                                "schemaVersion": "cleanup-plan-ack.invalid" if failure_mode == "cleanup-ack" else "cleanup-plan-ack.v1",
                                "operation": "plan",
                                "resourceAlias": frame["resourceAlias"],
                                "planReceiptHmac": "hmac-sha256:" + hashlib.sha256(raw).hexdigest(),
                            }, separators=(",", ":")).encode("ascii") + b"\n")
                        elif frame["operation"] == "complete":
                            channel.sendall(json.dumps({
                                "schemaVersion": "cleanup-complete-ack.v1",
                                "operation": "complete",
                                "resourceAlias": frame["resourceAlias"],
                                "planReceiptHmac": frame["planReceiptHmac"],
                                "outcome": frame["outcome"],
                            }, separators=(",", ":")).encode("ascii") + b"\n")
            except (OSError, BaseException) as error:
                if not isinstance(error, OSError):
                    cleanup_error.append(error)

        broker_threads = [
            threading.Thread(target=cleanup_broker, args=(provider_cleanup_parent,), daemon=True),
            threading.Thread(target=cleanup_broker, args=(isolated_cleanup_parent,), daemon=True),
        ]
        for thread in broker_threads:
            thread.start()
        try:
            pass_fds = [item.fileno() for item in files] + [
                provider_cleanup_child.fileno(), isolated_cleanup_child.fileno(),
            ]
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
            process.stdin.write(fake_wrapper(
                settings_fd=files[0].fileno(),
                media_fd=files[1].fileno(),
                key_fd=files[2].fileno(),
                receipt_fd=files[3].fileno(),
                handoff_fd=handoff_child.fileno() if handoff_child else None,
                ack_fd=ack_child.fileno() if ack_child else None,
                provider_cleanup_fd=provider_cleanup_child.fileno(),
                isolated_cleanup_fd=isolated_cleanup_child.fileno(),
                provider_receipt_fd=files[4].fileno(),
                isolated_receipt_fd=files[5].fileno(),
                locator_fd=files[6].fileno(),
                failure_mode=failure_mode,
            ))
            process.stdin.close()
            if handoff_child:
                handoff_child.close()
            if ack_child:
                ack_child.close()
            provider_cleanup_child.close()
            isolated_cleanup_child.close()
            handoff: dict[str, object] | None = None
            if browser and failure_mode not in {"finalize", "report", "session-response-lost", "cleanup-ack", "cleanup-silent", "receipt-write"}:
                assert handoff_parent is not None and ack_parent is not None
                handoff_parent.settimeout(5)
                chunks: list[bytes] = []
                while not chunks or not b"".join(chunks).endswith(b"\n"):
                    chunks.append(handoff_parent.recv(4096))
                handoff = json.loads(b"".join(chunks))
                target = f"127.0.0.1\0{handoff['targetPort']}\0{handoff['targetPath']}".encode("ascii")
                semantic = {
                    "schemaVersion": "browser-session-handoff-receipt.v1",
                    "operation": "browser_session_handoff",
                    "success": True,
                    "cookieCount": 2,
                    "cookieHeadersHmac": mac(b"acttub-browser-session-handoff-cookies.v1\0", b"offline-cookie-headers"),
                    "nonceHmac": mac(b"acttub-browser-session-handoff-nonce.v1\0", str(handoff["nonce"]).encode("ascii")),
                    "targetHmac": mac(b"acttub-browser-session-handoff-target.v1\0", target),
                    "developmentTargetHmac": handoff["developmentTargetHmac"],
                }
                if failure_mode == "handoff-ack":
                    semantic["nonceHmac"] = "hmac-sha256:" + "0" * 64
                ack = {
                    **semantic,
                    "resultHmac": mac(
                        b"acttub-browser-session-handoff-receipt.v1\0",
                        json.dumps(semantic, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii"),
                    ),
                }
                ack_parent.sendall(json.dumps(ack, separators=(",", ":")).encode("ascii") + b"\n")
                ack_parent.shutdown(socket.SHUT_WR)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(stdout, b"")
            self.assertEqual(stderr, b"")
            self.assertEqual(process.returncode, 0)
            for channel in (provider_cleanup_parent, isolated_cleanup_parent):
                try:
                    channel.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            for thread in broker_threads:
                thread.join(timeout=2)
            self.assertFalse(cleanup_error)
            plans = [frame for frame in cleanup_frames if frame["operation"] == "plan"]
            completes = [frame for frame in cleanup_frames if frame["operation"] == "complete"]
            if failure_mode in {"cleanup-ack", "cleanup-silent"}:
                self.assertEqual((len(plans), len(completes)), (1, 0))
            elif failure_mode in {None, "handoff-ack", "receipt-write"}:
                self.assertEqual(len(completes), len(plans) - 1)
                self.assertFalse(any(frame["outcome"] == "retained" for frame in completes))
            else:
                self.assertEqual(len(completes), len(plans))
            for complete in completes:
                self.assertTrue(any(
                    plan["resourceAlias"] == complete["resourceAlias"]
                    and cleanup_frames.index(plan) < cleanup_frames.index(complete)
                    for plan in plans
                ))

            def read_receipt(item: BinaryIO) -> dict[str, object] | None:
                item.seek(0)
                raw = item.read()
                return json.loads(raw) if raw else None

            browser_receipt = read_receipt(files[3])
            provider_receipt = read_receipt(files[4])
            isolated_receipt = read_receipt(files[5])
            if failure_mode is None:
                self.assertIsNotNone(provider_receipt)
                self.assertIsNotNone(isolated_receipt)
                self.assertEqual(browser_receipt is not None, browser)
            elif failure_mode == "handoff-ack":
                self.assertIsNotNone(provider_receipt)
                self.assertIsNotNone(isolated_receipt)
                self.assertIsNone(browser_receipt)
            elif failure_mode == "receipt-write":
                self.assertIsNotNone(provider_receipt)
                self.assertIsNone(isolated_receipt)
                self.assertIsNone(browser_receipt)
            else:
                self.assertIsNone(provider_receipt)
                self.assertIsNone(isolated_receipt)
                self.assertIsNone(browser_receipt)
            return browser_receipt, handoff, provider_receipt, isolated_receipt
        finally:
            for item in (
                handoff_parent, ack_parent, handoff_child, ack_child,
                provider_cleanup_parent, provider_cleanup_child,
                isolated_cleanup_parent, isolated_cleanup_child,
            ):
                if item is not None:
                    item.close()
            for item in files:
                item.close()

    @staticmethod
    def assert_receipt_mac(receipt: dict[str, object], domain: bytes) -> None:
        semantic = dict(receipt)
        result_hmac = semantic.pop("resultHmac")
        encoded = json.dumps(
            semantic, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        ).encode("ascii")
        if result_hmac != mac(domain, encoded):
            raise AssertionError("receipt_mac_mismatch")

    def test_source_is_import_inert_and_three_live_modes_only(self) -> None:
        checked = subprocess.run((NODE, "--check", str(DRIVER)), capture_output=True, check=False)
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
            "runRealProviderPhase", "runIsolatedDataPhase", "runBrowserAuthPhase",
            '"--live-provider"', '"--live-isolated-data"', '"--live-browser-auth"',
            '"real-pipeline-provider-phase-receipt.v1"', '"isolated-data-phase-receipt.v1"',
            '"browser-auth-phase-receipt.v1"', "listUsers", "generateLink", "verifyOtp",
            "createServerClient", "createTemporaryUserSession", "deleteTemporaryUser",
        ):
            self.assertIn(required, source)
        for forbidden in (
            "runRealPipeline", "real-pipeline-isolated-data-barrier.v1", "authorize_isolated_data_phase",
            "signInWithPassword", "primaryEmail", "primaryPassword", "process.stdout",
            "process.stderr", "console.", "browser-auth-handoff.v1",
        ):
            self.assertNotIn(forbidden, source)

    def test_provider_and_isolated_receipts_are_exact_safe_and_authenticated(self) -> None:
        browser_receipt, handoff, provider, isolated = self.run_stub()
        self.assertIsNone(browser_receipt)
        self.assertIsNone(handoff)
        assert provider is not None and isolated is not None
        self.assertEqual(set(provider), {
            "schemaVersion", "completed", "mainSessionCount", "substantiveAnswerCount",
            "reportSectionCount", "acceptedObservationCount", "replayVerified", "immutableReportVerified",
            "retentionCandidateCount", "mediaByteCount", "mediaHmac", "lineageHmac", "reportHmac",
            "browserBindingHmac", "mainLocatorHmac", "cleanupPlanHmac", "retentionCandidateHmac", "resultHmac",
        })
        self.assertEqual(set(isolated), {
            "schemaVersion", "completed", "crossUserDenied", "crossUserDeniedOperationCount",
            "temporaryUserDeleted", "deletionLifecycleVerified", "transientSessionCount",
            "transientSessionsRetained", "storageOrphanCount", "dependentRowOrphanCount", "aiRunOrphanCount",
            "providerResultHmac", "browserBindingHmac", "resultHmac",
        })
        self.assert_receipt_mac(provider, b"acttub-real-pipeline-provider-phase-receipt.v1\0")
        self.assert_receipt_mac(isolated, b"acttub-isolated-data-phase-receipt.v1\0")
        self.assertEqual(isolated["providerResultHmac"], provider["resultHmac"])
        self.assertEqual(isolated["browserBindingHmac"], provider["browserBindingHmac"])
        self.assertEqual(
            (isolated["transientSessionsRetained"], isolated["storageOrphanCount"], isolated["dependentRowOrphanCount"], isolated["aiRunOrphanCount"]),
            (0, 0, 0, 0),
        )
        serialized = json.dumps({"provider": provider, "isolated": isolated}, separators=(",", ":"))
        for forbidden in (HOST, PROJECT_REF, "practice/history", "accessToken", "refreshToken"):
            self.assertNotIn(forbidden, serialized)
        self.assertNotRegex(serialized, r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

    def test_browser_phase_reauthenticates_and_emits_exact_broker_bound_receipt(self) -> None:
        browser_receipt, handoff, provider, isolated = self.run_stub(browser=True)
        assert browser_receipt is not None and handoff is not None and provider is not None and isolated is not None
        self.assertEqual(set(browser_receipt), {
            "schemaVersion", "completed", "providerResultHmac", "isolatedResultHmac",
            "browserBindingHmac", "handoffResultHmac", "resultHmac",
        })
        self.assert_receipt_mac(browser_receipt, b"acttub-browser-auth-phase-receipt.v1\0")
        self.assertEqual(browser_receipt["providerResultHmac"], provider["resultHmac"])
        self.assertEqual(browser_receipt["isolatedResultHmac"], isolated["resultHmac"])
        self.assertEqual(browser_receipt["browserBindingHmac"], provider["browserBindingHmac"])
        self.assertEqual(set(handoff), {
            "schemaVersion", "supabaseUrl", "publishableKey", "accessToken", "refreshToken",
            "nonce", "brokerPort", "targetPort", "targetPath", "developmentTargetHmac",
        })
        self.assertRegex(str(handoff["targetPath"]), r"^/practice/history/[0-9a-f]{8}-[0-9a-f-]{27}$")
        serialized = json.dumps(browser_receipt, separators=(",", ":"))
        self.assertNotIn("practice/history", serialized)
        self.assertNotIn("accessToken", serialized)

    def test_tampered_browser_ack_leaves_durable_prior_phases_and_no_browser_receipt(self) -> None:
        browser_receipt, handoff, provider, isolated = self.run_stub(browser=True, failure_mode="handoff-ack")
        self.assertIsNone(browser_receipt)
        self.assertIsNotNone(handoff)
        self.assertIsNotNone(provider)
        self.assertIsNotNone(isolated)

    def test_phase_failures_are_fail_closed_without_replaying_provider(self) -> None:
        for mode in ("finalize", "report", "session-response-lost"):
            with self.subTest(mode=mode):
                browser_receipt, handoff, provider, isolated = self.run_stub(failure_mode=mode)
                self.assertIsNone(browser_receipt)
                self.assertIsNone(handoff)
                self.assertIsNone(provider)
                self.assertIsNone(isolated)
        browser_receipt, handoff, provider, isolated = self.run_stub(failure_mode="receipt-write")
        self.assertIsNone(browser_receipt)
        self.assertIsNone(handoff)
        self.assertIsNotNone(provider)
        self.assertIsNone(isolated)

    def test_cleanup_broker_rejection_and_timeout_are_bounded(self) -> None:
        for mode in ("cleanup-ack", "cleanup-silent"):
            with self.subTest(mode=mode):
                started = __import__("time").monotonic()
                browser_receipt, handoff, provider, isolated = self.run_stub(failure_mode=mode)
                self.assertLess(__import__("time").monotonic() - started, 2)
                self.assertIsNone(browser_receipt)
                self.assertIsNone(handoff)
                self.assertIsNone(provider)
                self.assertIsNone(isolated)

    def test_provider_phase_precedes_isolated_and_never_marks_main_retained(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")
        provider_start = source.index("export async function runRealProviderPhase")
        isolated_start = source.index("export async function runIsolatedDataPhase")
        browser_start = source.index("export async function runBrowserAuthPhase")
        self.assertLess(provider_start, isolated_start)
        self.assertLess(isolated_start, browser_start)
        provider_source = source[provider_start:isolated_start]
        isolated_source = source[isolated_start:browser_start]
        self.assertEqual(provider_source.count("createPreparedSession("), 1)
        self.assertNotIn("createTemporaryUserSession", provider_source)
        self.assertIn("createTemporaryUserSession", isolated_source)
        self.assertNotIn('completeCleanup(cleanupChannel, "run-session-bundle", mainArtifact.planReceiptHmac, "retained")', source)
        self.assertNotIn("isolatedDataBarrierFd", source)
        for table in ("practice_sessions", "practice_takes", "observations", "ai_runs", "ai_reports", "upload_intents"):
            self.assertIn(f'"{table}"', source)

    def test_sigkill_after_provider_receipt_resumes_without_provider_reentry(self) -> None:
        raw_settings = json.dumps(settings(browser=False), separators=(",", ":")).encode("utf-8")
        files = [
            private_file(raw_settings),
            private_file(MEDIA),
            private_file(KEY),
            private_file(b""),
            private_file(b""),
            private_file(b""),
            private_file(b""),
            private_file(b""),
        ]
        provider_cleanup_parent, provider_cleanup_child = socket.socketpair()
        isolated_cleanup_parent, isolated_cleanup_child = socket.socketpair()
        cleanup_frames: list[dict[str, object]] = []
        cleanup_errors: list[BaseException] = []

        def cleanup_broker() -> None:
            pending = b""
            try:
                while chunk := provider_cleanup_parent.recv(4096):
                    pending += chunk
                    while b"\n" in pending:
                        raw, pending = pending.split(b"\n", 1)
                        frame = json.loads(raw)
                        cleanup_frames.append(frame)
                        if frame["operation"] != "plan":
                            raise AssertionError("unexpected_cleanup_complete")
                        provider_cleanup_parent.sendall(json.dumps({
                            "schemaVersion": "cleanup-plan-ack.v1",
                            "operation": "plan",
                            "resourceAlias": frame["resourceAlias"],
                            "planReceiptHmac": "hmac-sha256:" + hashlib.sha256(raw).hexdigest(),
                        }, separators=(",", ":")).encode("ascii") + b"\n")
            except OSError:
                pass
            except BaseException as error:
                cleanup_errors.append(error)

        broker_thread = threading.Thread(target=cleanup_broker, daemon=True)
        broker_thread.start()
        try:
            process = subprocess.Popen(
                (NODE, "--input-type=module"),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=tuple(item.fileno() for item in files) + (
                    provider_cleanup_child.fileno(), isolated_cleanup_child.fileno(),
                ),
                close_fds=True,
                env={"PATH": os.defpath},
            )
            assert process.stdin is not None
            process.stdin.write(fake_wrapper(
                settings_fd=files[0].fileno(),
                media_fd=files[1].fileno(),
                key_fd=files[2].fileno(),
                receipt_fd=files[3].fileno(),
                handoff_fd=None,
                ack_fd=None,
                provider_cleanup_fd=provider_cleanup_child.fileno(),
                isolated_cleanup_fd=isolated_cleanup_child.fileno(),
                provider_receipt_fd=files[4].fileno(),
                isolated_receipt_fd=files[5].fileno(),
                locator_fd=files[6].fileno(),
                failure_mode=None,
                stop_after_provider=True,
                upload_audit_fd=files[7].fileno(),
            ))
            process.stdin.close()
            provider_cleanup_child.close()
            isolated_cleanup_child.close()
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual((stdout, stderr), (b"", b""))
            self.assertEqual(process.returncode, -9)
            broker_thread.join(timeout=2)
            self.assertFalse(broker_thread.is_alive())
            self.assertFalse(cleanup_errors)
            self.assertEqual([frame["operation"] for frame in cleanup_frames], ["plan"])

            files[4].seek(0)
            durable_provider_receipt = files[4].read()
            files[6].seek(0)
            durable_locator = files[6].read()
            files[7].seek(0)
            self.assertEqual(files[7].read(), b"\x01")
            self.assertTrue(durable_provider_receipt.endswith(b"\n"))
            self.assertTrue(durable_locator)

            resume_cleanup_parent, resume_cleanup_child = socket.socketpair()
            try:
                resumed = subprocess.run(
                    (NODE, "--input-type=module"),
                    input=isolated_resume_validation_wrapper(
                        settings_fd=files[0].fileno(),
                        media_fd=files[1].fileno(),
                        key_fd=files[2].fileno(),
                        receipt_fd=files[5].fileno(),
                        locator_fd=files[6].fileno(),
                        provider_receipt_fd=files[4].fileno(),
                        cleanup_fd=resume_cleanup_child.fileno(),
                    ),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    pass_fds=(
                        files[0].fileno(), files[1].fileno(), files[2].fileno(), files[5].fileno(),
                        files[6].fileno(), files[4].fileno(), resume_cleanup_child.fileno(),
                    ),
                    check=False,
                    env={"PATH": os.defpath},
                )
                self.assertEqual((resumed.returncode, resumed.stdout, resumed.stderr), (0, b"", b""))
            finally:
                resume_cleanup_parent.close()
                resume_cleanup_child.close()

            files[4].seek(0)
            self.assertEqual(files[4].read(), durable_provider_receipt)
            files[5].seek(0)
            self.assertEqual(files[5].read(), b"")
            files[7].seek(0)
            self.assertEqual(files[7].read(), b"\x01")
        finally:
            for channel in (
                provider_cleanup_parent, provider_cleanup_child,
                isolated_cleanup_parent, isolated_cleanup_child,
            ):
                try:
                    channel.close()
                except OSError:
                    pass
            for item in files:
                item.close()

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
