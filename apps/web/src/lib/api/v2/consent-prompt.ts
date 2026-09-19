import type { ConsentDocument } from "./types";

// 게스트는 기능을 처음 쓰는 순간 그 기능에 필요한 문서만 시트로 결정한다(account.guest).
// 공용 클라이언트는 403 consent_required 를 받으면 여기에 등록된 시트를 띄우고, 결정이
// 끝나면 같은 요청을 다시 보낸다. 시트를 그리고 결정을 보내는 일은 화면의 몫이다.

/** decided: 결정을 서버에 보냈다(다시 보낼 차례). dismissed: 배우가 시트를 닫았다. */
export type ConsentPromptResult = "decided" | "dismissed";
export type ConsentPrompt = (
  documents: ConsentDocument[],
) => Promise<ConsentPromptResult>;

let registeredPrompt: ConsentPrompt | null = null;
let promptInFlight: Promise<ConsentPromptResult> | null = null;
// 시트가 떠 있던 시간. 그동안은 서버가 아니라 배우가 문서를 읽고 있으므로, 요청의 기한을
// 세는 쪽(idempotency.ts)이 이만큼을 빼고 센다.
let promptOpenedAt: number | null = null;
let promptClosedMs = 0;

/** 루트 레이아웃의 시트가 한 번 등록한다. 돌려주는 함수로 거둔다. */
export function registerConsentPrompt(prompt: ConsentPrompt): () => void {
  registeredPrompt = prompt;
  return () => {
    if (registeredPrompt === prompt) registeredPrompt = null;
  };
}

/**
 * 동시에 막힌 요청들은 시트 하나를 함께 기다린다. 뒤에 온 요청의 문서가 달랐다면 다시
 * 보낸 요청이 또 막히면서 그 문서로 시트가 새로 뜬다.
 */
export function askConsent(
  documents: ConsentDocument[],
): Promise<ConsentPromptResult> {
  if (promptInFlight) return promptInFlight;
  if (!registeredPrompt) return Promise.resolve("dismissed");

  const openedAt = Date.now();
  const pending = registeredPrompt(documents);
  promptInFlight = pending;
  promptOpenedAt = openedAt;
  const release = () => {
    if (promptInFlight !== pending) return;
    promptInFlight = null;
    promptOpenedAt = null;
    promptClosedMs += Date.now() - openedAt;
  };
  void pending.then(release, release);
  return pending;
}

/** 지금까지 동의 시트가 떠 있던 시간(ms). 지금 열려 있는 시트의 시간도 센다. */
export function consentPromptElapsedMs(now: number = Date.now()): number {
  return promptClosedMs + (promptOpenedAt === null ? 0 : now - promptOpenedAt);
}

/** 시트가 열려 있으면 닫힐 때 풀리는 약속, 아니면 null. 시트의 결과는 싣지 않는다. */
export function whenConsentPromptCloses(): Promise<void> | null {
  if (!promptInFlight) return null;
  return promptInFlight.then(
    () => undefined,
    () => undefined,
  );
}
