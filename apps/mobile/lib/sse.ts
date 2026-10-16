/**
 * Server-Sent Events 해석기(순수). 청크가 줄 중간·이벤트 중간에서 끊겨도, CRLF·CR·LF 어느 줄바꿈이어도,
 * `: ping` 같은 주석 줄이 섞여도 같은 이벤트를 낸다. 네트워크·UI 의존이 없다.
 */
export type SseEvent = { event: string; data: string };

export type SseParser = {
  /** 문자열 청크를 먹이고, 완성된 이벤트마다 onEvent 를 부른다. */
  push: (chunk: string) => void;
  /** 스트림이 끝났다. 빈 줄로 닫히지 않은 이벤트는 불완전하므로 버린다. */
  end: () => void;
};

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  let buffer = '';
  let started = false;
  let eventName = '';
  let dataLines: string[] = [];

  function dispatch() {
    if (dataLines.length > 0) {
      onEvent({ event: eventName || 'message', data: dataLines.join('\n') });
    }
    eventName = '';
    dataLines = [];
  }

  function line(text: string) {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
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
        if (ch === '\n') {
          line(buffer.slice(start, i));
          start = i + 1;
        } else if (ch === '\r') {
          // 청크 끝의 \r 은 다음 청크의 \n 과 한 쌍일 수 있어 기다린다.
          if (i === buffer.length - 1) break;
          line(buffer.slice(start, i));
          start = buffer[i + 1] === '\n' ? i + 2 : i + 1;
          i = start - 1;
        }
        i += 1;
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer.endsWith('\r')) line(buffer.slice(0, -1));
      buffer = '';
      eventName = '';
      dataLines = [];
    },
  };
}

/**
 * UTF-8 바이트 청크를 글자로 바꾼다. 한 글자(한글 3바이트)가 청크 경계에서 잘려도 깨뜨리지 않는다.
 * TextDecoder 가 있으면 그것을, 없는 런타임(일부 Hermes)에서는 직접 해석한다.
 */
export function createUtf8StreamDecoder(): { decode: (bytes: Uint8Array) => string; flush: () => string } {
  if (typeof TextDecoder !== 'undefined') {
    const decoder = new TextDecoder('utf-8');
    return {
      decode: (bytes) => decoder.decode(bytes, { stream: true }),
      flush: () => decoder.decode(),
    };
  }
  let pending: number[] = [];
  return {
    decode(bytes) {
      const all = pending.length ? [...pending, ...bytes] : bytes;
      let end = all.length;
      // 끝에서 아직 덜 온 다바이트 글자를 떼어 둔다.
      for (let back = 1; back <= Math.min(3, all.length); back += 1) {
        const b = all[all.length - back];
        if ((b & 0xc0) === 0x80) continue;
        const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
        if (need > back) end = all.length - back;
        break;
      }
      pending = Array.from(all.slice(end));
      return decodeUtf8(all.slice(0, end));
    },
    flush() {
      const rest = pending;
      pending = [];
      return rest.length ? '\ufffd' : '';
    },
  };
}

function decodeUtf8(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp = 0xfffd;
    let len = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && (bytes[i + 1] & 0xc0) === 0x80) {
      len = 2;
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
    } else if (b >= 0xe0 && b < 0xf0 && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) {
      len = 3;
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
    } else if (b >= 0xf0 && b < 0xf5 && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80 && (bytes[i + 3] & 0xc0) === 0x80) {
      len = 4;
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}
