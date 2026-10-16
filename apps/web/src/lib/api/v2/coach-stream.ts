import { createSseParser } from "./sse";

/**
 * 코치 답을 SSE 로 받는 규칙(순수). 서버 계약:
 *  - `event: delta` data `{"text":"…"}` → 말풍선에 이어 붙인다.
 *  - `event: done` data 는 일반 응답(ConversationTurnResponse)과 같다 → 최종 결과. 늘 이것을 믿는다.
 *  - `event: error` data `{"status":409,"detail":"…"}` → HTTP 오류와 똑같이 다룬다.
 *  - 이 셋 말고(`: ping` 주석 포함)는 무시한다.
 */
export type CoachStreamOutcome<T> =
  | { kind: "done"; value: T }
  | { kind: "error"; status: number; detail: unknown }
  /** done/error 없이 끊겼다 — 같은 request_id 로 일반 호출로 다시 받는다. */
  | { kind: "dropped" };

export type ByteReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
};

export async function consumeCoachStream<T>(
  reader: ByteReader,
  onDelta: (text: string) => void,
): Promise<CoachStreamOutcome<T>> {
  let outcome: CoachStreamOutcome<T> | null = null;
  const parser = createSseParser((event) => {
    if (outcome) return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      // done 이 읽히지 않으면 끊긴 것으로 보고 일반 호출로 되받는다. delta 하나가 깨진 것은 넘어간다.
      if (event.event === "done") outcome = { kind: "dropped" };
      return;
    }
    if (event.event === "delta") {
      const text = (payload as { text?: unknown } | null)?.text;
      if (typeof text === "string" && text) onDelta(text);
    } else if (event.event === "done") {
      outcome =
        payload !== null && typeof payload === "object"
          ? { kind: "done", value: payload as T }
          : { kind: "dropped" };
    } else if (event.event === "error") {
      const body = (payload ?? {}) as { status?: unknown; detail?: unknown };
      outcome = {
        kind: "error",
        status: typeof body.status === "number" ? body.status : 500,
        detail: body.detail,
      };
    }
  });
  const decoder = new TextDecoder("utf-8");
  try {
    while (!outcome) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parser.push(decoder.decode(value, { stream: true }));
    }
    if (!outcome) {
      parser.push(decoder.decode());
      parser.end();
    }
  } catch {
    // 읽는 도중 끊김. 취소·시간 초과는 호출한 쪽이 signal 로 가려낸다.
  }
  return outcome ?? { kind: "dropped" };
}

/**
 * 스트림 시도가 실패했을 때 일반 호출로 되돌릴지(fallback) 그대로 던질지(throw).
 * 구버전 서버(404·405·501)·재시도 대상(처리 중 409·429)·연결 실패는 일반 호출이 같은 request_id 로 이어받는다.
 */
export function streamFailureAction(failure: {
  status: number;
  code?: string | null;
  network?: boolean;
}): "fallback" | "throw" {
  if (failure.network) return "fallback";
  if (failure.status === 404 || failure.status === 405 || failure.status === 501) return "fallback";
  if (failure.status === 429) return "fallback";
  if (failure.status === 409 && failure.code === "request is still processing") return "fallback";
  return "throw";
}
