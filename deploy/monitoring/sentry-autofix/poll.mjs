// Slack에 간 Sentry 알림마다 claude -p에 원인 분석·Jira 이슈·draft PR을 맡긴다.
// 운영 알림은 main 대상 hotfix로 고치고, 머지되면 main → dev 역병합 PR을 연다. dev 알림은 dev로 고친다.
// 알림 목록은 Slack 중계 Worker의 KV에서 가져온다. Mac mini launchd에서 15분마다 돈다. 준비와 되돌리기는 README.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOME = homedir();
const CONF = join(HOME, ".config/acttub");
const STATE_DIR = join(HOME, ".local/state/acttub-sentry-autofix");
const REPO = join(HOME, "acttub-autofix/repo");
const SENTRY = "https://us.sentry.io/api/0/organizations/acttub";
const GH_REPO = "acttub/acttub-platform";
const RUN_TIMEOUT_MS = 90 * 60_000; // CI 결과 기다림까지
const STALE_LOCK_MS = 3 * 60 * 60_000;
// Mac mini의 RTK 훅이 명령을 `rtk <명령>`으로 바꾸므로 두 모양을 다 허용한다.
const TOOLS = [
  "Read", "Grep", "Glob", "Edit", "Write",
  ...["git", "./gradlew", "pnpm", "gh pr create", "gh pr view", "gh pr list", "gh pr checks", "gh run view"]
    .flatMap((c) => [`Bash(${c}:*)`, `Bash(rtk ${c}:*)`]),
  ...["createJiraIssue", "getJiraIssue", "searchJiraIssuesUsingJql", "getTransitionsForJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue"].map((t) => `mcp__atlassian__${t}`),
].join(",");

export const DAILY_RULE = "운영 계속 남";

// 환경별 작업 기준과 PR 대상. prompt.md의 같은 이름 자리에 들어간다.
export const TARGET = {
  prod: {
    ENV: "운영", BASE: "main", BRANCH: "hotfix/SOMA-<번호>",
    WORKDIR: "작업 폴더는 운영 코드인 `origin/main`이다. 고친 것은 `main`으로 hotfix PR을 열어 사람이 머지하면 바로 운영에 나간다.",
    FIXED: "   - 현재 `origin/main`에 이미 고쳐진 경우\n   - `origin/dev`에만 고쳐져 출시를 기다리는 경우. reason에 \"출시 대기\"와 그 커밋을 적는다.",
    MERGE_NOTE: "머지하면 운영에 배포되고, 머지 뒤 자동 수정이 main → dev 역병합 PR을 연다",
  },
  dev: {
    ENV: "dev", BASE: "dev", BRANCH: "Fiddich-Dev/soma-<번호>",
    WORKDIR: "작업 폴더는 개발 코드인 `origin/dev`다. 고친 것은 `dev`로 PR을 열어 사람이 squash merge하면 개발 환경에 나가고 다음 릴리스로 운영에 간다.",
    FIXED: "   - 현재 `origin/dev`에 이미 고쳐진 경우",
    MERGE_NOTE: "dev 오류의 수정이다. squash merge하면 개발 환경에 배포되고 다음 릴리스로 운영에 나간다",
  },
};
export const PROMPT = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");
export const renderPrompt = (template, env, values) =>
  Object.entries({ ...TARGET[env], ...values }).reduce((p, [k, v]) => p.replaceAll(`{{${k}}}`, v), template);
// KV의 옛 알림에는 env가 없다. 그때는 운영 알림만 남겼다.
export const envOf = (a) => (a.env === "dev" ? "dev" : "prod");

// 알림마다 한 번. 마지막 처리 뒤에 온 알림 중 같은 이슈는 가장 늦은 것만 고른다. 운영 알림 먼저, 그 안에서는 먼저 온 알림부터.
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
  return [...latest.values()].sort((a, b) => (envOf(a) === "dev") - (envOf(b) === "dev") || a.at.localeCompare(b.at));
}

