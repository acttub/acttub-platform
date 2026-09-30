import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatClipDuration } from '../lib/archive-format.ts';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// 촬영 화면 타이머가 쓰던 mmss 를 formatClipDuration 으로 합쳤다 — 분은 채우지 않고 초만 두 자리다.
test('formatClipDuration: 분은 채우지 않고 초만 두 자리로 채운다', () => {
  assert.equal(formatClipDuration(0), '0:00');
  assert.equal(formatClipDuration(5), '0:05');
  assert.equal(formatClipDuration(60), '1:00');
  assert.equal(formatClipDuration(65), '1:05');
  assert.equal(formatClipDuration(300), '5:00');
});

// 리액트 네이티브에는 x·y 스타일이 없어 조용히 무시된다 — 전체 덮개가 x·y 로 자리를 잡으면 구석에 겹쳐 그려진다(실기기).
test('스포트라이트: 아직 못 잰 자리의 전체 덮개는 left·top 으로 자리를 잡는다', () => {
  const guide = read('components/spotlight-guide.tsx');
  assert.match(guide, /<View style=\{\[styles\.shroud, \{ left: 0, top: 0, width: screen\.width, height: screen\.height \}\]\} \/>/);
});
