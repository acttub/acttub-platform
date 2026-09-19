// 웹의 세션은 게스트 하나뿐이다(account.guest). 시작은 처음 보호 기능을 쓰려 할 때,
// 끝은 서버가 갱신을 거절했을 때다 — 그 게스트에는 다시 닿을 수 없다.
export type SessionEvent = "guest-started" | "guest-ended";
export type SessionEventListener = (event: SessionEvent) => void;

const SESSION_EVENTS: SessionEvent[] = ["guest-started", "guest-ended"];

let sessionEventTarget: EventTarget | null = null;

function getSessionEventTarget(): EventTarget | null {
  if (typeof EventTarget === "undefined") return null;
  sessionEventTarget ??= new EventTarget();
  return sessionEventTarget;
}

export function emitSessionEvent(event: SessionEvent): void {
  const target = getSessionEventTarget();
  if (!target || typeof Event === "undefined") return;
  target.dispatchEvent(new Event(event));
}

export function onSessionEvent(listener: SessionEventListener): () => void {
  const target = getSessionEventTarget();
  if (!target) return () => undefined;

  const handleEvent: EventListener = (event) => {
    listener(event.type as SessionEvent);
  };
  for (const event of SESSION_EVENTS) target.addEventListener(event, handleEvent);

  return () => {
    for (const event of SESSION_EVENTS) {
      target.removeEventListener(event, handleEvent);
    }
  };
}
