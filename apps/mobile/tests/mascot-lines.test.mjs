import assert from 'node:assert/strict';
import test from 'node:test';

import { mascotCandidates, mascotLine } from '../lib/mascot-lines.ts';

// 홈 캐릭터 말풍선이 가끔 바뀐다 (SOMA-494). 같은 날·같은 탭 수면 같은 말, 탭하면 다음 말.
const base = { hour: 14, dayIndex: 0, streak: 0, taps: 0 };

test('기본 문구에 시간대 문구가 더해진다 — 아침·밤이 다르다', () => {
  const morning = mascotCandidates({ ...base, hour: 8 });
  const night = mascotCandidates({ ...base, hour: 23 });
  const noon = mascotCandidates(base);
  assert.ok(morning.length > noon.length);
  assert.ok(night.length > noon.length);
  assert.notDeepEqual(morning, night);
});

test('연속 2일부터는 연속일 문구가 맨 앞에 들어간다', () => {
  assert.doesNotMatch(mascotCandidates({ ...base, streak: 1 }).join('|'), /연속/);
  assert.match(mascotCandidates({ ...base, streak: 4 })[0], /연속 4일째/);
});

test('날이 바뀌거나 탭하면 다른 말이 나오고, 한 바퀴 돌면 처음으로 돌아온다', () => {
  const n = mascotCandidates(base).length;
  assert.ok(n >= 3);
  assert.notEqual(mascotLine(base), mascotLine({ ...base, dayIndex: 1 }));
  assert.notEqual(mascotLine(base), mascotLine({ ...base, taps: 1 }));
  assert.equal(mascotLine(base), mascotLine({ ...base, taps: n }));
});
