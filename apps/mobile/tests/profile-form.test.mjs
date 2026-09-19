import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  BIO_MAX_LENGTH,
  EXPERIENCE_VALUES,
  GENDER_VALUES,
  GOAL_VALUES,
  DIRECTION_VALUES,
  buildProfilePayload,
  formatBirthDateInput,
  initialProfileForm,
  isBioValid,
  isProfileFormComplete,
  normalizeBio,
  parseBirthDate,
  profileGateStatus,
  profileSaveFailure,
} from '../lib/profile-form.ts';

const filled = {
  name: '김배우',
  gender: 'female',
  birthDate: '2001-03-14',
  directions: ['media', 'stage'],
  experience: 'exam_prep',
  goal: 'professional',
};
const today = new Date('2026-09-19T12:00:00+09:00');

test('account.profile: 저장 값 이름은 계약의 값 목록과 같다', () => {
  assert.deepEqual(GENDER_VALUES, ['female', 'male', 'unspecified']);
  assert.deepEqual(DIRECTION_VALUES, ['media', 'stage']);
  assert.deepEqual(EXPERIENCE_VALUES, [
    'before_start',
    'exam_prep',
    'under_1y',
    'y1_to_3',
    'y3_to_5',
    'over_5y',
  ]);
  assert.deepEqual(GOAL_VALUES, ['hobby', 'audition', 'professional']);
});

test('account.profile: 여섯 항목을 다 채워야 저장할 수 있고 "선택 안 함"도 필수를 만족한다', () => {
  assert.equal(isProfileFormComplete(filled, today), true);
  assert.equal(isProfileFormComplete({ ...filled, gender: 'unspecified' }, today), true);

  for (const missing of [
    { name: '   ' },
    { gender: null },
    { birthDate: '' },
    { directions: [] },
    { experience: null },
    { goal: null },
  ]) {
    assert.equal(
      isProfileFormComplete({ ...filled, ...missing }, today),
      false,
      JSON.stringify(missing),
    );
  }
});

test('account.profile: 이름은 앞뒤 공백을 떼고 1~20자다', () => {
  assert.equal(isProfileFormComplete({ ...filled, name: '가'.repeat(20) }, today), true);
  assert.equal(isProfileFormComplete({ ...filled, name: '가'.repeat(21) }, today), false);
  assert.equal(isProfileFormComplete({ ...filled, name: `  ${'가'.repeat(20)}  ` }, today), true);
  assert.equal(buildProfilePayload({ ...filled, name: '  김배우  ' }, today).name, '김배우');
});

test('account.profile: 추구하는 방향을 둘 이상 골라 저장하면 둘 다 실린다', () => {
  assert.deepEqual(buildProfilePayload(filled, today), {
    name: '김배우',
    gender: 'female',
    birth_date: '2001-03-14',
    directions: ['media', 'stage'],
    experience: 'exam_prep',
    goal: 'professional',
  });
});

test('account.profile: 설정에서 고칠 때는 받아 둔 한 줄 소개를 그대로 실어 지워지지 않게 한다', () => {
  assert.equal(buildProfilePayload(filled, today, { bio: '무대를 좋아해요' }).bio, '무대를 좋아해요');
  assert.equal(buildProfilePayload(filled, today, { bio: null }).bio, null);
  assert.equal('bio' in buildProfilePayload(filled, today), false);
});

test('account.profile: 채우지 않은 폼은 서버에 보내지 않는다', () => {
  assert.throws(() => buildProfilePayload({ ...filled, goal: null }, today));
});

test('account.profile: 생년월일은 실제로 있는 지난 날짜만 받는다', () => {
  assert.equal(parseBirthDate('2001-03-14', today), '2001-03-14');
  assert.equal(parseBirthDate('2004-02-29', today), '2004-02-29');
  assert.equal(parseBirthDate('2001-02-29', today), null); // 없는 날짜
  assert.equal(parseBirthDate('2001-13-01', today), null);
  assert.equal(parseBirthDate('2001-3-14', today), null);
  assert.equal(parseBirthDate('20010314', today), null);
  assert.equal(parseBirthDate('2026-09-20', today), null); // 미래
  assert.equal(parseBirthDate('1899-12-31', today), null);
});

test('account.profile: 만 14세 미만인지는 앱이 미리 막지 않고 서버가 한국 시간으로 판정한다', () => {
  // 오늘 기준 만 13세인 생년월일도 형식이 맞으면 제출할 수 있다. 거르는 것은 서버다.
  assert.equal(isProfileFormComplete({ ...filled, birthDate: '2013-01-01' }, today), true);
});

