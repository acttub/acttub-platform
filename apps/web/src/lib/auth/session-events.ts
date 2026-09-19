// 웹의 세션은 게스트 하나뿐이다(account.guest). 시작은 처음 보호 기능을 쓰려 할 때,
// 끝은 서버가 갱신을 거절했을 때다 — 그 게스트에는 다시 닿을 수 없다.
//
// 앱으로 옮겨져 끝난 게스트는 `guest-ended` 에 이어 `guest-transferred` 도 알린다. 끝났다는
// 것만 보면 되는 자리(조회 가리기·계측 끄기)는 앞엣것으로 충분하고, "옮겼어요" 안내만
// 뒤엣것을 듣는다.
export type SessionEvent = "guest-started" | "guest-ended" | "guest-transferred";
export type SessionEventListener = (event: SessionEvent) => void;

const SESSION_EVENTS: SessionEvent[] = [
  "guest-started",
  "guest-ended",
  "guest-transferred",
];

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
