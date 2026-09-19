import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSignupDecisions,
  canSubmitConsentDecisions,
  documentsForConsentEntry,
  grantAllRequired,
  signupFailureAction,
  submitConsentDecisions,
} from '../lib/consent-entry-submission.ts';

const requiredDocument = {
  id: 'terms-v2',
  type: 'terms',
  version: '2',
  title: '이용약관',
  body: '본문',
  required: true,
  published_at: '2026-09-01T00:00:00Z',
  current_decision: null,
};

const optionalDocument = {
  ...requiredDocument,
  id: 'research-v1',
  type: 'research',
  title: '연구 참여',
  required: false,
};

test('필수는 수락만, 선택은 수락이나 거절을 명시해야 제출할 수 있다', () => {
  const documents = [requiredDocument, optionalDocument];

  assert.equal(canSubmitConsentDecisions(documents, new Map()), false);
  assert.equal(
    canSubmitConsentDecisions(
      documents,
      new Map([
        [requiredDocument.id, 'granted'],
        [optionalDocument.id, 'declined'],
      ]),
    ),
    true,
  );
  assert.equal(
    canSubmitConsentDecisions(
      documents,
      new Map([
        [requiredDocument.id, 'declined'],
        [optionalDocument.id, 'granted'],
      ]),
    ),
    false,
  );
});

test('부분 실패는 성공한 문서를 보존하고 실패한 문서만 다시 저장한다', async () => {
  const calls = [];
  let optionalAttempts = 0;
  const documents = [requiredDocument, optionalDocument];
  const choices = new Map([
    [requiredDocument.id, 'granted'],
    [optionalDocument.id, 'declined'],
  ]);
  const dependencies = {
    recordDecision: async (documentId, action) => {
      calls.push(`${documentId}:${action}`);
      if (documentId === optionalDocument.id && optionalAttempts++ === 0) {
        throw new Error('offline');
      }
    },
    refreshEntry: async () => ({
      entry_status: 'allowed',
      documents: [],
      undecided_documents: [],
    }),
  };

  const partial = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(),
    ...dependencies,
  });
  assert.equal(partial.kind, 'partial');
  assert.deepEqual(partial.completedDocumentIds, [requiredDocument.id]);
  assert.deepEqual(partial.failedDocuments, [optionalDocument]);

  const retried = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(partial.completedDocumentIds),
    ...dependencies,
  });
  assert.equal(retried.kind, 'verified');
  assert.deepEqual(calls, [
    `${requiredDocument.id}:granted`,
    `${optionalDocument.id}:declined`,
    `${optionalDocument.id}:declined`,
  ]);
});

test('최종 재확인 실패는 저장 성공을 보존하고 조회만 다시 시도하게 구분한다', async () => {
  let recordCalls = 0;
  const result = await submitConsentDecisions({
    documents: [requiredDocument],
    choices: new Map([[requiredDocument.id, 'granted']]),
    completedDocumentIds: new Set(),
    recordDecision: async () => {
      recordCalls += 1;
    },
    refreshEntry: async () => {
      throw new Error('verification offline');
    },
  });

  assert.equal(result.kind, 'verification_failed');
  assert.deepEqual(result.completedDocumentIds, [requiredDocument.id]);
  assert.equal(recordCalls, 1);
});

test('account.consent: 동의 화면은 미결정 문서만 다루고, 1.0.0 이전에 필수 문서를 거절한 회원도 미결정으로 나온다', () => {
  assert.deepEqual(
    documentsForConsentEntry({
      entry_status: 'decision_required',
      documents: [requiredDocument, optionalDocument],
      undecided_documents: [requiredDocument, optionalDocument],
    }),
    [requiredDocument, optionalDocument],
  );

  // 서버가 옛 거절을 미결정과 같게 다뤄 undecided_documents에 싣는다(consent_blocked는 없어졌다).
  const declinedRequired = {
    ...requiredDocument,
    current_decision: 'declined',
  };
  assert.deepEqual(
    documentsForConsentEntry({
      entry_status: 'decision_required',
      documents: [declinedRequired, optionalDocument],
      undecided_documents: [declinedRequired],
    }),
    [declinedRequired],
  );
  assert.deepEqual(
    documentsForConsentEntry({
      entry_status: 'allowed',
      documents: [requiredDocument, optionalDocument],
      undecided_documents: [],
    }),
    [],
  );
});

test('저장 중 문서가 교체되면 사라진 문서를 재시도하지 않고 최신 판정을 확인한다', async () => {
  let verificationReads = 0;
  const result = await submitConsentDecisions({
    documents: [requiredDocument],
    choices: new Map([[requiredDocument.id, 'granted']]),
    completedDocumentIds: new Set(),
    recordDecision: async () => {
      throw Object.assign(new Error('stale document'), {
        status: 404,
        code: 'consent_document_not_found',
      });
    },
    refreshEntry: async () => {
      verificationReads += 1;
      return {
        entry_status: 'decision_required',
        documents: [optionalDocument],
        undecided_documents: [optionalDocument],
      };
    },
  });

  assert.equal(result.kind, 'verified');
  assert.deepEqual(result.completedDocumentIds, [requiredDocument.id]);
  assert.equal(verificationReads, 1);
});

const signupDocuments = [
  { ...requiredDocument, id: 'terms-1', type: 'terms' },
  { ...requiredDocument, id: 'privacy-1', type: 'privacy', title: '개인정보 수집·이용 동의' },
  { ...requiredDocument, id: 'ai-1', type: 'ai_analysis', title: 'AI 분석 동의' },
  { ...optionalDocument, id: 'retention-1', type: 'retention', title: '탈퇴 후 영상·녹음 보관·활용' },
];

