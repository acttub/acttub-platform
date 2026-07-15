import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const successSessionId = "24000000-0000-4000-8000-000000000001";
const failedSessionId = "24000000-0000-4000-8000-000000000006";
const successUploadId = "24000000-0000-4000-8000-000000000002";
const failedUploadId = "24000000-0000-4000-8000-000000000007";
const successRequestId = "24000000-0000-4000-8000-000000000003";

const summary = {
  observation: { timeline: "t", dialogue: "d", tempo: "t", pitch: "p", movement: "m", expression: "e", emotion: "e", extra: [] },
  summary: "브라우저 실제 분석 완료", intent_alignment: "일치", key_moment: "순간", key_dimension: "차원", anomalies: [],
};

const waitFor = async (check, timeoutMs, description) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${description}`, { cause: lastError });
};

const runWorkerOnce = (cwd, env) => new Promise((resolve) => {
  const child = spawn("pnpm", ["worker:analysis:once"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.once("exit", (code) => resolve({ code, output }));
});

const stopChild = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) { resolve(); return; }
  child.once("exit", resolve);
  child.kill("SIGTERM");
});

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const sqlScalar = (dbUrl, sql) => execFileSync("psql", [dbUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();

test("actual browser + Next API + durable queue + worker covers recovery and terminal stop", {
  skip: process.env.G010_RUN_BROWSER_INTEGRATION !== "1" && "set G010_RUN_BROWSER_INTEGRATION=1 with local Supabase and Chrome",
  timeout: 60_000,
}, async () => {
  const local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }));
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = `g010-browser-${Date.now()}@example.com`;
  const password = "Acttub-G010-Browser-Password-1!";
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(createdUser.error);
  const userId = createdUser.data.user.id;
  const successPath = `users/${userId}/practice-sessions/${successSessionId}/take.mp4`;
  const failedPath = `users/${userId}/practice-sessions/${failedSessionId}/take.mp4`;
  execFileSync("psql", [local.DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `
    insert into public.profiles(id,email,status,required_consent_version,required_consent_at,ai_processing_consent_version,ai_processing_consent_at)
      values('${userId}','${email}','active',public.current_acttub_terms_version(),now(),public.current_acttub_ai_processing_consent_version(),now())
      on conflict(id) do update set status='active',required_consent_version=excluded.required_consent_version,
        required_consent_at=excluded.required_consent_at,ai_processing_consent_version=excluded.ai_processing_consent_version,
        ai_processing_consent_at=excluded.ai_processing_consent_at;
    insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,duration_ms,finalized_at)
      values('${successUploadId}','${userId}','${successSessionId}','finalized','${successPath}','video/mp4',3,1000,now()),
            ('${failedUploadId}','${userId}','${failedSessionId}','finalized','${failedPath}','video/mp4',3,1000,now());
  `]);
  const uploaded = await admin.storage.from("practice-videos").upload(successPath, new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }));
  assert.ifError(uploaded.error);

  const cookieWrites = [];
  const browserAuth = createBrowserClient(local.API_URL, local.ANON_KEY, {
    cookies: { getAll: () => [], setAll: (cookies) => cookieWrites.push(...cookies) },
  });
  const signedIn = await browserAuth.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.ok(cookieWrites.length > 0);

  let summarizeCalls = 0;
  let coachStartCalls = 0;
  const actingApi = createServer((request, response) => {
    if (request.url === "/summarize") {
      summarizeCalls += 1; request.resume();
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(summary));
      return;
    }
    if (request.url === "/coach/start") {
      coachStartCalls += 1; request.resume();
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        session_id: "24000000-0000-4000-8000-000000000099",
        utterance: "실제 브라우저 인터뷰 질문", action: "probe_intent", focus_timestamp: "00:00:01", done: false, reason: null,
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => actingApi.listen(0, "127.0.0.1", resolve));
  const actingPort = actingApi.address().port;
  const appPort = 32_000 + Math.floor(Math.random() * 1000);
  const cdpPort = 42_000 + Math.floor(Math.random() * 1000);
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const repoRoot = new URL("../../..", import.meta.url).pathname;
  const webEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: appOrigin,
  };
  const actingEnv = {
    ACTING_API_BASE_URL: `http://127.0.0.1:${actingPort}`,
    ACTING_API_KEY: "browser-test-key",
  };
  const workerEnv = {
    ...webEnv,
    ...actingEnv,
    ANALYSIS_WORKER_LEASE_MS: "30000",
    ANALYSIS_WORKER_HEARTBEAT_MS: "1000",
    ANALYSIS_WORKER_UPSTREAM_TIMEOUT_MS: "10000",
  };
  let appOutput = "";
  const startApp = (env) => {
    appOutput = "";
    const child = spawn("pnpm", ["--filter", "web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
      cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { appOutput += chunk; });
    child.stderr.on("data", (chunk) => { appOutput += chunk; });
    return child;
  };
  let app = startApp(webEnv);
  const profile = mkdtempSync(join(tmpdir(), "acttub-g010-chrome-"));
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    await waitFor(async () => (await fetch(`${appOrigin}/practice/new`)).ok, 20_000, `Next dev server: ${appOutput}`);
    await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 10_000, "Chrome DevTools endpoint");
    const target = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    const responseCounts = new Map();
    cdp.on("Network.responseReceived", ({ response }) => responseCounts.set(response.url, (responseCounts.get(response.url) ?? 0) + 1));
    for (const cookie of cookieWrites) {
      const result = await cdp.send("Network.setCookie", { name: cookie.name, value: cookie.value, url: appOrigin, path: "/" });
      assert.equal(result.success, true);
    }
    await cdp.send("Page.navigate", { url: `${appOrigin}/practice/new` });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const initialPage = await cdp.evaluate(`fetch("/api/v1/auth/session").then(async (response) => ({ url: location.href, text: document.body.innerText, cookies: document.cookie, authStatus: response.status, authBody: await response.text() }))`);
    assert.match(initialPage.text, /오늘의 연기 영상을 올려 주세요/, `${JSON.stringify(initialPage)}\n${appOutput}`);

    const createResult = await cdp.evaluate(`fetch("/api/v1/practice-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: ${JSON.stringify(successRequestId)}, uploadIntentId: ${JSON.stringify(successUploadId)}, situation: "실제 상황", characterContext: "실제 인물", subtext: "실제 의도" }) }).then(async (response) => ({ status: response.status, body: await response.json() }))`);
    assert.equal(createResult.status, 202, `${JSON.stringify(createResult.body)}\n${appOutput}`);
    assert.equal(createResult.body.status, "ANALYZING");
    assert.equal(createResult.body.id, successSessionId);
    await cdp.evaluate(`localStorage.setItem("acttub:active-practice-session-id", ${JSON.stringify(successSessionId)})`);
    await cdp.send("Page.navigate", { url: "about:blank" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sqlScalar(local.DB_URL, `select status from public.practice_upstream_operations where session_id='${successSessionId}'`), "queued");

    await stopChild(app);
    app = startApp({ ...webEnv, ...actingEnv });
    await waitFor(async () => (await fetch(`${appOrigin}/practice/new`)).ok, 20_000, `restarted Next dev server: ${appOutput}`);
    await cdp.send("Page.navigate", { url: `${appOrigin}/practice/new` });
    await waitFor(async () => cdp.evaluate(`document.body.innerText.includes("장면을 분석하고 있어요")`), 10_000, "reload-restored ANALYZING UI");
    const worker = await runWorkerOnce(repoRoot, workerEnv);
    assert.equal(worker.code, 0, worker.output);
    await waitFor(async () => cdp.evaluate(`document.body.innerText.includes("실제 브라우저 인터뷰 질문")`), 10_000, "polling transition to INTERVIEW and start");
    await new Promise((resolve) => setTimeout(resolve, 1800));
    assert.equal(summarizeCalls, 1);
    assert.equal(coachStartCalls, 1, "first observed INTERVIEW must start one logical attempt");
    assert.equal(sqlScalar(local.DB_URL, `select status from public.practice_upstream_operations where session_id='${successSessionId}' and kind='analysis_create'`), "completed");
    assert.equal(sqlScalar(local.DB_URL, `select count(*) from public.scene_summaries where session_id='${successSessionId}'`), "1");
    const completedReplay = await cdp.evaluate(`fetch("/api/v1/practice-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: ${JSON.stringify(successRequestId)}, uploadIntentId: ${JSON.stringify(successUploadId)}, situation: "실제 상황", characterContext: "실제 인물", subtext: "실제 의도" }) }).then(async (response) => ({ status: response.status, body: await response.json() }))`);
    assert.equal(completedReplay.status, 200, JSON.stringify(completedReplay.body));
    assert.ok(completedReplay.body.currentRun, "completed analysis replay must hydrate interview progress after completion");
    assert.equal(completedReplay.body.turns.length, 1, "completed analysis replay must return the current persisted session");

    const failedCreate = await cdp.evaluate(`fetch("/api/v1/practice-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), uploadIntentId: ${JSON.stringify(failedUploadId)}, situation: "실패 상황", characterContext: "실패 인물", subtext: "실패 의도" }) }).then(async (response) => ({ status: response.status, body: await response.json() }))`);
    assert.equal(failedCreate.status, 202, `${JSON.stringify(failedCreate.body)}\n${appOutput}`);
    assert.equal(failedCreate.body.id, failedSessionId);
    await cdp.evaluate(`localStorage.setItem("acttub:active-practice-session-id", ${JSON.stringify(failedSessionId)})`);
    await cdp.send("Page.navigate", { url: `${appOrigin}/practice/new` });
    await waitFor(async () => cdp.evaluate(`document.body.innerText.includes("장면을 분석하고 있어요")`), 10_000, "terminal-case ANALYZING UI");
    const failedWorker = await runWorkerOnce(repoRoot, workerEnv);
    assert.equal(failedWorker.code, 0, failedWorker.output);
    await waitFor(async () => cdp.evaluate(`document.body.innerText.includes("분석을 완료하지 못했지만 같은 영상으로 다시 시도할 수 있어요")`), 10_000, "terminal failure UI");
    const failedGetUrl = `${appOrigin}/api/v1/practice-sessions/${failedSessionId}`;
    const stoppedAt = responseCounts.get(failedGetUrl) ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 1800));
    assert.equal(responseCounts.get(failedGetUrl) ?? 0, stoppedAt, "terminal failure must stop browser polling");
    assert.equal(sqlScalar(local.DB_URL, `select analysis_status||':'||analysis_error||':'||analysis_retryable from public.practice_takes where session_id='${failedSessionId}'`), "failed:source_video_unavailable:true");
  } finally {
    cdp?.close(); chrome.kill("SIGTERM"); await stopChild(app);
    await new Promise((resolve) => actingApi.close(resolve));
    await admin.storage.from("practice-videos").remove([successPath]);
    await admin.auth.admin.deleteUser(userId);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
