import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKAGE_CHOICES,
  BLOCKAGE_DETAIL_TITLE,
  blockageDetailExamples,
  changeBlockageKind,
  changeBlockageSubBranch,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
  updateBlockageDetail,
} from '../lib/blockage.ts';

test('대분류는 웹과 같은 세 가지다', () => {
  assert.deepEqual(
    BLOCKAGE_CHOICES.map((c) => c.value),
    ['분석', '표현', '그 외'],
  );
});

test("'그 외'는 좁힐 게 없어 세부 단계를 건너뛴다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, '그 외');
  assert.equal(state.step, 'detail');
  assert.equal(state.subBranch, '그 외');
  assert.deepEqual(subBranchChoices('그 외'), []);
});

test('분석·표현은 세부 단계를 거친다', () => {
  for (const kind of ['분석', '표현']) {
    const state = chooseBlockageKind(initialBlockageFlowState, kind);
    assert.equal(state.step, 'sub');
    assert.equal(state.subBranch, null);
    assert.ok(subBranchChoices(kind).length > 0);
  }
});

test('세부를 고르면 상세 단계로 간다', () => {
  const picked = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, '표현'),
    '감정',
  );
  assert.equal(picked.step, 'detail');
  assert.equal(picked.subBranch, '감정');
});

test('상세는 비워도 완성되고, 빈 값은 null 로 내려간다', () => {
  const state = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, '분석'),
    '대사 분석',
  );
  assert.deepEqual(completeBlockageFlow(state), {
    blockage_kind: '분석',
    sub_branch: '대사 분석',
    blockage_detail: null,
  });
});

test('공백만 적은 상세도 null 로 본다', () => {
  const state = updateBlockageDetail(
    chooseBlockageSubBranch(chooseBlockageKind(initialBlockageFlowState, '표현'), '화술'),
    '   ',
  );
  assert.equal(completeBlockageFlow(state).blockage_detail, null);
});

test('적은 상세는 앞뒤 공백을 떼고 실어 보낸다', () => {
  const state = updateBlockageDetail(
    chooseBlockageSubBranch(chooseBlockageKind(initialBlockageFlowState, '표현'), '표정'),
    '  두 번째 대사에서 굳어요  ',
  );
  assert.equal(completeBlockageFlow(state).blockage_detail, '두 번째 대사에서 굳어요');
});

test('상세 단계 전에는 아무것도 내지 않는다', () => {
  assert.equal(completeBlockageFlow(initialBlockageFlowState), null);
  assert.equal(
    completeBlockageFlow(chooseBlockageKind(initialBlockageFlowState, '분석')),
    null,
  );
});

test('대분류를 바꾸면 세부 선택이 지워진다', () => {
  const picked = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, '표현'),
    '움직임',
  );
  const reset = changeBlockageKind(picked);
  assert.equal(reset.step, 'main');
  assert.equal(reset.kind, null);
  assert.equal(reset.subBranch, null);
});

test("'그 외'에서 뒤로 가면 대분류로 돌아간다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, '그 외');
  assert.equal(changeBlockageSubBranch(state).step, 'main');
});

test('세부에서 뒤로 가면 세부 단계로만 돌아간다', () => {
  const state = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, '분석'),
    '캐릭터 분석',
  );
  const back = changeBlockageSubBranch(state);
  assert.equal(back.step, 'sub');
  assert.equal(back.kind, '분석');
  assert.equal(back.subBranch, null);
});

test('상세 제목과 예시는 하위 갈래와 무관한 한 벌이다', () => {
  // 갈래별로 나눠 두면 예시가 전부 '어디에서 막히는지'를 묻게 된다(SOMA-454).
  assert.ok(BLOCKAGE_DETAIL_TITLE.length > 0);
  assert.ok(blockageDetailExamples().length > 0);
});

test('화면에 그리는 라벨은 저장값과 다른 문장이다', () => {
  // 라벨 자리에 저장값을 그대로 쓰면 배우가 카드 제목으로 '그 외'를 읽는다(SOMA-454).
  // 값은 서버가 코치를 가르는 데 쓰고, 화면은 문장을 쓴다.
  for (const choice of BLOCKAGE_CHOICES) {
    assert.notEqual(choice.label, choice.value, choice.value);
    assert.ok(choice.label.length > choice.value.length, choice.value);
  }
});
