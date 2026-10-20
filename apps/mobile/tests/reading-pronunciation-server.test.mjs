import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { pronunciationServerUrl, scorePronunciation } from '../lib/reading/pronunciation-server.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  delete process.env.EXPO_PUBLIC_PRON_URL;
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

function serve(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return response;
  };
  return calls;
}

test('채점 서버 주소가 없으면 꺼져 있고 아무것도 보내지 않는다', async () => {
  const calls = serve({ ok: true, json: async () => ({ notes: [] }) });

  assert.equal(pronunciationServerUrl(), null);
  assert.deepEqual(await scorePronunciation({ uri: 'file:///a.wav', contentType: 'audio/wav', text: '가' }), []);
  assert.deepEqual(calls, []);
});

test('줄 녹음과 대본 글을 보내 형식이 맞는 어절 결과만 돌려준다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test/';
  const calls = serve({
    ok: true,
    json: async () => ({ notes: [{ word: '왔구나', phones: [{ expected: 'ㅘ', heard: 'ㅏ' }] }, { word: 3, phones: [] }, null, { word: '응' }] }),
  });

  assert.equal(pronunciationServerUrl(), 'http://pron.test');
  const notes = await scorePronunciation({ uri: 'file:///a.wav', contentType: 'audio/wav', text: '오늘 왔구나.' });

  assert.deepEqual(notes, [{ word: '왔구나', phones: [{ expected: 'ㅘ', heard: 'ㅏ' }] }]);
  const [url, init] = calls[0];
  assert.equal(url, 'http://pron.test/score');
  assert.equal(init.method, 'POST');
  assert.equal(init.body.get('text'), '오늘 왔구나.');
});

test('m4a 녹음은 m4a 이름으로 보낸다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test';
  const appended = [];
  const RealFormData = globalThis.FormData;
  globalThis.FormData = class {
    append(name, value) {
      appended.push([name, value]);
    }
  };
  serve({ ok: true, json: async () => ({}) });
  try {
    assert.deepEqual(await scorePronunciation({ uri: 'file:///a.m4a', contentType: 'audio/mp4', text: '가' }), []);
  } finally {
    globalThis.FormData = RealFormData;
  }
  assert.deepEqual(appended[0], ['audio', { uri: 'file:///a.m4a', name: 'line.m4a', type: 'audio/mp4' }]);
});

test('서버가 실패로 답하면 빈 결과다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test';
  serve({ ok: false, json: async () => ({ notes: [{ word: '가', phones: [] }] }) });

  assert.deepEqual(await scorePronunciation({ uri: 'file:///a.wav', contentType: 'audio/wav', text: '가' }), []);
});

test('20초 안에 답이 없으면 요청을 끊는다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test';
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));

  const scoring = scorePronunciation({ uri: 'file:///a.wav', contentType: 'audio/wav', text: '가' });
  mock.timers.tick(20_000);
  await assert.rejects(scoring, /aborted/);
});
