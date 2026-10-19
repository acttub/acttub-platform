// Sentry 운영 새 이슈·재발 이슈를 골라 이슈마다 claude -p에 원인 분석·Jira 이슈·draft PR을 맡긴다.
// Mac mini launchd에서 15분마다 돈다. 준비와 되돌리기는 README.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOME = homedir();
const CONF = join(HOME, ".config/acttub");
const STATE_DIR = join(HOME, ".local/state/acttub-sentry-autofix");
const REPO = join(HOME, "acttub-autofix/repo");
const SENTRY = "https://us.sentry.io/api/0/organizations/acttub";
const DAILY_LIMIT = 3;
const DAY_MS = 86_400_000;
const REGRESS_COOLDOWN_MS = 7 * DAY_MS;
const RUN_TIMEOUT_MS = 60 * 60_000;
// Mac mini의 RTK 훅이 명령을 `rtk <명령>`으로 바꾸므로 두 모양을 다 허용한다.
const TOOLS = [
  "Read", "Grep", "Glob", "Edit", "Write",
  ...["git", "./gradlew", "pnpm", "gh pr create", "gh pr view"].flatMap((c) => [`Bash(${c}:*)`, `Bash(rtk ${c}:*)`]),
  "mcp__atlassian__createJiraIssue", "mcp__atlassian__getJiraIssue",
].join(",");

// 새 이슈는 한 번, 재발은 7일에 한 번. 24시간에 DAILY_LIMIT번까지, 이벤트가 많은 이슈부터.
export function pick(issues, state, now) {
  const left = DAILY_LIMIT - state.runs.filter((t) => now - t < DAY_MS).length;
  return issues
    .filter((i) => {
      const prev = state.handled[i.id];
      if (i.substatus === "new") return !prev;
      if (i.substatus === "regressed") return !prev || now - prev.at > REGRESS_COOLDOWN_MS;
      return false;
    })
    .sort((a, b) => Number(b.count) - Number(a.count))
    .slice(0, Math.max(0, left));
}

// 요청·사용자·breadcrumb은 빼고 예외와 우리 코드 프레임만 넘긴다. 메시지 값은 외부 입력이다.
export function summarize(issue, event) {
  const exceptions = (event.entries ?? [])
    .filter((e) => e.type === "exception")
    .flatMap((e) => e.data.values ?? [])
    .map((v) => ({
      type: v.type,
      value: v.value,
      frames: (v.stacktrace?.frames ?? [])
        .filter((f) => f.inApp)
        .map((f) => ({ file: f.filename, function: f.function, line: f.lineNo, code: f.context?.find(([n]) => n === f.lineNo)?.[1] })),
    }));
  const keep = new Set(["environment", "release", "level", "transaction", "runtime", "browser"]);
  return {
    issue: {
      shortId: issue.shortId, title: issue.title, culprit: issue.culprit, permalink: issue.permalink,
      project: issue.project.slug, substatus: issue.substatus, count: issue.count, firstSeen: issue.firstSeen, lastSeen: issue.lastSeen,
    },
    tags: Object.fromEntries((event.tags ?? []).filter((t) => keep.has(t.key)).map((t) => [t.key, t.value])),
    exceptions,
  };
}

// 마지막 줄의 JSON 결과를 읽는다. 없으면 fail로 본다.
export function verdictOf(text) {
  const line = String(text).trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  try {
    return JSON.parse(line);
  } catch {
    return { verdict: "fail", reason: "결과 JSON 없음" };
  }
}

const secret = (name) => readFileSync(join(CONF, name), "utf8").trim();

async function sentry(path, params = {}) {
  const url = new URL(SENTRY + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { authorization: `Bearer ${secret("sentry-read-token")}` } });
  if (!res.ok) throw new Error(`sentry ${path} ${res.status}`);
  return res.json();
}

async function slack(text) {
  await fetch(secret("sentry-slack-webhook"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
}

const git = (...args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });

async function handle(issue, statePath, state) {
  const event = await sentry(`/issues/${issue.id}/events/latest/`);
  const ctx = join(STATE_DIR, "ctx", `${issue.shortId}.json`);
  mkdirSync(dirname(ctx), { recursive: true });
  writeFileSync(ctx, JSON.stringify(summarize(issue, event), null, 2));

  const wt = join(HOME, "acttub-autofix", `wt-${issue.shortId}`);
  git("fetch", "-q", "origin", "dev");
  git("worktree", "remove", "--force", wt); // 지난 실행이 중간에 죽어 남긴 폴더
  git("worktree", "add", "-q", "--detach", wt, "origin/dev");
  const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prompt.md"), "utf8")
    .replaceAll("{{CONTEXT}}", ctx)
    .replaceAll("{{PERMALINK}}", issue.permalink);
  const run = spawnSync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", TOOLS], {
    cwd: wt, encoding: "utf8", timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  let result;
  try {
    result = verdictOf(JSON.parse(run.stdout).result);
  } catch {
    result = { verdict: "fail", reason: `claude 종료 ${run.status ?? run.signal}` };
  }
  writeFileSync(join(STATE_DIR, "ctx", `${issue.shortId}.out.json`), run.stdout ?? "");
  // 브랜치는 push됐으므로 작업 폴더만 지운다.
  git("worktree", "remove", "--force", wt);

  state.handled[issue.id] = { at: Date.now(), shortId: issue.shortId, ...result };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const head = `[자동 수정] <${issue.permalink}|${issue.shortId}>`;
  await slack(
    result.verdict === "pr" ? `${head} → ${result.jira} <${result.pr}|draft PR>\n${result.reason ?? ""}`
      : result.verdict === "skip" ? `${head} 코드 수정 대상 아님: ${result.reason}`
        : `${head} 실패: ${result.reason}`,
  );
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  const lock = join(STATE_DIR, "lock");
  try {
    mkdirSync(lock);
  } catch {
    return console.log("이전 실행이 아직 돈다");
  }
  try {
    const statePath = join(STATE_DIR, "state.json");
    let state = { handled: {}, runs: [] };
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {}
    const issues = [];
    for (const q of ["is:unresolved is:new", "is:unresolved is:regressed"]) {
      issues.push(...(await sentry("/issues/", { query: q, environment: "prod", statsPeriod: "14d", limit: "100" })));
    }
    const dryRun = process.argv.includes("--dry-run");
    const picks = pick(issues, state, Date.now());
    for (const issue of process.argv.includes("--once") ? picks.slice(0, 1) : picks) {
      if (dryRun) {
        console.log("후보", issue.shortId, issue.substatus, issue.count, issue.title);
        continue;
      }
      // claude가 죽어도 같은 이슈를 다시 돌지 않게 먼저 기록한다.
      state.runs.push(Date.now());
      state.handled[issue.id] = { at: Date.now(), shortId: issue.shortId, verdict: "running" };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      await handle(issue, statePath, state).catch((e) => slack(`[자동 수정] ${issue.shortId} 실패: ${e.message}`));
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
