import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCoachSession } from '../lib/practice/coach.ts';

function api(conversation, over = {}) {
  const calls = { get: [], start: [], note: [] };
  return {
    calls,
    api: {
      getPractice: async () => ({ conversation_id: conversation ? 'c1' : null }),
      getConversation: async (id) => {
        calls.get.push(id);
        return conversation;
      },
      getPracticeNote: async (id) => {
        calls.note.push(id);
        return { id: 'n1', title: '노트' };
      },
      startConversation: async (id, requestId, stream) => {
        calls.start.push({ id, requestId, stream });
        return { conversation: { ...conversation, messages: [{ turn_index: 0, role: 'coach', text: '첫 질문' }] }, message: null, note: null };
      },
      ...over,
    },
  };
}

const open = (messages) => ({ id: 'c1', status: 'open', messages });

test('열린 대화에 코치 말이 없으면 시작 요청을 한 번 보내 첫 질문을 받는다(SOMA-780)', async () => {
  const { api: fake, calls } = api(open([]));
  const stream = { onDelta() {} };
  const result = await loadCoachSession(fake, 'p1', 'r1', 'c1', stream);
  assert.equal(calls.get.length, 1);
  assert.equal(calls.start.length, 1);
  assert.deepEqual(calls.start[0], { id: 'p1', requestId: 'r1', stream });
  assert.equal(result.conversation.messages[0].text, '첫 질문');
});

test('회차에서 대화 id 를 읽어 온 경우도 코치 말이 없으면 시작 요청을 보낸다', async () => {
  const { api: fake, calls } = api(open([]));
  await loadCoachSession(fake, 'p1', 'r1', null);
  assert.equal(calls.start.length, 1);
});

test('코치 말이 이미 있으면 읽기만 하고 시작 요청을 보내지 않는다', async () => {
  const { api: fake, calls } = api(open([{ turn_index: 0, role: 'coach', text: '질문' }]));
  const result = await loadCoachSession(fake, 'p1', 'r1', 'c1');
  assert.equal(calls.start.length, 0);
  assert.equal(result.conversation.messages.length, 1);
});

test('닫힌 대화는 메시지가 없어도 시작 요청을 보내지 않는다', async () => {
  const { api: fake, calls } = api({ id: 'c1', status: 'closed', messages: [] });
  await loadCoachSession(fake, 'p1', 'r1', 'c1');
  assert.equal(calls.start.length, 0);
});

test('대화가 아직 없으면 예전처럼 시작 요청만 보낸다(읽기 없음)', async () => {
  const { api: fake, calls } = api(null, { getPractice: async () => ({ conversation_id: null }) });
  await loadCoachSession(fake, 'p1', 'r1');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.start.length, 1);
});

test('시작 요청이 실패하면 그대로 던져 화면의 「다시 연결」로 넘기고 스스로 되풀이하지 않는다', async () => {
  const { api: fake, calls } = api(open([]), {
    startConversation: async () => {
      calls.start.push(1);
      throw Object.assign(new Error('x'), { status: 409 });
    },
  });
  await assert.rejects(loadCoachSession(fake, 'p1', 'r1', 'c1'));
  assert.equal(calls.start.length, 1);
  assert.equal(calls.get.length, 1);
});
