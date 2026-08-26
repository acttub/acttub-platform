import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKAGE_CHOICES,
  blockageDetailExamples,
  blockageDetailTitle,
  changeBlockageKind,
  changeBlockageSubBranch,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
  updateBlockageDetail,
  skippedBlockageSelection,
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

test('모든 세부에 상세 예시와 제목이 있다', () => {
  const all = ['분석', '표현'].flatMap((kind) =>
    subBranchChoices(kind).map((c) => c.value),
  );
  for (const subBranch of [...new Set(all), '그 외']) {
    assert.ok(blockageDetailExamples(subBranch).length > 0, subBranch);
    assert.ok(blockageDetailTitle(subBranch).length > 0, subBranch);
  }
});

test('SOMA-432: 막힘 선택 건너뛰기는 서버 기본 분기(그 외)와 같은 값을 보낸다', () => {
  assert.deepEqual(skippedBlockageSelection(), {
    blockage_kind: '그 외',
    sub_branch: '그 외',
    blockage_detail: null,
  });
});
