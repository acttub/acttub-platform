import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechQueue } from '../lib/reading/tts/prefetch.ts';
import { isSpeechFileName, speechFileName, speechScriptFileName }
  from '../lib/reading/tts/speech-file.ts';

/**
 * 상대 대사를 미리 만들어 두는 큐 (SOMA-547).
 *
 * 만드는 일과 파일은 주입해서 onnxruntime 없이 돈다 — 여기서 보는 것은 순서와 취소와 재사용이다.
 */

/** 합성을 흉내낸다. 부를 때마다 해소 함수를 남겨 두어 순서를 직접 붙잡는다. */
function fakeSynth() {
  const calls = [];
  const synthesize = (text) =>
    new Promise((resolve, reject) => {
      calls.push({ text, resolve, reject });
    });
  return { calls, synthesize };
}

const options = { scriptId: 'script-1', locale: 'ko', preset: 'M1', variant: 'fp32', steps: 8, speed: 1 };

test('한 번에 한 줄씩, 준 순서대로 만든다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['첫 줄', '둘째 줄', '셋째 줄']);
  await Promise.resolve();

  // 동시에 여러 줄을 만들면 CPU 를 나눠 전부 느려진다.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '첫 줄');

  calls[0].resolve('file:///a.wav');
  await queue.settled();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text, '둘째 줄');
});

test('이미 만든 줄은 다시 만들지 않는다 — 처음부터·재연습이 저장본을 쓴다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['같은 줄']);
  await Promise.resolve();
  calls[0].resolve('file:///a.wav');
  await queue.settled();

  assert.equal(await queue.take('같은 줄'), 'file:///a.wav');

  queue.prime(['같은 줄']);
  await queue.settled();
  assert.equal(calls.length, 1, '두 번째 요청은 합성을 부르지 않는다');
});

test('아직 만드는 중인 줄을 달라고 하면 그 줄이 끝날 때까지 기다린다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['느린 줄']);
  await Promise.resolve();

  const waiting = queue.take('느린 줄');
  calls[0].resolve('file:///slow.wav');
  assert.equal(await waiting, 'file:///slow.wav');
});

test('건너뛰거나 처음부터 누르면 남은 순서를 다시 잡는다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['A', 'B', 'C']);
  await Promise.resolve();
  calls[0].resolve('file:///A.wav');
  await queue.settled();
  assert.equal(calls[1].text, 'B');

  // 사용자가 C 로 건너뛰었다 — 다음에 만들 것은 C 다.
  queue.prime(['C', 'D']);
  calls[1].resolve('file:///B.wav');
  await queue.settled();

  assert.equal(calls[2].text, 'C');
});

test('화면을 나가면 만들기를 멈추고 더 부르지 않는다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['A', 'B']);
  await Promise.resolve();
  queue.cancel();
  calls[0].resolve('file:///A.wav');
  await queue.settled();

  assert.equal(calls.length, 1, '멈춘 뒤에는 다음 줄을 만들지 않는다');
});

test('합성이 실패해도 큐가 멈추지 않고 다음 줄로 간다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['터지는 줄', '멀쩡한 줄']);
  await Promise.resolve();
  calls[0].reject(new Error('합성 실패'));
  await queue.settled();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].text, '멀쩡한 줄');
});

test('빈 줄은 만들지 않는다', async () => {
  const { calls, synthesize } = fakeSynth();
  const queue = createSpeechQueue({ synthesize, ...options });

  queue.prime(['', '   ', '진짜 줄']);
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '진짜 줄');
});

test('설정이 다르면 다른 음성이다 — 같은 글이어도 다시 만든다', async () => {
  const { calls, synthesize } = fakeSynth();
  const korean = createSpeechQueue({ synthesize, ...options });
  korean.prime(['Hello']);
  await Promise.resolve();
  calls[0].resolve('file:///ko.wav');
  await korean.settled();

  const english = createSpeechQueue({ synthesize, ...options, locale: 'en' });
  assert.equal(await english.take('Hello'), null, '다른 말로 만든 것은 쓰지 않는다');
});

test('새 파일 이름은 탈퇴 정리가 찾을 수 있고, 남의 파일은 아니다', () => {
  const made = speechScriptFileName('script-1', 'abc123');
  assert.equal(isSpeechFileName(made), true);
  // 예전 이름도 계속 찾는다 — 옛 빌드가 남긴 파일이 기기에 있다.
  assert.equal(isSpeechFileName(speechFileName(1758000000000)), true);

  for (const other of ['practice.mp4', 'reading.wav', 'reading-.wav', 'reading-abc.wav.txt', 'note.txt']) {
    assert.equal(isSpeechFileName(other), false, other);
  }
});

test('대본이 다르면 파일 이름도 다르다 — 대본을 지울 때 그 음성만 고를 수 있다', () => {
  const a = speechScriptFileName('script-1', 'samekey');
  const b = speechScriptFileName('script-2', 'samekey');
  assert.notEqual(a, b);
  assert.equal(isSpeechFileName(a) && isSpeechFileName(b), true);
});
