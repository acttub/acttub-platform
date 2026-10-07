import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AUDIOEND_WAIT_MS, createRecordingTracker } from '../lib/reading/stt-recordings.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/** 가짜 시계 — setTimeout 을 손으로 흘린다. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); }
    },
  };
}

test('reading.recording: 떼어 낸 녹음은 audioend 가 오면 그 파일로 끝난다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  const uri = rec.detach();
  rec.audioEnd('file://line-1.wav');
  assert.equal(await uri, 'file://line-1.wav');
});

test('reading.recording: 떼어 낸 뒤 다음 줄을 시작해도 앞 줄 audioend 는 앞 줄 녹음으로 간다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  const first = rec.detach();
  rec.begin(true); // 내 대사가 연달아 — 다음 줄 듣기가 먼저 시작됐다
  rec.audioEnd('file://line-1.wav');
  assert.equal(await first, 'file://line-1.wav');
  rec.stopping();
  const second = rec.detach();
  rec.audioEnd('file://line-2.wav');
  assert.equal(await second, 'file://line-2.wav');
});

test('reading.recording: 떼어 낸 녹음은 화면 정리(discard)가 가져가지 못한다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  const uri = rec.detach();
  assert.equal(rec.discard(), null);
  rec.audioEnd('file://line-1.wav');
  assert.equal(await uri, 'file://line-1.wav');
});

test('reading.recording: audioend 가 안 오면 기다리다 놓는다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  const uri = rec.detach();
  timers.advance(AUDIOEND_WAIT_MS);
  assert.equal(await uri, null);
});

test('reading.recording: 이미 audioend 가 왔으면 바로 준다, persist 가 아니면 녹음이 없다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  rec.audioEnd('file://early.wav');
  assert.equal(await rec.detach(), 'file://early.wav');
  rec.begin(false);
  rec.stopping();
  assert.equal(await rec.detach(), null);
});

test('reading.session: 내 차례가 끝나면 녹음 마무리를 기다리지 않고 다음 줄로 넘긴다', () => {
  const play = read('app/reading/play.tsx');
  assert.doesNotMatch(play, /await stt\.takeRecordingAsync\(\)/);
  assert.match(play, /stt\.detachRecording\(\)/);
  const end = play.slice(play.indexOf('const endMyTurn'), play.indexOf('const endMyTurnRef'));
  assert.ok(end.indexOf('goNext(from)') > 0);
});

test('reading.session: 내 차례에 인식된 글자를 「방금 말한 것」으로 보인다', () => {
  const play = read('app/reading/play.tsx');
  assert.match(play, /onInterim: setSaid/);
  assert.match(play, /t\('reading\.saidLabel'\)/);
  assert.match(read('locales/ko.ts'), /saidLabel: '방금 말한 것'/);
  assert.match(read('locales/en.ts'), /saidLabel: 'What you just said'/);
});

test('reading.recording: 기다리다 놓은 줄의 audioend 가 늦게 와도 다음 줄 녹음에 붙지 않는다', async () => {
  const timers = fakeTimers();
  const rec = createRecordingTracker(timers);
  rec.begin(true);
  rec.stopping();
  const first = rec.detach();
  timers.advance(AUDIOEND_WAIT_MS);
  assert.equal(await first, null);
  rec.begin(true);
  rec.audioEnd('file://late-line-1.wav');
  rec.stopping();
  const second = rec.detach();
  rec.audioEnd('file://line-2.wav');
  assert.equal(await second, 'file://line-2.wav');
});
