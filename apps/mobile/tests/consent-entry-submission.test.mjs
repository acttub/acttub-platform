import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canSubmitConsentDecisions,
  documentsForConsentEntry,
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

test('동의 결정 화면은 미결정 문서만 다루고 차단 상태는 설정의 동의 관리로 넘긴다', () => {
  assert.deepEqual(
    documentsForConsentEntry({
      entry_status: 'decision_required',
      documents: [requiredDocument, optionalDocument],
      undecided_documents: [requiredDocument, optionalDocument],
    }),
    [requiredDocument, optionalDocument],
  );

  const declinedRequired = {
    ...requiredDocument,
    current_decision: 'declined',
  };
  const revokedOptional = {
    ...optionalDocument,
    current_decision: 'revoked',
  };
  assert.deepEqual(
    documentsForConsentEntry({
      entry_status: 'blocked',
      documents: [declinedRequired, revokedOptional],
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
