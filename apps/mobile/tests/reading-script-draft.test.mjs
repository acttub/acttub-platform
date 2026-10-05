import assert from 'node:assert/strict';
import test from 'node:test';

import { SCRIPT_LIMITS, createDraft, validateDraft } from '../lib/reading/script-draft.ts';
import { SAMPLE_SCRIPT } from '../lib/reading/sample.ts';

const RID = '11111111-2222-4333-8444-555555555555';

/** 저장 본문. 검사를 통과하지 못하면 그 코드로 던진다. */
function draftToCreateBody(draft) {
  const result = validateDraft(draft);
  if (!result.ok) throw new Error(result.code);
  return result.body;
}

const COLON = `옥상, 밤

(옥상 난간. 바람 소리.)

윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.
제2막
윤서: 다음 거 언제야.
태오: 모레.`;

test('reading.script: 콜론 형식 대본의 저장 본문 — 원문·배역·줄을 싣고 지문 줄의 character_index는 null이다', () => {
  const draft = createDraft(COLON, 'paste', RID);
  const body = draftToCreateBody(draft);

  assert.equal(body.request_id, RID);
  assert.equal(body.source, 'paste');
  assert.equal(body.raw_text, COLON, '원문을 그대로 싣는다');
  assert.equal(body.title, '옥상, 밤');
  assert.deepEqual(body.characters, [{ name: '윤서' }, { name: '태오' }]);
  assert.equal(body.lines.length, 8);
  assert.deepEqual(body.lines.map((l) => l.ordinal), body.lines.map((_, i) => i + 1), 'ordinal은 1부터 줄 순서');
  assert.deepEqual(body.lines[0], { ordinal: 1, kind: 'direction', character_index: null, text: '옥상 난간. 바람 소리.' });
  assert.deepEqual(body.lines[1], { ordinal: 2, kind: 'dialogue', character_index: 0, text: '여기 있을 줄 알았어.' });
  assert.deepEqual(body.lines[2], { ordinal: 3, kind: 'dialogue', character_index: 1, text: '어떻게 알았어.' });
  const scene = body.lines.find((l) => l.kind === 'scene');
  assert.deepEqual(scene, { ordinal: 6, kind: 'scene', character_index: null, text: '제2막' });
});

test('reading.script: 배역이 하나도 없으면 저장하지 않는다(no_characters)', () => {
  const draft = createDraft('그냥 산문이다.\n배역이 없다.', 'typed', RID);
  assert.deepEqual(validateDraft(draft), { ok: false, code: 'no_characters' });
  assert.throws(() => draftToCreateBody(draft), /no_characters/);
});

test('reading.script: 원문 100,000자는 되고 100,001자는 script_too_long이다(기기 사전 검사)', () => {
  const head = '윤서: 안녕.\n태오: 응.\n윤서: 가자.\n태오: 응.\n';
  const pad = '\n(' + '가'.repeat(SCRIPT_LIMITS.rawTextMax - [...head].length - 3) + ')';
  const exact = head + pad;
  assert.equal([...exact].length, SCRIPT_LIMITS.rawTextMax);
  assert.equal(validateDraft(createDraft(exact, 'paste', RID)).ok, true);
  assert.deepEqual(validateDraft(createDraft(exact + '가', 'paste', RID)), { ok: false, code: 'script_too_long' });
});

test('reading.script: 줄 3,001개 또는 배역 51개면 script_too_long이다', () => {
  const manyLines = Array.from({ length: 3001 }, (_, i) => (i % 2 ? '태오: 응.' : '윤서: 안녕.')).join('\n');
  assert.deepEqual(validateDraft(createDraft(manyLines, 'paste', RID)), { ok: false, code: 'script_too_long' });
  const manyRoles = Array.from({ length: 51 }, (_, i) => `배역${i + 1}: 하나.\n배역${i + 1}: 둘.`).join('\n');
  assert.deepEqual(validateDraft(createDraft(manyRoles, 'paste', RID)), { ok: false, code: 'script_too_long' });
});

test('reading.script: 예시 대본을 불러와 저장하면 보통 대본이고 입력 경로만 sample이다', () => {
  const body = draftToCreateBody(createDraft(SAMPLE_SCRIPT, 'sample', RID));
  assert.equal(body.source, 'sample');
  assert.equal(body.title, '옥상, 밤');
  assert.equal(body.raw_text, SAMPLE_SCRIPT);
  assert.equal(body.characters.length, 2);
});

test('reading.script: 제목은 파서가 뽑은 첫 줄이고, 없으면 "제목 없는 대본"이다', () => {
  assert.equal(draftToCreateBody(createDraft(COLON, 'paste', RID)).title, '옥상, 밤');
  assert.equal(draftToCreateBody(createDraft('윤서: 안녕.\n태오: 응.\n윤서: 가자.\n태오: 응.', 'typed', RID)).title, '제목 없는 대본');
});

test('reading.script: 등장인물 목록이 없으면 배역은 대사 많은 순, 같으면 먼저 나온 순으로 저장한다', () => {
  const raw = `소린: 안녕.
니나: 하나.
트레플레프: 하나.
니나: 둘.
트레플레프: 둘.
니나: 셋.
소린: 잘 가.`;
  const body = draftToCreateBody(createDraft(raw, 'paste', RID));
  assert.deepEqual(body.characters, [{ name: '니나' }, { name: '소린' }, { name: '트레플레프' }]);
  assert.deepEqual(
    body.lines.map((l) => l.character_index),
    [1, 0, 2, 0, 2, 0, 1],
    '줄의 배역 연결은 저장 순서의 번호를 따른다',
  );
});

test('reading.script: 등장인물 목록이 있으면 그 순서로 저장하고, 목록에 없는 배역은 뒤에 대사 많은 순이다', () => {
  const raw = `등장인물
1. 노라 ------ 헬머의 아내
2. 헬머 ------ 변호사
3. 로다 박사

헬머: 노라, 이리 와 봐.
헬머: 어서.
박사: 실례합니다.
헬머: 어서 오세요.
노라: 앉으세요, 박사님.
박사: 고맙습니다.`;
  const body = draftToCreateBody(createDraft(raw, 'paste', RID));
  assert.deepEqual(body.characters, [{ name: '노라' }, { name: '헬머' }, { name: '박사' }]);

  // 목록에 없어도 대사가 아주 많으면(8줄 이상) 배역이다 — 그런 배역은 목록 뒤에 대사 많은 순으로.
  const offList = (name, n) => Array.from({ length: n }, (_, i) => `${name}: ${i + 1}.`).join('\n');
  const withExtra = `${raw}\n${offList('키니', 8)}\n${offList('봅', 9)}`;
  assert.deepEqual(
    draftToCreateBody(createDraft(withExtra, 'paste', RID)).characters,
    [{ name: '노라' }, { name: '헬머' }, { name: '박사' }, { name: '봅' }, { name: '키니' }],
  );
});
