import assert from 'node:assert/strict';
import test from 'node:test';

import { createDownloadProgress, formatDownloadProgress } from '../lib/reading/tts/download-progress.ts';

const MB = 1024 * 1024;
const files = [
  { id: 'a', bytes: 100 * MB },
  { id: 'b', bytes: 280 * MB },
];

function clock(start = 0) {
  let now = start;
  return { now: () => now, tick: (ms) => { now += ms; } };
}

test('다운로드 진행: 파일별 진행을 합쳐 전체 받은 양·전체 크기·퍼센트를 낸다', () => {
  const c = clock();
  const p = createDownloadProgress(files, { now: c.now });
  p.update('a', 0);
  c.tick(1000);
  p.update('a', 50 * MB);
  const s = p.snapshot();
  assert.equal(s.totalBytes, 380 * MB);
  assert.equal(s.receivedBytes, 50 * MB);
  assert.equal(s.percent, 13);
});

test('다운로드 진행: 이미 받아 둔 파일은 완료로 치지만 속도 계산에는 넣지 않는다', () => {
  const c = clock();
  const p = createDownloadProgress(files, { now: c.now });
  p.complete('a');
  p.update('b', 0);
  c.tick(2000);
  p.update('b', 20 * MB);
  const s = p.snapshot();
  assert.equal(s.receivedBytes, 120 * MB);
  // 초당 10MB — 남은 260MB는 26초
  assert.equal(s.etaSeconds, 26);
});

test('다운로드 진행: 이어받기의 첫 보고(이미 있던 바이트)는 속도로 치지 않는다', () => {
  const c = clock();
  const p = createDownloadProgress(files, { now: c.now });
  p.update('b', 200 * MB); // 이어받기 첫 이벤트 — 오프셋 포함
  c.tick(1000);
  p.update('b', 205 * MB);
  c.tick(1000);
  p.update('b', 210 * MB);
  const s = p.snapshot();
  assert.equal(s.receivedBytes, 210 * MB);
  // 초당 5MB — 남은 170MB(a 100 + b 70)는 34초
  assert.equal(s.etaSeconds, 34);
});

test('다운로드 진행: 표본이 모자라면 남은 시간을 모른다(null)', () => {
  const c = clock();
  const p = createDownloadProgress(files, { now: c.now });
  assert.equal(p.snapshot().etaSeconds, null);
  p.update('a', 0);
  c.tick(200);
  p.update('a', 1 * MB);
  assert.equal(p.snapshot().etaSeconds, null);
});

test('다운로드 진행: 속도는 최근 구간의 이동 평균이라 오래된 빠른 구간을 잊는다', () => {
  const c = clock();
  const p = createDownloadProgress([{ id: 'a', bytes: 1000 * MB }], { now: c.now, windowMs: 5000 });
  p.update('a', 0);
  for (let i = 0; i < 5; i++) { c.tick(1000); p.update('a', (i + 1) * 50 * MB); } // 50MB/s
  const fast = p.snapshot().etaSeconds;
  for (let i = 0; i < 10; i++) { c.tick(1000); p.update('a', 250 * MB + (i + 1) * 5 * MB); } // 5MB/s
  const slow = p.snapshot().etaSeconds;
  assert.ok(fast < 20, `fast=${fast}`);
  // 남은 700MB / 5MB/s = 140초
  assert.equal(slow, 140);
});

test('다운로드 진행: 다시 받느라 줄어든 값도 반영하고 크기를 넘지 않는다', () => {
  const c = clock();
  const p = createDownloadProgress(files, { now: c.now });
  p.update('a', 90 * MB);
  p.reset('a');
  assert.equal(p.snapshot().receivedBytes, 0);
  p.update('a', 999 * MB);
  assert.equal(p.snapshot().receivedBytes, 100 * MB);
  assert.equal(p.snapshot().percent, 26);
});

test('다운로드 진행: 모르는 파일 id는 무시한다', () => {
  const p = createDownloadProgress(files, { now: () => 0 });
  p.update('zzz', 5);
  assert.equal(p.snapshot().receivedBytes, 0);
});

const tr = (key, params = {}) => {
  const table = {
    'reading.downloadEtaMinutes': '약 {{count}}분 남음',
    'reading.downloadEtaSoon': '곧 끝나요',
  };
  return (table[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k]));
};

test('다운로드 문구: "142 / 380MB · 약 2분 남음"', () => {
  const line = formatDownloadProgress({ receivedBytes: 142 * MB, totalBytes: 380 * MB, percent: 37, etaSeconds: 95 }, tr);
  assert.equal(line, '142 / 380MB · 약 2분 남음');
});

test('다운로드 문구: 남은 시간을 모르면 크기만, 1분 안이면 곧 끝나요', () => {
  assert.equal(formatDownloadProgress({ receivedBytes: 0, totalBytes: 380 * MB, percent: 0, etaSeconds: null }, tr), '0 / 380MB');
  assert.equal(formatDownloadProgress({ receivedBytes: 370 * MB, totalBytes: 380 * MB, percent: 97, etaSeconds: 40 }, tr), '370 / 380MB · 곧 끝나요');
});

test('다운로드 문구: 받은 양은 내림이라 끝나기 전엔 전체와 같아 보이지 않는다', () => {
  const line = formatDownloadProgress({ receivedBytes: 380 * MB - 1, totalBytes: 380 * MB, percent: 99, etaSeconds: null }, tr);
  assert.equal(line, '379 / 380MB');
});
