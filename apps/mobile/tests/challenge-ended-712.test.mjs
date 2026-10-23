import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { canPerform, detailTitleKey } from '../lib/challenge/browse.ts';

const NOW = Date.parse('2026-10-15T12:00:00+09:00');
const ongoing = { ends_at: '2026-10-20T00:00:00+09:00', featured_on: null };
const ended = { ends_at: '2026-10-10T00:00:00+09:00', featured_on: null };

test('challenge: 종료된 챌린지에는 참여할 수 없다 — 서버도 422 challenge_closed 로 막는다(SOMA-712)', () => {
  assert.equal(canPerform(ongoing, NOW), true);
  assert.equal(canPerform(ended, NOW), false);
});

test('challenge: 상세 제목 — 오늘의 챌린지로 뽑힌 진행 중 챌린지만 「오늘의 챌린지」, 나머지는 「챌린지」', () => {
  assert.equal(detailTitleKey({ ...ongoing, featured_on: '2026-10-15' }, NOW), 'challenges.detailTitle');
  assert.equal(detailTitleKey(ongoing, NOW), 'challenges.title');
  assert.equal(detailTitleKey({ ...ended, featured_on: '2026-10-07' }, NOW), 'challenges.title');
  assert.equal(detailTitleKey(null, NOW), 'challenges.title');
});

test('challenge: 목록 카드·오늘의 챌린지 카드는 종료면 참여 버튼을 그리지 않고, 참여 동작도 종료면 촬영으로 가지 않는다', () => {
  const src = readFileSync(new URL('../app/(tabs)/challenges.tsx', import.meta.url), 'utf8');
  const performCtas = src.match(/canPerform\(challenge\) && \(\s*<Pressable[^>]*onPress=\{onPerform\}/g) ?? [];
  assert.equal(performCtas.length, 1, '줄 카드는 canPerform 으로 감싼다');
  assert.match(src, /canPerform\(featured\) && <PrimaryButton/, '이번 주 대사의 파란 버튼도 canPerform 으로 감싼다');
  const perform = src.slice(src.indexOf('const perform = (challenge: ChallengeCard)'), src.indexOf("pathname: '/record-video'"));
  assert.match(perform, /if \(!canPerform\(challenge\)\) return;/);
  for (const file of ['app/challenge-detail.tsx', 'app/challenge-play.tsx']) {
    const s = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const p = s.slice(s.indexOf('const perform = () => {'), s.indexOf("pathname: '/record-video'"));
    assert.match(p, /canPerform\(challenge\)/, file);
  }
  const detail = readFileSync(new URL('../app/challenge-detail.tsx', import.meta.url), 'utf8');
  assert.match(detail, /title: t\(detailTitleKey\(challenge\)\)/);
});
