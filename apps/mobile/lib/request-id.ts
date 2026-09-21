/** 기기가 만드는 요청 id(UUID v4 꼴). 같은 요청의 재전송이 같은 값을 쓰게 한 번 만들어 들고 있는다. */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const part = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${part()}${part()}-${part()}-4${part().slice(1)}-${part()}-${part()}${part()}${part()}`;
}
