// Sentry internal integration(acttub-slack-relay)의 알림 규칙 액션을 Slack 메시지(봇 chat.postMessage)로 바꿔 넘긴다.
// 요청은 URL 경로의 비밀 토큰과 Sentry-Hook-Signature(client secret HMAC) 둘 다 맞아야 받는다.
// 운영 알림은 KV(ALERTS)에도 메시지 위치(channel·ts)와 함께 남겨, Mac mini 자동 수정(sentry-autofix)이 가져가 그 스레드에 결과를 단다.

const ENV_LABEL = { prod: "운영", dev: "dev" };
const PROJECT = { 4511874739273728: "acttub-web", 4511874784231424: "acttub-api" };

const QUEUE_TTL_S = 14 * 86_400;

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 규칙 이름("운영 계속 남")에서 환경 단어를 뺀 나머지를 무슨 일인지로 붙인다.
export function toSlack(event, rule = "") {
  const tags = Object.fromEntries(Array.isArray(event.tags) ? event.tags : []);
  const env = event.environment ?? tags.environment ?? "unknown";
  const title = escape(event.title ?? event.message ?? "(제목 없음)");
  const kind = escape(rule.replace(/^(운영|dev)\s*/, ""));
  const head = `*[${ENV_LABEL[env] ?? env}${kind ? ` · ${kind}` : ""}]* ${PROJECT[event.project] ?? event.project ?? "?"} · ${escape(event.level ?? "?")}`;
  // 이벤트 본문(요청·사용자 정보)은 넘기지 않는다. 제목·위치·링크만 보낸다.
  const lines = [head, event.web_url ? `<${event.web_url}|${title}>` : title];
  if (event.culprit) lines.push(escape(event.culprit));
  return { text: lines.join("\n") };
}

// 자동 수정이 쓸 최소 정보만 남긴다. 운영이 아니거나 이슈 ID가 없으면 null.
export function alertRecord(payload, at) {
  const event = payload.data?.event ?? {};
  const tags = Object.fromEntries(Array.isArray(event.tags) ? event.tags : []);
  if ((event.environment ?? tags.environment) !== "prod") return null;
  const issueId = event.issue_id ?? event.web_url?.match(/\/issues\/(\d+)\//)?.[1];
  return issueId ? { issueId: String(issueId), rule: payload.data.triggered_rule ?? "", at } : null;
}

async function signatureOk(body, signature, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = signature?.match(/^[0-9a-f]{64}$/) ? Uint8Array.from(signature.match(/../g), (h) => parseInt(h, 16)) : null;
  return bytes !== null && crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (env.RELAY_TOKEN && request.method === "GET" && path === `/${env.RELAY_TOKEN}/alerts`) {
      // shortcut: 첫 1000개만 읽는다. 14일 안에 운영 알림이 1000개를 넘으면 cursor를 따라간다.
      const { keys } = await env.ALERTS.list();
      return Response.json(keys.map((k) => k.metadata));
    }
    if (!env.RELAY_TOKEN || request.method !== "POST" || path !== `/${env.RELAY_TOKEN}`) {
      return new Response("not found", { status: 404 });
    }
    const body = await request.text();
    if (!(await signatureOk(body, request.headers.get("sentry-hook-signature"), env.SENTRY_CLIENT_SECRET))) {
      return new Response("bad signature", { status: 401 });
    }
    // 알림 규칙 액션만 넘긴다. installation 등 다른 리소스 webhook은 받기만 한다.
    if (request.headers.get("sentry-hook-resource") !== "event_alert") return new Response("ignored");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const event = payload.data?.event;
    if (!event) return new Response("bad json", { status: 400 });
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL, ...toSlack(event, payload.data.triggered_rule) }),
    });
    // Slack API는 실패도 200에 ok:false로 준다.
    const posted = res.ok ? await res.json().catch(() => ({})) : {};
    // KV가 실패해도 Slack 알림은 이미 갔으므로 응답은 Slack 결과를 따른다.
    const record = alertRecord(payload, new Date().toISOString());
    if (record) {
      const metadata = posted.ok ? { ...record, channel: posted.channel, ts: posted.ts } : record;
      await env.ALERTS.put(`${record.at}:${record.issueId}`, "", { metadata, expirationTtl: QUEUE_TTL_S }).catch((e) => console.error("kv put", e));
    }
    // Slack 실패를 그대로 돌려줘 Sentry 쪽 기록에 남게 한다.
    return new Response(posted.ok ? "ok" : "slack failed", { status: posted.ok ? 200 : 502 });
  },
};
