/**
 * 기기가 만드는 요청 id(UUID v4). 대본 등록·회차 시작이 같은 본문에 같은 id 를 다시 써
 * 재전송이 행을 둘 만들지 않게 한다(reading.script). 공용 멱등 계층(src/lib/api/v2/idempotency.ts)도
 * 같은 규칙으로 만들지만 그 함수는 그 모듈 안에 두므로 여기서 따로 만든다.
 */
export function newRequestId(): string {
  // crypto.randomUUID 는 보안 컨텍스트(HTTPS·localhost) 전용이라 http://<IP> 배포에서는
  // getRandomValues 기반 UUID v4 로 폴백한다.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
