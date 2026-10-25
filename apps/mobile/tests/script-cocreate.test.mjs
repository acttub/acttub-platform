import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coachSceneFor,
  durationLabel,
  errorKey,
  experienceFor,
  generateWithWait,
  myRole,
  revisionBody,
  revisionChanged,
  shouldWaitForGeneration,
  summaryLine,
} from '../lib/script-cocreate.ts';

const script = {
  id: 's1',
  version: 2,
  title: '잊어버린 생일',
  scene: '옥상, 밤',
  characters: [
    { name: '지수', gender: 'f', age_band: 'young', mine: true },
    { name: '민호', gender: 'm', age_band: 'young', mine: false },
  ],
  design: { relation: '오래된 친구, 반말', incident: '민호가 생일을 잊었다', prop: '영수증', my_objective: '사과를 받는다', other_reason: '', turn_action: '' },
  character_count: 2,
  length_minutes: 1,
  estimated_seconds: 57,
};

test('분량은 추정이라 「약」을 붙이고 30초 단위로 둥글린다', () => {
  assert.equal(durationLabel(57), '약 1분');
  assert.equal(durationLabel(44), '약 40초');
  assert.equal(durationLabel(3), '약 10초');
  assert.equal(durationLabel(95), '약 1분 30초');
  assert.equal(durationLabel(180), '약 3분');
});

test('결과 머리 한 줄 — 배역 이름, 독백·n인 대화, 추정 분량', () => {
  assert.equal(summaryLine(script), '지수 · 민호 · 2인 대화 · 약 1분');
  assert.equal(summaryLine({ characters: [script.characters[0]], estimated_seconds: 60 }), '지수 · 독백 · 약 1분');
  assert.equal(myRole({ characters: [{ ...script.characters[1], mine: false }] }), '민호');
  assert.equal(myRole({ characters: [] }), '');
});

test('지금 찍기 — 장면 칸에 제목·장소·직전 사건, 내 배역과 관계, 목표를 채운다', () => {
  assert.deepEqual(coachSceneFor(script), {
    situation: '잊어버린 생일 · 옥상, 밤 · 민호가 생일을 잊었다',
    character: '지수 (오래된 친구, 반말)',
    goal: '사과를 받는다',
  });
  const bare = coachSceneFor({ ...script, scene: '', design: { ...script.design, relation: '', incident: '', my_objective: '' } });
  assert.deepEqual(bare, { situation: '잊어버린 생일', character: '지수', goal: '' });
  assert.equal(coachSceneFor({ ...script, title: '가'.repeat(400) }).situation.length, 300);
});

test('수정 — 바뀐 것만 싣고, 아무것도 안 바뀌면 누를 수 없다', () => {
  const same = { text: '  ', characterCount: 2, minutes: 1 };
  assert.equal(revisionChanged(script, same), false);
  assert.deepEqual(revisionBody(script, same), { base_version: 2 });
  assert.equal(revisionChanged(script, { ...same, text: '더 담담하게' }), true);
  assert.deepEqual(revisionBody(script, { text: ' 더 담담하게 ', characterCount: 1, minutes: 3 }), {
    base_version: 2,
    text: '더 담담하게',
    character_count: 1,
    length_minutes: 3,
  });
  assert.equal(revisionChanged(script, { ...same, minutes: 3 }), true);
});

test('프로필 경력을 서버의 세 갈래로, 오류 코드를 문구 키로 바꾼다', () => {
  assert.equal(experienceFor('exam_prep'), 'exam');
  assert.equal(experienceFor('y3_to_5'), 'experienced');
  assert.equal(experienceFor('y1_to_3'), 'experienced');
  assert.equal(experienceFor('over_5y'), 'experienced');
  assert.equal(experienceFor('before_start'), 'beginner');
  assert.equal(experienceFor(null), 'beginner');
  assert.equal(errorKey('sample_script_revision_limit'), 'scriptCocreate.errorRevisionLimit');
  assert.equal(errorKey('sample_script_daily_limit'), 'scriptCocreate.errorDailyLimit');
  assert.equal(errorKey('sample_script_in_progress'), 'scriptCocreate.errorBusy');
  assert.equal(errorKey('sample_script_busy'), 'scriptCocreate.errorBusy');
  assert.equal(errorKey('sample_script_version_conflict'), 'scriptCocreate.errorConflict');
  assert.equal(errorKey('sample_script_revision_failed'), 'scriptCocreate.errorRevision');
  assert.equal(errorKey('script_limit'), 'scriptCocreate.errorScriptLimit');
  assert.equal(errorKey(undefined), 'scriptCocreate.errorGenerate');
});

test('대본 생성: 받는 길이 끊긴 실패(5xx·연결 끊김·만드는 중 409)만 기다렸다 다시 묻는다', () => {
  assert.equal(shouldWaitForGeneration({ status: 500, code: 'unknown' }), true);
  assert.equal(shouldWaitForGeneration({ status: 0, code: 'network_error' }), true);
  assert.equal(shouldWaitForGeneration({ status: 409, code: 'sample_script_in_progress' }), true);
  assert.equal(shouldWaitForGeneration({ status: 429, code: 'sample_script_daily_limit' }), false);
  assert.equal(shouldWaitForGeneration({ status: 422, code: 'invalid' }), false);
  assert.equal(shouldWaitForGeneration(new Error('x')), false);
  assert.equal(shouldWaitForGeneration(null), false);
});

test('대본 생성: 프록시 500 뒤 만드는 중이면 기다렸다 같은 호출로 결과를 받고, 시간이 다 되면 마지막 오류를 던진다', async () => {
  let clock = 0;
  const sleeps = [];
  const options = { deadlineMs: 20_000, intervalMs: 5_000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } };
  const replies = [{ status: 500, code: 'unknown' }, { status: 409, code: 'sample_script_in_progress' }, 'done'];
  let calls = 0;
  const made = await generateWithWait(async () => {
    const reply = replies[calls++];
    if (typeof reply === 'string') return reply;
    throw reply;
  }, options);
  assert.equal(made, 'done');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [5_000, 5_000]);

  clock = 0;
  let tries = 0;
  await assert.rejects(
    generateWithWait(async () => {
      tries += 1;
      throw { status: 409, code: 'sample_script_in_progress' };
    }, options),
    (e) => e.code === 'sample_script_in_progress',
  );
  assert.equal(tries, 5); // 0·5·10·15·20초에 묻고 다음은 마감을 넘는다

  await assert.rejects(
    generateWithWait(async () => {
      throw { status: 429, code: 'sample_script_daily_limit' };
    }, options),
    (e) => e.status === 429,
  );
});
