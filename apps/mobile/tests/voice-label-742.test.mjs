import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { voiceLabel } from '../lib/reading/voices.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('reading.cast: 목소리는 「자동」 없이 성별과 이름으로 보인다(SOMA-742)', () => {
  assert.equal(voiceLabel('F5'), '여성 · 따뜻한 노년');
  assert.equal(voiceLabel('M1'), '남성 · 밝은 청년');
  assert.equal(voiceLabel(null), '-');
  const ko = src('locales/ko.ts');
  assert.doesNotMatch(ko, /voiceAutoChip|voiceAutoNow/);
  assert.match(ko, /voiceRecommended: '추천 목소리 \(\{\{voice\}\}\)'/);
  const roles = src('app/reading/roles.tsx');
  assert.match(roles, /voiceLabel\(isKnownPreset\(c\.voice_preset\) \? c\.voice_preset : assigned\[c\.id\]\)/);
  assert.match(roles, /t\('reading\.voiceRecommended', \{ voice: voiceLabel\(/);
});

test('tabs: iOS 하단 탭 바는 좌우 여백을 넓혀 폭을 줄인다(SOMA-742)', () => {
  // 탭바 모양은 공통 부품 components/ui/tab-bar 로 옮겼다(SOMA-770).
  const layout = src('components/ui/tab-bar.tsx');
  const ios = layout.slice(layout.indexOf('return IOS'), layout.indexOf('left: 0'));
  assert.match(ios, /left: 40,\s*right: 40,/);
});