// 운영(main)에 머지됐는데 아직 dev로 역병합 PR을 열지 않은 hotfix. 닫힌 PR은 역병합할 것이 없어 표시만 한다.
export function merged(handled, prState) {
  const due = [];
  for (const h of Object.values(handled)) {
    if (!h.hotfix || h.verdict !== "pr" || h.backmerge) continue;
    const state = prState(h.pr);
    if (state === "CLOSED") h.backmerge = "닫힘";
    if (state === "MERGED") due.push(h);
  }
  return due;
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

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${secret("sentry-slack-bot-token")}` },
    body: JSON.stringify(body),
  });
  const { ok, error } = await res.json();
  if (!ok && !["already_reacted", "no_reaction"].includes(error)) console.log("slack", method, error);
}

export const EMOJI = { running: "hourglass_flowing_sand", pr: "white_check_mark", open: "link", skip: "fast_forward", fail: "x" };

// 알림 메시지에 결과 이모지를 달고 스레드에 답한다. 메시지 위치가 없는 옛 알림은 채널에 따로 올린다.
async function report(alert, verdict, text) {
  if (!alert.ts) return text && slack(text);
  const at = { channel: alert.channel, timestamp: alert.ts };
  if (verdict !== "running") await slackApi("reactions.remove", { ...at, name: EMOJI.running });
  await slackApi("reactions.add", { ...at, name: EMOJI[verdict] });
  if (text) await slackApi("chat.postMessage", { channel: alert.channel, thread_ts: alert.ts, text });
}

const git = (...args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
const gh = (...args) => spawnSync("gh", args, { encoding: "utf8" }).stdout.trim();

// 머지된 PR이 운영(main)에 들어갔는지. dev는 squash, dev→main은 merge commit이라 조상 관계로 본다.
function deployed(prev) {
  const sha = gh("pr", "view", prev.pr, "--json", "mergeCommit", "-q", ".mergeCommit.oid");
  return sha !== "" && git("merge-base", "--is-ancestor", sha, "origin/main").status === 0;
}

async function handle(issue, alert, statePath, state, prev) {
  const env = envOf(alert);
  const head = `[자동 수정${env === "dev" ? " · dev" : ""}] <${issue.permalink}|${issue.shortId}>`;
  // 앞서 연 PR이 아직 열려 있으면 같은 원인으로 PR을 또 만들지 않는다.
  if (prev?.verdict === "pr") {
    const open = gh("pr", "view", prev.pr, "--json", "state", "-q", ".state") === "OPEN";
    if (open) {
      state.handled[issue.id] = { ...prev, at: Date.now() };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      return report(alert, "open", `${head} 다시 알림이 왔지만 앞의 <${prev.pr}|PR>(${prev.jira})이 아직 열려 있어 건너뜀`);
    }
  }
  await report(alert, "running");
  const event = await sentry(`/issues/${issue.id}/events/latest/`);
  const ctx = join(STATE_DIR, "ctx", `${issue.shortId}.json`);
  mkdirSync(dirname(ctx), { recursive: true });
  writeFileSync(ctx, JSON.stringify({ alert: alert.rule, ...summarize(issue, event) }, null, 2));

  const wt = join(HOME, "acttub-autofix", `wt-${issue.shortId}`);
  git("fetch", "-q", "origin", "dev");
  git("worktree", "remove", "--force", wt); // 지난 실행이 중간에 죽어 남긴 폴더
  git("worktree", "add", "-q", "--detach", wt, `origin/${TARGET[env].BASE}`);
  const prompt = renderPrompt(readFileSync(PROMPT, "utf8"), env, {
    CONTEXT: ctx,
    PERMALINK: issue.permalink,
    PREVIOUS: prev?.verdict === "pr" ? `이 오류는 전에 ${prev.jira}(${prev.pr})로 고쳤는데 다시 알림이 왔다. 새 Jira 이슈의 배경에 그 이슈와 PR을 적는다.` : "",
  });
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

  state.handled[issue.id] = { at: Date.now(), shortId: issue.shortId, hotfix: env === "prod", ...result };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  await report(
    alert,
    ["pr", "skip"].includes(result.verdict) ? result.verdict : "fail",
    result.verdict === "pr" ? `${head} → ${result.jira} <${result.pr}|draft PR>${result.ci === "fail" ? " (CI 실패)" : ""}\n${result.reason ?? ""}`
      : result.verdict === "skip" ? `${head} 코드 수정 대상 아님: ${result.reason}`
        : `${head} 실패: ${result.reason}`,
  );
}

// 한 PR이 머지된 hotfix를 모두 싣는다. 이미 열린 main → dev PR이 있으면 그것을 쓴다.
async function backmerge(statePath, state) {
  const due = merged(state.handled, (pr) => gh("pr", "view", pr, "--json", "state", "-q", ".state"));
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  if (due.length === 0) return;
  const keys = due.map((h) => h.jira).join(" ");
  const url = gh("pr", "list", "-R", GH_REPO, "--base", "dev", "--head", "main", "--state", "open", "--json", "url", "-q", ".[0].url")
    || gh("pr", "create", "-R", GH_REPO, "--base", "dev", "--head", "main", "--title", `${keys} 운영 hotfix를 dev에 역병합한다`, "--body",
      `운영에 머지된 Sentry 자동 수정 hotfix를 dev에 반영한다.\n\n${due.map((h) => `- ${h.jira} ${h.pr}`).join("\n")}\n\nMerge commit으로 합친다(squash·rebase 금지, docs/BRANCHING-STRATEGY.md 「Hotfix」).\n\n🤖 Sentry 자동 수정(Claude Code)`);
  if (!url) return console.log("역병합 PR을 못 열었다", keys); // 다음 실행에서 다시 시도
  for (const h of due) h.backmerge = url;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  await slack(`[자동 수정] ${keys} 운영 머지됨 → <${url}|dev 역병합 PR>. Merge commit으로 합쳐 주세요`);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

// 잠금 폴더에 실행 중인 pid를 적는다. 강제 종료로 남은 잠금은 그 pid가 죽었으면 풀고 다시 잡는다.
// 그러지 않으면 이후 실행이 모두 "이전 실행이 아직 돈다"로 조용히 끝난다.
export function takeLock(lock, isAlive = alive) {
  for (let i = 0; i < 2; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let pid = NaN;
    try {
      pid = Number(readFileSync(join(lock, "pid"), "utf8"));
    } catch {}
    // pid가 없으면 막 잡은 참이거나 pid를 적지 않던 옛 판의 잠금이다. 예약 작업 실행 한도(2시간 30분)보다 오래됐으면 남은 잠금으로 본다.
    const stale = Number.isInteger(pid) && pid > 0 ? !isAlive(pid) : Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
    if (!stale) return false;
    console.log(`남은 잠금을 푼다(pid ${pid})`);
    rmSync(lock, { recursive: true, force: true });
  }
  return false;
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  const lock = join(STATE_DIR, "lock");
  if (!takeLock(lock)) return console.log("이전 실행이 아직 돈다");
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
    if (!dryRun) await backmerge(statePath, state);
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
        await report(alert, "skip");
        continue;
      }
      // claude가 죽어도 같은 알림을 다시 돌지 않게 먼저 기록한다.
      state.handled[issue.id] = { at: Date.now(), shortId: issue.shortId, verdict: "running" };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      await handle(issue, alert, statePath, state, prev).catch((e) => report(alert, "fail", `[자동 수정] ${issue.shortId} 실패: ${e.message}`));
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
