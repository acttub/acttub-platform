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

// ─── reading.script: 장면 줄(kind scene) ──────────────────────────────────────

const kinds = (lines) => lines.map((l) => l.type);

test('reading.script: "제1막"과 "S#2" 줄은 kind가 scene이고 배역이 없다', () => {
  const p = parseScript(`제1막

윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.

S#2

윤서: 다음 거 언제야.
태오: 모레.`);
  assert.deepEqual(p.roles, ['윤서', '태오']);
  assert.deepEqual(kinds(p.lines), ['scene', 'dialogue', 'dialogue', 'scene', 'dialogue', 'dialogue']);
  assert.deepEqual(p.lines[0], { type: 'scene', text: '제1막' });
  assert.deepEqual(p.lines[3], { type: 'scene', text: 'S#2' });
  assert.ok(p.lines.every((l) => l.type !== 'scene' || !('role' in l)));
});

test('reading.script: 장면 줄은 앞 대사에 이어 붙지 않고 뒤 대사도 삼키지 않는다', () => {
  const p = parseScript(`윤서: 여기 있을 줄 알았어.
1막
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.`);
  assert.deepEqual(kinds(p.lines), ['dialogue', 'scene', 'dialogue', 'dialogue', 'dialogue']);
  assert.equal(p.lines[0].text, '여기 있을 줄 알았어.');
  assert.equal(p.lines[1].text, '1막');
});

test('reading.script: 영어 막·장 머리("Act 1", "ACT ONE, SCENE 2")와 S# 장면 이름도 장면 줄이다', () => {
  const p = parseScript(`Act 1

ANNA: I knew you'd be here.
BEN: How did you know?

ACT ONE, SCENE 2

ANNA: When is the next one?
BEN: Tomorrow.

S#3. 거실 (낮)

ANNA: Fine.
BEN: Fine.`);
  assert.deepEqual(p.roles, ['ANNA', 'BEN']);
  const scenes = p.lines.filter((l) => l.type === 'scene').map((l) => l.text);
  assert.deepEqual(scenes, ['Act 1', 'ACT ONE, SCENE 2', 'S#3. 거실 (낮)']);
});

test('reading.script: 한글 파일의 "[장] 제1장"은 장면 줄이고, 괄호로 감싼 "[2막]"과 괄호 지문은 지문이다(웹과 같은 규칙)', () => {
  const p = parseScript(`[장] 제1장
윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
[2막]
(사이. 태오가 난간에 기댄다.)
윤서: 다음 거 언제야.
태오: 모레.`);
  assert.deepEqual(kinds(p.lines), ['scene', 'dialogue', 'dialogue', 'direction', 'direction', 'dialogue', 'dialogue']);
  assert.equal(p.lines[0].text, '제1장');
  assert.equal(p.lines[3].text, '2막');
  assert.equal(p.lines[4].text, '사이. 태오가 난간에 기댄다.');
});

test('reading.script: 첫 줄이 장면 줄이면 제목이 아니다', () => {
  const p = parseScript(`1막

윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.`);
  assert.equal(p.title, undefined);
  assert.equal(p.lines[0].type, 'scene');
});

test('reading.script: "1막 끝"처럼 막 표시 뒤에 구분 없이 말이 이어지면 장면 줄이 아니다', () => {
  const p = parseScript(`윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.
1막 끝`);
  assert.deepEqual(kinds(p.lines), ['dialogue', 'dialogue', 'dialogue', 'dialogue']);
  assert.equal(p.lines[3].text, '그런가. 1막 끝');
});

test('reading.script: 장면 줄이 있어도 배역별 대사 수는 대사 줄만 센다', () => {
  const p = parseScript(`제1막
윤서: 하나.
태오: 둘.
제2막
윤서: 셋.
태오: 넷.
윤서: 다섯.`);
  const counts = countLinesByRole(p.lines);
  assert.equal(counts.get('윤서'), 3);
  assert.equal(counts.get('태오'), 2);
  assert.equal(p.lines.filter((l) => l.type === 'scene').length, 2);
});
