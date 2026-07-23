export type SessionEvent = "login" | "logout" | "consent-required";
export type SessionEventListener = (event: SessionEvent) => void;

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
  target.addEventListener("login", handleEvent);
  target.addEventListener("logout", handleEvent);
  target.addEventListener("consent-required", handleEvent);

  return () => {
    target.removeEventListener("login", handleEvent);
    target.removeEventListener("logout", handleEvent);
    target.removeEventListener("consent-required", handleEvent);
  };
}
