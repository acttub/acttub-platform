// Sentry internal integration(acttub-slack-relay)의 알림 규칙 액션을 Slack incoming webhook 메시지로 바꿔 넘긴다.
// 요청은 URL 경로의 비밀 토큰과 Sentry-Hook-Signature(client secret HMAC) 둘 다 맞아야 받는다.

const ENV_LABEL = { prod: "운영", dev: "dev" };
const PROJECT = { 4511874739273728: "acttub-web", 4511874784231424: "acttub-api" };

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toSlack(event) {
  const tags = Object.fromEntries(Array.isArray(event.tags) ? event.tags : []);
  const env = event.environment ?? tags.environment ?? "unknown";
  const title = escape(event.title ?? event.message ?? "(제목 없음)");
  const head = `*[${ENV_LABEL[env] ?? env}]* ${PROJECT[event.project] ?? event.project ?? "?"} · ${escape(event.level ?? "?")}`;
  // 이벤트 본문(요청·사용자 정보)은 넘기지 않는다. 제목·위치·링크만 보낸다.
  const lines = [head, event.web_url ? `<${event.web_url}|${title}>` : title];
  if (event.culprit) lines.push(escape(event.culprit));
  return { text: lines.join("\n") };
}

async function signatureOk(body, signature, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = signature?.match(/^[0-9a-f]{64}$/) ? Uint8Array.from(signature.match(/../g), (h) => parseInt(h, 16)) : null;
  return bytes !== null && crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
}

export default {
  async fetch(request, env) {
    if (!env.RELAY_TOKEN || request.method !== "POST" || new URL(request.url).pathname !== `/${env.RELAY_TOKEN}`) {
      return new Response("not found", { status: 404 });
    }
    const body = await request.text();
    if (!(await signatureOk(body, request.headers.get("sentry-hook-signature"), env.SENTRY_CLIENT_SECRET))) {
      return new Response("bad signature", { status: 401 });
    }
    // 알림 규칙 액션만 넘긴다. installation 등 다른 리소스 webhook은 받기만 한다.
    if (request.headers.get("sentry-hook-resource") !== "event_alert") return new Response("ignored");
    let event;
    try {
      event = JSON.parse(body).data.event;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toSlack(event)),
    });
    // Slack 실패를 그대로 돌려줘 Sentry 쪽 기록에 남게 한다.
    return new Response(res.ok ? "ok" : "slack failed", { status: res.ok ? 200 : 502 });
  },
};
