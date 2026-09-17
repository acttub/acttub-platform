import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseScript,
  detectRoles,
  speakableText,
  countLinesByRole,
} from '../lib/reading/parse.ts';
import { SAMPLE_SCRIPT } from '../lib/reading/sample.ts';

test('예시 대본에서 제목·배역·대사를 인식한다', () => {
  const p = parseScript(SAMPLE_SCRIPT);
  assert.equal(p.title, '옥상, 밤');
  assert.deepEqual(p.roles, ['윤서', '태오']);
  assert.equal(p.lines.length, 17);
  assert.equal(p.lines[0].type, 'direction');
  assert.deepEqual(p.lines[1], { type: 'dialogue', role: '윤서', text: '여기 있을 줄 알았어.' });
});

test('배역별 대사 수를 센다', () => {
  const p = parseScript(SAMPLE_SCRIPT);
  const counts = countLinesByRole(p.lines);
  assert.equal(counts.get('윤서'), 8);
  assert.equal(counts.get('태오'), 7);
});

test('detectRoles가 두 배역을 찾는다', () => {
  const roles = detectRoles(SAMPLE_SCRIPT);
  assert.ok(roles.includes('윤서'));
  assert.ok(roles.includes('태오'));
});

test('speakableText가 지문(괄호)을 빼서 읽을 문장만 남긴다', () => {
  assert.equal(speakableText('(웃으며) 그런가.'), '그런가.');
  assert.equal(speakableText('말하면 뭐가 달라져.'), '말하면 뭐가 달라져.');
});

test('excludeRoles로 뺀 배역의 줄은 지문으로 내려간다', () => {
  const p = parseScript(SAMPLE_SCRIPT, { excludeRoles: ['태오'] });
  assert.ok(!p.roles.includes('태오'));
  assert.ok(p.roles.includes('윤서'));
  assert.ok(p.lines.every((l) => !(l.type === 'dialogue' && l.role === '태오')));
});

test('빈 입력은 배역·대사 없이 안전하게 처리한다', () => {
  const p = parseScript('');
  assert.deepEqual(p.roles, []);
  assert.equal(p.lines.length, 0);
});