test('account.login: 필수 셋에 동의하고 선택 문서를 동의·거절 중 하나로 골라야 버튼이 켜진다', () => {
  const requiredOnly = new Map([
    ['terms-1', 'granted'],
    ['privacy-1', 'granted'],
    ['ai-1', 'granted'],
  ]);

  assert.equal(canSubmitConsentDecisions(signupDocuments, requiredOnly), false);
  assert.equal(
    canSubmitConsentDecisions(signupDocuments, new Map([...requiredOnly, ['retention-1', 'declined']])),
    true,
  );
  assert.equal(
    canSubmitConsentDecisions(signupDocuments, new Map([...requiredOnly, ['retention-1', 'granted']])),
    true,
  );
  // 필수 문서는 동의만 된다. 화면에 거절이 없고, 값으로 들어와도 버튼은 꺼져 있다.
  assert.equal(
    canSubmitConsentDecisions(
      signupDocuments,
      new Map([...requiredOnly, ['ai-1', 'declined'], ['retention-1', 'granted']]),
    ),
    false,
  );
});

test('account.login: 전체 동의는 필수 문서만 채우고 선택 문서의 결정은 기본값 없이 남긴다', () => {
  const next = grantAllRequired(signupDocuments, new Map(), new Set());

  assert.deepEqual(
    [...next],
    [
      ['terms-1', 'granted'],
      ['privacy-1', 'granted'],
      ['ai-1', 'granted'],
    ],
  );
  assert.equal(canSubmitConsentDecisions(signupDocuments, next), false);
});

test('account.login: 전체 동의는 이미 고른 선택 문서의 결정과 저장이 끝난 문서를 건드리지 않는다', () => {
  const next = grantAllRequired(
    signupDocuments,
    new Map([['retention-1', 'declined']]),
    new Set(['terms-1']),
  );

  assert.equal(next.get('retention-1'), 'declined');
  assert.equal(next.has('terms-1'), false);
  assert.equal(next.get('privacy-1'), 'granted');
});

test('account.login: 가입 제출은 현재 판 모든 문서의 결정을 한 번에 담는다', () => {
  const choices = new Map([
    ['terms-1', 'granted'],
    ['privacy-1', 'granted'],
    ['ai-1', 'granted'],
    ['retention-1', 'declined'],
  ]);

  assert.deepEqual(buildSignupDecisions(signupDocuments, choices), [
    { document_id: 'terms-1', action: 'granted' },
    { document_id: 'privacy-1', action: 'granted' },
    { document_id: 'ai-1', action: 'granted' },
    { document_id: 'retention-1', action: 'declined' },
  ]);
});

test('account.login: 결정이 빠진 가입 제출은 서버에 보내지 않는다', () => {
  assert.throws(() =>
    buildSignupDecisions(
      signupDocuments,
      new Map([
        ['terms-1', 'granted'],
        ['privacy-1', 'granted'],
        ['ai-1', 'granted'],
      ]),
    ),
  );
});

test('account.login: 가입 제출 실패는 사유에 따라 다시 로그인·문서 다시 받기·로그인 화면 안내로 갈린다', () => {
  const failure = (status, code) => Object.assign(new Error(code), { status, code });

  // 가입 토큰이 만료(30분)됐으면 로그인 버튼부터 다시 시작한다.
  assert.equal(signupFailureAction(failure(401, 'invalid_signup_token')), 'restart_login');
  // 동의 화면을 보는 사이 새 판이 나왔으면 문서를 다시 받아 화면을 새로 그린다.
  assert.equal(signupFailureAction(failure(409, 'consent_document_outdated')), 'reload_documents');
  assert.equal(signupFailureAction(failure(404, 'consent_document_not_found')), 'reload_documents');
  assert.equal(
    signupFailureAction(failure(409, 'account_exists_with_different_provider')),
    'restart_login',
  );
  assert.equal(signupFailureAction(failure(429, 'rate limit exceeded')), 'retry');
  assert.equal(signupFailureAction(new Error('network')), 'retry');
});

test('account.consent: 옛 판 문서 id에 결정을 보내 409를 받으면 다시 시도하지 않고 목록을 다시 받아 현재 판을 보여 준다', async () => {
  let attempts = 0;
  const newVersion = { ...requiredDocument, id: 'terms-v3', version: '3' };
  const result = await submitConsentDecisions({
    documents: [requiredDocument],
    choices: new Map([[requiredDocument.id, 'granted']]),
    completedDocumentIds: new Set(),
    recordDecision: async () => {
      attempts += 1;
      throw Object.assign(new Error('outdated'), {
        status: 409,
        code: 'consent_document_outdated',
      });
    },
    refreshEntry: async () => ({
      entry_status: 'decision_required',
      documents: [newVersion],
      undecided_documents: [newVersion],
    }),
  });

  assert.equal(attempts, 1);
  assert.equal(result.kind, 'verified');
  assert.deepEqual(result.entry.undecided_documents, [newVersion]);
});

test('account.consent: 결정을 다 고르지 않았다는 안내는 언어 파일에서 오고 "~해요"체다', async () => {
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');

  assert.throws(
    () => buildSignupDecisions(signupDocuments, new Map()),
    (error) => error.message === ko.consent.undecided,
  );
  assert.doesNotMatch(ko.consent.undecided, /습니다|합니다/);
  assert.doesNotMatch(en.consent.undecided, /[가-힣]/);
});
