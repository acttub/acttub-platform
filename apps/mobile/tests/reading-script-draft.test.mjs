import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCRIPT_LIMITS,
  addDraftCharacter,
  createDraft,
  draftCharacters,
  draftSummary,
  draftToCreateBody,
  removeDraftCharacter,
  renameDraftCharacter,
  setDraftTitle,
  validateDraft,
} from '../lib/reading/script-draft.ts';
import { SAMPLE_SCRIPT } from '../lib/reading/sample.ts';

const RID = '11111111-2222-4333-8444-555555555555';

const COLON = `옥상, 밤

(옥상 난간. 바람 소리.)

윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.
제2막
윤서: 다음 거 언제야.
태오: 모레.`;

test('reading.script: 콜론 형식 대본의 저장 본문 — 배역 수·줄 수가 확인 화면과 같고 지문 줄의 character_index는 null이다', () => {
  const draft = createDraft(COLON, 'paste', RID);
  const body = draftToCreateBody(draft);
  const summary = draftSummary(draft);

  assert.equal(body.request_id, RID);
  assert.equal(body.source, 'paste');
  assert.equal(body.raw_text, COLON, '원문을 그대로 싣는다');
  assert.equal(body.title, '옥상, 밤');
  assert.deepEqual(body.characters, [{ name: '윤서' }, { name: '태오' }]);
  assert.equal(body.characters.length, summary.characters);
  assert.equal(body.lines.length, summary.dialogues + summary.directions + summary.scenes);
  assert.deepEqual(body.lines.map((l) => l.ordinal), body.lines.map((_, i) => i + 1), 'ordinal은 1부터 줄 순서');
  assert.deepEqual(body.lines[0], { ordinal: 1, kind: 'direction', character_index: null, text: '옥상 난간. 바람 소리.' });
  assert.deepEqual(body.lines[1], { ordinal: 2, kind: 'dialogue', character_index: 0, text: '여기 있을 줄 알았어.' });
  assert.deepEqual(body.lines[2], { ordinal: 3, kind: 'dialogue', character_index: 1, text: '어떻게 알았어.' });
  const scene = body.lines.find((l) => l.kind === 'scene');
  assert.deepEqual(scene, { ordinal: 6, kind: 'scene', character_index: null, text: '제2막' });
});

test('reading.script: 확인 화면의 "배역 N명 · 대사 N줄 · 지문 N개" 수치', () => {
  const summary = draftSummary(createDraft(COLON, 'paste', RID));
  assert.deepEqual(summary, { characters: 2, dialogues: 6, directions: 1, scenes: 1 });
  assert.deepEqual(
    draftCharacters(createDraft(COLON, 'paste', RID)),
    [
      { key: '윤서', name: '윤서', dialogueCount: 3 },
      { key: '태오', name: '태오', dialogueCount: 3 },
    ],
  );
});

test('reading.script: 확인 화면에서 배역 하나를 빼고 저장하면 그 이름의 줄이 지문으로 저장된다', () => {
  const draft = removeDraftCharacter(createDraft(COLON, 'paste', RID), '태오');
  const body = draftToCreateBody(draft);
  assert.deepEqual(body.characters, [{ name: '윤서' }]);
  // 배역이 아닌 이름의 `이름: 대사` 줄은 이름을 남긴 채 지문이 된다(파서 규칙, 웹과 같다).
  const taeo = body.lines.filter((l) => l.text.startsWith('태오:'));
  assert.deepEqual(taeo.map((l) => l.text), ['태오: 어떻게 알았어.', '태오: 그런가.', '태오: 모레.']);
  assert.ok(taeo.every((l) => l.kind === 'direction' && l.character_index === null));
  assert.ok(body.lines.every((l) => l.kind !== 'dialogue' || l.character_index === 0));
});

test('reading.script: 이름을 더하고 저장하면 그 이름의 줄이 대사로 저장된다', () => {
  const raw = `윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.
지나: 나도 왔어.`;
  const before = draftToCreateBody(createDraft(raw, 'typed', RID));
  assert.deepEqual(
    before.lines.find((l) => l.text.endsWith('나도 왔어.')),
    { ordinal: 5, kind: 'direction', character_index: null, text: '지나: 나도 왔어.' },
    '한 번만 말한 이름은 아직 배역이 아니다',
  );

  const { draft, added } = addDraftCharacter(createDraft(raw, 'typed', RID), ' 지나 ');
  assert.equal(added, true);
  const body = draftToCreateBody(draft);
  assert.deepEqual(body.characters, [{ name: '윤서' }, { name: '태오' }, { name: '지나' }]);
  assert.deepEqual(body.lines.find((l) => l.text === '나도 왔어.'), { ordinal: 5, kind: 'dialogue', character_index: 2, text: '나도 왔어.' });
});

test('reading.script: 본문에 없는 이름은 더해지지 않는다', () => {
  const { draft, added } = addDraftCharacter(createDraft(COLON, 'paste', RID), '아무개');
  assert.equal(added, false);
  assert.equal(draftCharacters(draft).length, 2);
});

test('reading.script: 배역 이름을 고치면 이름만 바뀌고 줄의 배역 연결은 그대로다', () => {
  const draft = renameDraftCharacter(createDraft(COLON, 'paste', RID), '태오', ' 태오(형) ');
  const body = draftToCreateBody(draft);
  assert.deepEqual(body.characters, [{ name: '윤서' }, { name: '태오(형)' }]);
  assert.equal(body.lines[2].character_index, 1);
  assert.deepEqual(draftCharacters(draft)[1], { key: '태오', name: '태오(형)', dialogueCount: 3 });
});

test('reading.script: 이름을 빈 값으로 하거나 같은 대본의 다른 배역과 같게 하면 invalid_characters', () => {
  const base = createDraft(COLON, 'paste', RID);
  assert.deepEqual(validateDraft(renameDraftCharacter(base, '태오', '   ')), { ok: false, code: 'invalid_characters' });
  assert.deepEqual(validateDraft(renameDraftCharacter(base, '태오', '윤서')), { ok: false, code: 'invalid_characters' });
  assert.equal(validateDraft(base).ok, true);
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
  const draft = createDraft(manyRoles, 'paste', RID);
  assert.equal(draftCharacters(draft).length, 51);
  assert.deepEqual(validateDraft(draft), { ok: false, code: 'script_too_long' });
});

test('reading.script: 예시 대본을 불러와 저장하면 보통 대본이고 입력 경로만 sample이다', () => {
  const body = draftToCreateBody(createDraft(SAMPLE_SCRIPT, 'sample', RID));
  assert.equal(body.source, 'sample');
  assert.equal(body.title, '옥상, 밤');
  assert.equal(body.raw_text, SAMPLE_SCRIPT);
  assert.equal(body.characters.length, 2);
});

test('reading.script: 제목을 고치면 앞뒤 공백을 정리해 싣고 비우면 "제목 없는 대본"이다', () => {
  const draft = createDraft(COLON, 'paste', RID);
  assert.equal(draftToCreateBody(setDraftTitle(draft, '  갈매기 1막 ')).title, '갈매기 1막');
  assert.equal(draftToCreateBody(setDraftTitle(draft, '   ')).title, '제목 없는 대본');
  assert.equal([...draftToCreateBody(setDraftTitle(draft, '가'.repeat(250))).title].length, 200, '제목은 200자까지');
});
