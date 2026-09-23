import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseScript } from '../lib/reading/parse.ts';

/**
 * reading.script 공통 검증 자료 — 같은 대본 샘플을 웹·앱 파서에 넣으면 배역·줄 종류·줄 수가 같다.
 * 정본은 웹 갈래의 `apps/web/tests/reading/fixtures/`이고, 그 폴더가 있으면 그쪽 자료도 함께 읽는다.
 * 없으면 앱이 먼저 만든 `tests/fixtures/reading/`만 본다.
 */
const here = dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = join(here, 'fixtures', 'reading');
const WEB_DIR = join(here, '..', '..', 'web', 'tests', 'reading', 'fixtures');

function expectedPathFor(dir, txt) {
  const base = txt.replace(/\.txt$/, '');
  for (const candidate of [`${base}.expected.json`, `${base}.json`]) {
    if (existsSync(join(dir, candidate))) return join(dir, candidate);
  }
  return null;
}

/** 웹 자료가 키 이름을 조금 다르게 써도(type/kind, character/role) 같은 뜻으로 읽는다. */
function normalizeExpectedLine(line) {
  const kind = line.kind ?? line.type;
  const role = line.role ?? line.character ?? line.name;
  return kind === 'dialogue' ? { kind, role, text: line.text } : { kind, text: line.text };
}

function actualLine(line) {
  return line.type === 'dialogue'
    ? { kind: 'dialogue', role: line.role, text: line.text }
    : { kind: line.type, text: line.text };
}

function fixturesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => ({ dir, name, expectedPath: expectedPathFor(dir, name) }))
    .filter((f) => f.expectedPath !== null);
}

const suites = [
  { label: '앱', fixtures: fixturesIn(LOCAL_DIR) },
  { label: '웹', fixtures: fixturesIn(WEB_DIR) },
];

test('reading.script: 앱 쪽 공통 검증 자료가 있다', () => {
  assert.ok(suites[0].fixtures.length >= 8, '샘플이 여덟 편 이상이어야 한다');
});

for (const suite of suites) {
  for (const fixture of suite.fixtures) {
    test(`reading.script: 공통 검증 자료(${suite.label}) ${fixture.name} — 배역·줄 종류·줄 수가 기대 결과와 같다`, () => {
      const raw = readFileSync(join(fixture.dir, fixture.name), 'utf8');
      const expected = JSON.parse(readFileSync(fixture.expectedPath, 'utf8'));
      const actual = parseScript(raw);

      assert.equal(actual.title ?? null, expected.title ?? null, '제목');
      assert.deepEqual(actual.roles, expected.roles, '배역');
      assert.equal(actual.lines.length, expected.lines.length, '줄 수');
      assert.deepEqual(actual.lines.map(actualLine), expected.lines.map(normalizeExpectedLine), '줄');
    });
  }
}

// ─── 검증 방법의 규칙이 자료에 담겨 있는지 ────────────────────────────────────

function local(name) {
  const raw = readFileSync(join(LOCAL_DIR, name), 'utf8');
  return parseScript(raw);
}

test('reading.script: 등장인물 목록이 있는 대본에서 목록 밖 이름이 7줄이면 배역이 아니다', () => {
  const p = local('07-cast-list-offlist-7.txt');
  assert.ok(!p.roles.includes('소린'));
  assert.equal(p.lines.filter((l) => l.type === 'direction').length, 7, '그 이름의 줄은 지문이다');
});

test('reading.script: 목록 밖 이름이 8줄이지만 전체 발화의 0.9%면 배역이 아니다', () => {
  const p = local('09-cast-list-offlist-8-under-1pct.txt');
  assert.ok(!p.roles.includes('소린'));
  assert.equal(p.lines.filter((l) => l.type === 'dialogue').length, 892);
});

test('reading.script: 목록 밖 이름이 8줄이고 전체 발화의 1% 이상이면 배역이다', () => {
  const p = local('08-cast-list-offlist-8.txt');
  assert.ok(p.roles.includes('소린'));
});

test('reading.script: 블록 형식·공백 형식과 제목 조건(첫 줄 30자 이하 + 빈 줄)이 자료로 고정돼 있다', () => {
  assert.equal(local('02-block-format.txt').title, '첫 만남');
  assert.deepEqual(local('03-space-format.txt').roles, ['강호', '미영']);
  assert.equal(local('04-title-too-long.txt').title, undefined);
});

test('reading.script: "제1막"과 "S#2" 줄은 kind가 scene이고 배역이 없다(공통 자료)', () => {
  const p = local('05-scene-marks.txt');
  const scenes = p.lines.filter((l) => l.type === 'scene');
  assert.deepEqual(scenes.map((l) => l.text), ['제1막', 'S#2', '1막 2장', '제3장']);
  assert.ok(scenes.every((l) => !('role' in l)));
});
