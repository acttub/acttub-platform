/**
 * Server-Sent Events 해석기(순수). 청크가 줄 중간·이벤트 중간에서 끊겨도, CRLF·CR·LF 어느 줄바꿈이어도,
 * `: ping` 같은 주석 줄이 섞여도 같은 이벤트를 낸다. 네트워크·UI 의존이 없다.
 * (앱의 lib/sse.ts 와 같은 규칙이다. 두 앱은 코드를 공유하지 않아 따로 둔다.)
 */
export type SseEvent = { event: string; data: string };

export type SseParser = {
  /** 문자열 청크를 먹이고, 완성된 이벤트마다 onEvent 를 부른다. */
  push: (chunk: string) => void;
  /** 스트림이 끝났다. 빈 줄로 닫히지 않은 이벤트는 불완전하므로 버린다. */
  end: () => void;
};

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  let buffer = "";
  let started = false;
  let eventName = "";
  let dataLines: string[] = [];

  function dispatch() {
    if (dataLines.length > 0) {
      onEvent({ event: eventName || "message", data: dataLines.join("\n") });
    }
    eventName = "";
    dataLines = [];
  }

  function line(text: string) {
    if (text === "") return dispatch();
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  return {
    push(chunk) {
      if (!started) {
        started = true;
        if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      }
      buffer += chunk;
      let start = 0;
      let i = 0;
      while (i < buffer.length) {
        const ch = buffer[i];
        if (ch === "\n") {
          line(buffer.slice(start, i));
          start = i + 1;
        } else if (ch === "\r") {
          // 청크 끝의 \r 은 다음 청크의 \n 과 한 쌍일 수 있어 기다린다.
          if (i === buffer.length - 1) break;
          line(buffer.slice(start, i));
          start = buffer[i + 1] === "\n" ? i + 2 : i + 1;
          i = start - 1;
        }
        i += 1;
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer.endsWith("\r")) line(buffer.slice(0, -1));
      buffer = "";
      eventName = "";
      dataLines = [];
    },
  };
}
