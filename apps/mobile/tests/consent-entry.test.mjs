import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consentPreferencesForEntry,
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
  title: '개인정보 처리방침',
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
    readPending: async () => ({ documents: [] }),
  });

  assert.deepEqual(await session.readOnce(), allowedEntry);
  assert.deepEqual(await session.readOnce(), allowedEntry);
  assert.equal(entryReads, 1);
});

test('새 로그인은 구형 서버에서 로그인 응답의 미결정 문서로 안전하게 폴백한다', async () => {
  let pendingReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    },
    readPending: async () => {
      pendingReads += 1;
      return { documents: [] };
    },
  });

  assert.deepEqual(
    await session.readOnce({ fallbackDocuments: [privacyDocument] }),
    {
      entry_status: 'decision_required',
      documents: [{ ...privacyDocument, current_decision: null }],
      undecided_documents: [{ ...privacyDocument, current_decision: null }],
    },
  );
  assert.equal(pendingReads, 0);
});

test('저장 자격 증명 복원은 구형 서버에서 기존 미결정 조회로 폴백한다', async () => {
  let pendingReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    },
    readPending: async () => {
      pendingReads += 1;
      return { documents: [privacyDocument] };
    },
  });

  assert.equal((await session.readOnce()).entry_status, 'decision_required');
  assert.equal(pendingReads, 1);
});

test('동의 진입 조회 실패는 캐시하지 않아 같은 화면에서 다시 시도할 수 있다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      if (entryReads === 1) throw new Error('offline');
      return allowedEntry;
    },
    readPending: async () => ({ documents: [] }),
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
    readPending: async () => ({ documents: [] }),
  });

  assert.equal((await session.readOnce()).entry_status, 'decision_required');
  assert.equal((await session.refresh()).entry_status, 'allowed');
  assert.equal(entryReads, 2);
});

test('기기 캐시와 달라도 서버의 현재 동의 결정으로 설정 값을 만든다', () => {
  assert.deepEqual(
    consentPreferencesForEntry({
      entry_status: 'allowed',
      documents: [
        { ...privacyDocument, current_decision: 'revoked' },
        {
          ...privacyDocument,
          id: 'research-v1',
          required: false,
          current_decision: 'granted',
        },
      ],
      undecided_documents: [],
    }),
    {
      'privacy-v2': false,
      'research-v1': true,
    },
  );
});

test('로그아웃이나 계정 전환은 이전 인증 세션의 진입 판정을 재사용하지 않는다', async () => {
  let entryReads = 0;
  const session = createConsentEntrySession({
    readEntry: async () => {
      entryReads += 1;
      return allowedEntry;
    },
    readPending: async () => ({ documents: [] }),
  });

  await session.readOnce();
  session.clear();
  await session.readOnce();
  assert.equal(entryReads, 2);
});
