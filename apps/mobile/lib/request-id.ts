/** 기기가 만드는 요청 id(UUID v4 꼴). 같은 요청의 재전송이 같은 값을 쓰게 한 번 만들어 들고 있는다. */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const part = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${part()}${part()}-${part()}-4${part().slice(1)}-${part()}-${part()}${part()}${part()}`;
}

/** 한 번의 시도 — 보낸 요청 id 와 그때 본문의 지문. */
export type RequestAttempt = { requestId: string; fingerprint: string };

/**
 * 이번 시도에 쓸 요청 id. 같은 본문을 다시 보내면(이중 탭·재시도) 같은 id 라 서버에 하나만 생기고,
 * 본문을 고쳐 보내면 새 id 다 — 같은 id 에 다른 본문은 422 request_fingerprint_mismatch 다.
 */
export function attemptFor(
  previous: RequestAttempt | null,
  fingerprint: string,
  makeId: () => string,
): RequestAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { requestId: makeId(), fingerprint };
}
