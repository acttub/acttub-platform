import assert from 'node:assert/strict';
import test from 'node:test';

import { createSseParser, createUtf8StreamDecoder } from '../lib/sse.ts';

// 일부 Hermes 처럼 TextDecoder 가 없는 런타임의 직접 해석 경로를 잰다.
function fallbackDecoder() {
  const saved = globalThis.TextDecoder;
  delete globalThis.TextDecoder;
  try {
    return createUtf8StreamDecoder();
  } finally {
    globalThis.TextDecoder = saved;
  }
}

const bytes = text => [...new TextEncoder().encode(text)];

test('TextDecoder 없이도 1·2·3·4바이트 글자를 그대로 푼다', () => {
  const decoder = fallbackDecoder();
  assert.equal(decoder.decode(Uint8Array.from(bytes('a é 가 😀'))), 'a é 가 😀');
  assert.equal(decoder.flush(), '');
});

test('글자가 청크 경계에서 어디가 잘려도 다음 청크와 이어 한 글자로 낸다', () => {
  const text = '나는 갈매기 é😀';
  const all = bytes(text);
  for (let cut = 1; cut < all.length; cut += 1) {
    const decoder = fallbackDecoder();
    const out = decoder.decode(Uint8Array.from(all.slice(0, cut))) + decoder.decode(Uint8Array.from(all.slice(cut)));
    assert.equal(out, text, `cut at ${cut}`);
  }
});

test('한 바이트씩 와도 같은 글이 된다', () => {
  const decoder = fallbackDecoder();
  const out = bytes('한글 🎬').map(b => decoder.decode(Uint8Array.of(b))).join('');
  assert.equal(out, '한글 🎬');
});

test('끝에 덜 온 글자가 남은 채 흘려보내면 대체 문자 하나로 끝낸다', () => {
  const decoder = fallbackDecoder();
  assert.equal(decoder.decode(Uint8Array.from(bytes('가').slice(0, 2))), '');
  assert.equal(decoder.flush(), '\ufffd');
  assert.equal(decoder.flush(), '');
});

test('잘못된 바이트는 글자마다 대체 문자로 바꾸고 뒤 글자는 살린다', () => {
  const decoder = fallbackDecoder();
  const cases = [
    [[0x80, 0x41], '\ufffdA'],
    [[0xc0, 0x41], '\ufffdA'],
    [[0xc3, 0x41], '\ufffdA'],
    [[0xea, 0x41, 0x42], '\ufffdAB'],
    [[0xf0, 0x9f, 0x41, 0x42], '\ufffd\ufffdAB'],
    [[0xf5, 0x41], '\ufffdA'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(decoder.decode(Uint8Array.from(input)), expected, JSON.stringify(input));
  }
});

test('이어지는 바이트만 끝에 몰려 있으면 기다리지 않고 바로 대체 문자로 낸다', () => {
  const decoder = fallbackDecoder();
  assert.equal(decoder.decode(Uint8Array.of(0x80, 0x80, 0x80)), '\ufffd\ufffd\ufffd');
  assert.equal(decoder.flush(), '');
});

test('콜론 없는 줄은 값이 빈 필드다: data 만 있는 줄은 빈 데이터 한 줄', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.push('event: delta\ndata\ndata: 둘째\n\ndata\n\n');
  assert.deepEqual(events, [
    { event: 'delta', data: '\n둘째' },
    { event: 'message', data: '' },
  ]);
});