test('account.profile: 생년월일 입력은 숫자만 받아 YYYY-MM-DD로 끊어 준다', () => {
  assert.equal(formatBirthDateInput('2001'), '2001');
  assert.equal(formatBirthDateInput('20010'), '2001-0');
  assert.equal(formatBirthDateInput('200103'), '2001-03');
  assert.equal(formatBirthDateInput('20010314'), '2001-03-14');
  assert.equal(formatBirthDateInput('2001-03-14'), '2001-03-14');
  assert.equal(formatBirthDateInput('2001.03.14 추가'), '2001-03-14');
  assert.equal(formatBirthDateInput('200103149'), '2001-03-14');
});

test('account.profile: 1.0.0 이전 회원은 옛 닉네임이 이름 칸에 채워져 있다', () => {
  const form = initialProfileForm(
    { name: '옛닉네임', gender: null, birth_date: null, directions: [], experience: null, goal: null },
    '애플이 준 이름',
  );

  assert.equal(form.name, '옛닉네임');
  assert.equal(form.gender, null);
  assert.deepEqual(form.directions, []);
});

test('account.profile: 애플로 첫 로그인하면 이름 칸에 애플이 준 이름이 채워져 있고 지울 수 있다', () => {
  const form = initialProfileForm(null, '김애플');

  assert.equal(form.name, '김애플');
  // 채워 둔 값일 뿐이다. 지우고 다른 이름을 저장할 수 있다.
  assert.equal(buildProfilePayload({ ...filled, name: '다른이름' }, today).name, '다른이름');
  assert.equal(initialProfileForm(null, null).name, '');
});

test('account.profile: 설정에서 다시 열면 저장한 값이 그대로 채워진다', () => {
  assert.deepEqual(
    initialProfileForm(
      {
        name: '김배우',
        gender: 'female',
        birth_date: '2001-03-14',
        age: 25,
        directions: ['media', 'stage'],
        experience: 'exam_prep',
        goal: 'professional',
        photo_url: null,
        bio: null,
      },
      null,
    ),
    filled,
  );
});

test('account.profile: 서버의 profile_complete로 프로필 게이트를 정한다', () => {
  assert.equal(profileGateStatus({ profile_complete: true }), 'complete');
  assert.equal(profileGateStatus({ profile_complete: false }), 'required');
  // 옛 서버처럼 값이 없으면 통과시키지 않고 입력 화면으로 보낸다.
  assert.equal(profileGateStatus({}), 'required');
});

test('account.profile: 422 사유 under_14_account_closed는 계정이 닫힌 것이고 under_14는 거절만 한 것이다', () => {
  assert.deepEqual(
    profileSaveFailure(new ApiError(422, 'x', 'under_14_account_closed', 'under_14_account_closed')),
    { kind: 'account_closed' },
  );
  assert.deepEqual(profileSaveFailure(new ApiError(422, 'x', 'under_14', 'under_14')), {
    kind: 'under_14',
  });
});

test('account.profile: 422의 detail이 배열이면 앱 버그로 다루고 그 밖의 실패는 다시 시도하게 한다', () => {
  assert.deepEqual(
    profileSaveFailure(new ApiError(422, 'x', 'validation_error', [{ loc: ['body', 'name'] }])),
    { kind: 'client_bug' },
  );
  assert.deepEqual(profileSaveFailure(new ApiError(403, 'x', 'consent_required')), {
    kind: 'retry',
  });
  assert.deepEqual(profileSaveFailure(new Error('network')), { kind: 'retry' });
});

test('account.profile: 한 줄 소개는 80자까지다 — 81자는 서버에 보내지 않는다', () => {
  assert.equal(BIO_MAX_LENGTH, 80);
  assert.equal(isBioValid('가'.repeat(80)), true);
  assert.equal(isBioValid('가'.repeat(81)), false);
  // 앞뒤 공백은 떼고 센다.
  assert.equal(isBioValid(`  ${'가'.repeat(80)}  `), true);
  assert.throws(() => buildProfilePayload(filled, today, { bio: '가'.repeat(81) }));
});

test('account.profile: 소개는 선택 항목이다 — 비우면 null로 저장되고 사진과 소개 없이도 저장된다', () => {
  assert.equal(normalizeBio('   '), null);
  assert.equal(normalizeBio(''), null);
  assert.equal(normalizeBio('  무대를 좋아해요  '), '무대를 좋아해요');
  assert.equal(buildProfilePayload(filled, today, { bio: '   ' }).bio, null);
  assert.equal(buildProfilePayload(filled, today, { bio: '  무대를 좋아해요 ' }).bio, '무대를 좋아해요');
  assert.equal(isBioValid(''), true);
});
