import assert from 'node:assert/strict';
import test from 'node:test';

import { MATCH_INPUT_MAX, PASS_THRESHOLD, compareLine, mergeTranscripts, normalizeForMatch, similarity } from '../lib/reading/match.ts';

test('reading.memorization: 대조는 정규화(괄호 안 제거, 문자·숫자만, 소문자) 뒤 자모 편집거리 유사도 0.72 이상이면 통과다', () => {
  assert.equal(PASS_THRESHOLD, 0.72);
  assert.equal(normalizeForMatch('(웃으며) 그런가, 정말?'), '그런가정말');
  assert.equal(compareLine('여기 있을 줄 알았어', '여기 있을 줄 알았어.').kind, 'pass');
  assert.equal(compareLine('전혀 다른 말이야 이건', '여기 있을 줄 알았어.').kind, 'miss');
});

test('reading.memorization: 유사도 0.72는 통과, 0.71은 미달이다(경계)', () => {
  const target = '가나다라마바사아자차카타파하';
  // 자모 길이를 재서 정확히 경계 근처의 발화를 만든다
  const base = similarity(target, target);
  assert.equal(base, 1);
  assert.equal(compareLine('가나다라마바사아자차카타파하', target).kind, 'pass');
  const said71 = '가나다라마바사아자차카타xxxxxxxxxxxx';
  const s = similarity(said71, target);
  assert.ok(s < PASS_THRESHOLD, `${s}`);
  assert.equal(compareLine(said71, target).kind, 'miss');
});

test('reading.session: 원문이나 말한 것이 1,000자를 넘으면 대조하지 않고 수동 진행을 준다(미달로 기록하지 않음)', () => {
  assert.equal(MATCH_INPUT_MAX, 1000);
  const long = '가'.repeat(1001);
  assert.equal(compareLine('가', long).kind, 'too_long');
  assert.equal(compareLine(long, '가').kind, 'too_long');
  assert.equal(compareLine('가'.repeat(1000), '가'.repeat(1000)).kind, 'pass');
});

test('reading.session: 인식 불가·무발화는 미달로 세지 않는다', () => {
  assert.equal(compareLine('', '여기').kind, 'no_speech');
  assert.equal(compareLine('   ...', '여기').kind, 'no_speech');
});

test('reading.session: 인식 결과 조각을 한 문장으로 합친다(누적·조각 둘 다)', () => {
  assert.equal(mergeTranscripts(['너', '너 맨날', '너 맨날 그러잖아']), '너 맨날 그러잖아');
  assert.equal(mergeTranscripts(['너 맨날', '그러잖아']), '너 맨날 그러잖아');
});
