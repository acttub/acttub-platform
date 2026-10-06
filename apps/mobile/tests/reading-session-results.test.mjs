import assert from 'node:assert/strict';
import test from 'node:test';

import { differentLines, directionLabel, flowRows, readDialogueCount } from '../lib/reading/session-results.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const LINES = [X('옥상'), D('윤서', '하나'), D('태오', '둘'), X('사이'), D('윤서', '셋'), D('태오', '넷'), D('윤서', '다섯')];
const IDS = LINES.map((_, i) => `l${i}`);
const RESULTS = {
  l1: { outcome: 'passed', said: '하나' },
  l4: { outcome: 'unmatched', said: '세엣' },
  l6: { outcome: 'unmatched', said: null },
};

test('reading.session: 원문과 다르게 말한 대사는 구간 안 unmatched 인 내 줄이고 원문·대사 번호·말한 것을 줄 순서로 준다', () => {
  assert.deepEqual(differentLines({ lines: LINES, lineIds: IDS, startIndex: 0, endIndex: 6, results: RESULTS }), [
    { lineId: 'l4', dialogueNo: 3, role: '윤서', text: '셋', said: '세엣' },
    { lineId: 'l6', dialogueNo: 5, role: '윤서', text: '다섯', said: null },
  ]);
  assert.deepEqual(differentLines({ lines: LINES, lineIds: IDS, startIndex: 0, endIndex: 4, results: RESULTS }).map((d) => d.lineId), ['l4'], '구간 밖은 뺀다');
  assert.deepEqual(differentLines({ lines: LINES, lineIds: IDS, startIndex: 0, endIndex: 6, results: { l1: RESULTS.l1 } }), [], '통과만 있으면 비어 있다');
});

test('reading.session: 대본 흐름(R9.26)은 구간 줄 전부를 순서대로 주고 다르게 말한 내 줄에만 말한 것이 붙는다', () => {
  const rows = flowRows({ lines: LINES, lineIds: IDS, startIndex: 3, endIndex: 6, myRoles: ['윤서'], results: RESULTS });
  assert.deepEqual(
    rows.map((r) => [r.lineId, r.line.type, r.mine, r.different?.said ?? null]),
    [
      ['l3', 'direction', false, null],
      ['l4', 'dialogue', true, '세엣'],
      ['l5', 'dialogue', false, null],
      ['l6', 'dialogue', true, null],
    ],
  );
  assert.equal(rows[3].different?.text, '다섯', '전사가 없어도 다르게 말한 줄로 남는다');
});

test('reading.session: 읽은 대사는 구간 안 대사 줄 수다(부분 구간을 대본 전체 완료로 말하지 않는다)', () => {
  assert.equal(readDialogueCount(LINES, 1, 6), 5);
  assert.equal(readDialogueCount(LINES, 4, 6), 3);
});

test('reading.session: 대본 흐름의 지문은 괄호에 싸서 보인다(이미 싸여 있으면 그대로)', () => {
  assert.equal(directionLabel('사이. 태오가 난간에 기댄다.'), '(사이. 태오가 난간에 기댄다.)');
  assert.equal(directionLabel('(웃으며)'), '(웃으며)');
});
