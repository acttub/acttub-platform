// Slack에 간 Sentry 운영 알림마다 claude -p에 원인 분석·Jira 이슈·draft PR을 맡긴다.
// 알림 목록은 Slack 중계 Worker의 KV에서 가져온다. Mac mini launchd에서 15분마다 돈다. 준비와 되돌리기는 README.
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
const RUN_TIMEOUT_MS = 90 * 60_000; // CI 결과 기다림까지
// Mac mini의 RTK 훅이 명령을 `rtk <명령>`으로 바꾸므로 두 모양을 다 허용한다.
const TOOLS = [
  "Read", "Grep", "Glob", "Edit", "Write",
  ...["git", "./gradlew", "pnpm", "gh pr create", "gh pr view", "gh pr list", "gh pr checks", "gh run view"]
    .flatMap((c) => [`Bash(${c}:*)`, `Bash(rtk ${c}:*)`]),
  ...["createJiraIssue", "getJiraIssue", "getTransitionsForJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue"].map((t) => `mcp__atlassian__${t}`),
].join(",");

export const DAILY_RULE = "운영 계속 남";

// 알림마다 한 번. 마지막 처리 뒤에 온 알림 중 같은 이슈는 가장 늦은 것만 고른다. 먼저 온 알림부터.
// 하루 한 번 오는 "계속 남"은 처음 보는 이슈, 지난번에 끝내지 못한 이슈, 고친 PR이 운영에 나갔는데도 나는 이슈만 처리한다.
export function pick(alerts, state, deployed = () => false) {
  const latest = new Map();
  for (const a of alerts) {
    const prev = state.handled[a.issueId];
    if (prev?.at >= Date.parse(a.at)) continue;
    const retry = !prev || ["fail", "running"].includes(prev.verdict) || (prev.verdict === "pr" && deployed(prev));
    if (a.rule === DAILY_RULE && !retry) continue;
    if (!(latest.get(a.issueId)?.at > a.at)) latest.set(a.issueId, a);
  }
  return [...latest.values()].sort((a, b) => a.at.localeCompare(b.at));
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

// 머지된 PR이 운영(main)에 들어갔는지. dev는 squash, dev→main은 merge commit이라 조상 관계로 본다.
function deployed(prev) {
  const sha = spawnSync("gh", ["pr", "view", prev.pr, "--json", "mergeCommit", "-q", ".mergeCommit.oid"], { encoding: "utf8" }).stdout.trim();
  return sha !== "" && git("merge-base", "--is-ancestor", sha, "origin/main").status === 0;
}

async function handle(issue, alert, statePath, state, prev) {
  const head = `[자동 수정] <${issue.permalink}|${issue.shortId}>`;
  // 앞서 연 PR이 아직 열려 있으면 같은 원인으로 PR을 또 만들지 않는다.
  if (prev?.verdict === "pr") {
    const open = spawnSync("gh", ["pr", "view", prev.pr, "--json", "state", "-q", ".state"], { encoding: "utf8" }).stdout.trim() === "OPEN";
    if (open) {
      state.handled[issue.id] = { ...prev, at: Date.now() };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      return slack(`${head} 다시 알림이 왔지만 앞의 <${prev.pr}|PR>(${prev.jira})이 아직 열려 있어 건너뜀`);
    }
  }
  const event = await sentry(`/issues/${issue.id}/events/latest/`);
  const ctx = join(STATE_DIR, "ctx", `${issue.shortId}.json`);
  mkdirSync(dirname(ctx), { recursive: true });
  writeFileSync(ctx, JSON.stringify({ alert: alert.rule, ...summarize(issue, event) }, null, 2));

  const wt = join(HOME, "acttub-autofix", `wt-${issue.shortId}`);
  git("fetch", "-q", "origin", "dev");
  git("worktree", "remove", "--force", wt); // 지난 실행이 중간에 죽어 남긴 폴더
  git("worktree", "add", "-q", "--detach", wt, "origin/dev");
  const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prompt.md"), "utf8")
    .replaceAll("{{CONTEXT}}", ctx)
    .replaceAll("{{PERMALINK}}", issue.permalink)
    .replaceAll("{{PREVIOUS}}", prev?.verdict === "pr" ? `이 오류는 전에 ${prev.jira}(${prev.pr})로 고쳤는데 다시 알림이 왔다. 새 Jira 이슈의 배경에 그 이슈와 PR을 적는다.` : "");
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
  await slack(
    result.verdict === "pr" ? `${head} → ${result.jira} <${result.pr}|draft PR>${result.ci === "fail" ? " (CI 실패)" : ""}\n${result.reason ?? ""}`
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
    let state = { handled: {} };
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {}
    const res = await fetch(secret("sentry-relay-alerts-url"));
    if (!res.ok) throw new Error(`alerts ${res.status}`);
    const dryRun = process.argv.includes("--dry-run");
    git("fetch", "-q", "origin", "main");
    const picks = pick(await res.json(), state, deployed);
    for (const alert of process.argv.includes("--once") ? picks.slice(0, 1) : picks) {
      const issue = await sentry(`/issues/${alert.issueId}/`);
      if (dryRun) {
        console.log("후보", issue.shortId, issue.status, alert.rule, alert.at, issue.title);
        continue;
      }
      const prev = state.handled[issue.id];
      // 알림 뒤에 사람이 해결·보관한 이슈는 건너뛴다. 다시 나면 새 알림이 온다.
      if (issue.status !== "unresolved") {
        state.handled[issue.id] = { verdict: "skip", reason: `알림 뒤 ${issue.status}`, ...prev, at: Date.now(), shortId: issue.shortId };
        writeFileSync(statePath, JSON.stringify(state, null, 2));
        continue;
      }
      // claude가 죽어도 같은 알림을 다시 돌지 않게 먼저 기록한다.
      state.handled[issue.id] = { at: Date.now(), shortId: issue.shortId, verdict: "running" };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      await handle(issue, alert, statePath, state, prev).catch((e) => slack(`[자동 수정] ${issue.shortId} 실패: ${e.message}`));
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
