import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consentChangeFailureAction,
  consentSettingsRows,
  createConsentEntrySession,
} from '../lib/consent-entry.ts';

const allowedEntry = {
  entry_status: 'allowed',
  documents: [],
  undecided_documents: [],
};

const privacyDocument = {
  id: 'privacy-v2',
  type: 'privacy',
  version: '2',
  title: '개인정보 수집·이용 동의',
  body: '본문',
  required: true,
  published_at: '2026-09-01T00:00:00Z',
};

test('저장 자격 증명 복원은 같은 인증 세션의 동의 진입 판정을 한 번만 읽는다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      return allowedEntry;
    },
  });

  assert.deepEqual(await session.readOnce(), allowedEntry);
  assert.deepEqual(await session.readOnce(), allowedEntry);
  assert.equal(entryReads, 1);
});

test('동의 진입 조회 실패는 캐시하지 않아 같은 화면에서 다시 시도할 수 있다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      if (entryReads === 1) throw new Error('offline');
      return allowedEntry;
    },
  });

  await assert.rejects(session.readOnce(), /offline/);
  assert.deepEqual(await session.readOnce(), allowedEntry);
  assert.equal(entryReads, 2);
});

test('결정 저장 뒤 최종 확인은 캐시를 건너뛰고 최신 판정을 읽는다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      return entryReads === 1
        ? {
            entry_status: 'decision_required',
            documents: [{ ...privacyDocument, current_decision: null }],
            undecided_documents: [{ ...privacyDocument, current_decision: null }],
          }
        : allowedEntry;
    },
  });

  assert.equal((await session.readOnce()).entry_status, 'decision_required');
  assert.equal((await session.refresh()).entry_status, 'allowed');
  assert.equal(entryReads, 2);
});

test('로그아웃이나 계정 전환은 이전 인증 세션의 진입 판정을 재사용하지 않는다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      return allowedEntry;
    },
  });

  await session.readOnce();
  session.clear();
  await session.readOnce();
  assert.equal(entryReads, 2);
});

// 날짜 표시는 기기 시간대를 따른다. 테스트는 한국 시간(UTC+9)으로 고정해 어디서 돌려도 같다.
const KST = { utcOffsetMinutes: 9 * 60 };

const settingsEntry = {
  entry_status: 'allowed',
  undecided_documents: [],
  documents: [
    { ...privacyDocument, id: 'terms-1', type: 'terms', title: '서비스 이용약관', version: '2026-10-01',
      published_at: '2026-10-01T03:00:00Z', current_decision: 'granted', decided_at: '2026-10-02T03:11:09.120000Z' },
    { ...privacyDocument, id: 'privacy-1', version: '2026-10-01',
      published_at: '2026-10-01T03:00:00Z', current_decision: 'granted', decided_at: '2026-10-02T03:11:09.120000Z' },
    { ...privacyDocument, id: 'ai-1', type: 'ai_analysis', title: 'AI 분석 동의', version: '2026-10-01',
      published_at: '2026-10-01T03:00:00Z', current_decision: 'granted', decided_at: '2026-10-02T03:11:09.120000Z' },
    { ...privacyDocument, id: 'retention-1', type: 'retention', title: '탈퇴 후 영상·녹음 보관·활용',
      required: false, version: '2026-10-01', published_at: '2026-10-01T03:00:00Z',
      current_decision: 'declined', decided_at: '2026-10-05T04:00:00Z' },
  ],
};

test('account.consent: 설정을 열면 필수 셋과 선택 하나가 각각 현재 판, 시행일, 내 결정, 결정 시각으로 보인다', () => {
  const rows = consentSettingsRows(settingsEntry, KST);

  assert.deepEqual(
    rows.map((row) => [row.title, row.required]),
    [
      ['서비스 이용약관', true],
      ['개인정보 수집·이용 동의', true],
      ['AI 분석 동의', true],
      ['탈퇴 후 영상·녹음 보관·활용', false],
    ],
  );
  assert.deepEqual(rows[0], {
    id: 'terms-1',
    title: '서비스 이용약관',
    body: '본문',
    required: true,
    version: '2026-10-01',
    // 시행일은 발행 시각이다. 발행일과 시행일을 따로 두지 않는다.
    effectiveDate: '2026.10.01',
    decision: 'granted',
    decidedDate: '2026.10.02',
    canChange: false,
  });
  assert.equal(rows[3].decision, 'declined');
  assert.equal(rows[3].decidedDate, '2026.10.05');
  // 한국 시간 자정 직전과 직후는 하루가 갈린다.
  const [late] = consentSettingsRows(
    { ...settingsEntry, documents: [{ ...settingsEntry.documents[0], decided_at: '2026-10-02T14:59:59Z' }] },
    KST,
  );
  const [early] = consentSettingsRows(
    { ...settingsEntry, documents: [{ ...settingsEntry.documents[0], decided_at: '2026-10-02T15:00:00Z' }] },
    KST,
  );
  assert.equal(late.decidedDate, '2026.10.02');
  assert.equal(early.decidedDate, '2026.10.03');
});

test('account.consent: 필수 문서는 내용만 보고 바꿀 수 없고, 선택 문서만 동의와 거절을 오간다', () => {
  const rows = consentSettingsRows(settingsEntry);

  assert.deepEqual(
    rows.map((row) => row.canChange),
    [false, false, false, true],
  );
});

test('account.consent: 아직 결정하지 않은 문서는 결정과 결정 시각이 비어 보인다', () => {
  const [row] = consentSettingsRows({
    ...settingsEntry,
    documents: [{ ...settingsEntry.documents[3], current_decision: null, decided_at: null }],
  });

  assert.equal(row.decision, null);
  assert.equal(row.decidedDate, null);
});

test('account.consent: 옛 판이나 없는 문서에 결정을 보냈으면 목록을 다시 받아 현재 판을 보여 준다', () => {
  const failure = (status, code) => Object.assign(new Error(code), { status, code });

  assert.equal(consentChangeFailureAction(failure(409, 'consent_document_outdated')), 'reload');
  assert.equal(consentChangeFailureAction(failure(404, 'consent_document_not_found')), 'reload');
  assert.equal(consentChangeFailureAction(failure(500, 'internal_server_error')), 'show_error');
  assert.equal(consentChangeFailureAction(new Error('network')), 'show_error');
});
