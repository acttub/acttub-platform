import assert from 'node:assert/strict';
import test from 'node:test';

const { finishedFromScripts, hasFinishedReading, markReadingFinished, setFirstReadingSession, isFirstReadingSession } = await import('../lib/reading/first-reading.ts');
const { setFirstUseOwner } = await import('../lib/practice/first-use-graduation.ts');

function memoryStore() {
  const map = new Map();
  return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => void map.set(k, v) };
}

test('첫 리딩 판단: 마지막 회차가 완료인 대본이 하나라도 있으면 끝까지 읽어 본 사람이다', () => {
  assert.equal(finishedFromScripts([]), false);
  assert.equal(finishedFromScripts([{ status: 'reading' }, { status: 'no_cast' }]), false);
  assert.equal(finishedFromScripts([{ status: 'reading' }, { status: 'completed' }]), true);
});

test('첫 리딩 판단: 이 기기 표시 → 서버 목록 순으로 보고, 서버에서 확인되면 표시를 남긴다', async () => {
  setFirstUseOwner('u1');
  const store = memoryStore();
  assert.equal(await hasFinishedReading(async () => ({ scripts: [{ status: 'reading' }] }), store), false);
  assert.equal(await hasFinishedReading(async () => ({ scripts: [{ status: 'completed' }] }), store), true);
  assert.equal(store.map.get('acttub.reading.finishedOnce.u1'), '1');
  // 표시가 있으면 서버를 묻지 않는다.
  assert.equal(await hasFinishedReading(async () => { throw new Error('should not call'); }, store), true);
});

test('첫 리딩 판단: 서버를 못 물으면 끝낸 사람으로 보고 기존 흐름을 쓴다', async () => {
  setFirstUseOwner('u2');
  assert.equal(await hasFinishedReading(async () => { throw new Error('offline'); }, memoryStore()), true);
});

test('첫 리딩: 끝까지 읽은 순간 계정별로 표시를 남긴다', async () => {
  setFirstUseOwner('u3');
  const store = memoryStore();
  await markReadingFinished(store);
  assert.equal(store.map.get('acttub.reading.finishedOnce.u3'), '1');
});

test('첫 리딩 회차는 배역 고르기에서 적은 그 회차만 맞다', () => {
  setFirstReadingSession('r1');
  assert.equal(isFirstReadingSession('r1'), true);
  assert.equal(isFirstReadingSession('r2'), false);
  assert.equal(isFirstReadingSession(null), false);
  setFirstReadingSession(null);
  assert.equal(isFirstReadingSession('r1'), false);
});
