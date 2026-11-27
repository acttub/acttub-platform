import assert from 'node:assert/strict';
import test from 'node:test';

import { TITLE_MAX } from '../lib/community.ts';
import { canWriteCommunity, communityPromptDraft, postOrigin } from '../lib/community-prompt.ts';

test('리딩 상대역 구하기는 자유 칸에 작품·내 배역을 제목과 본문 서식으로 채운다', () => {
  assert.deepEqual(communityPromptDraft('partner', { work: '갈매기', role: '니나', scene: '1막' }), {
    category: 'free',
    title: '[상대역 구함] 갈매기 · 니나',
    body: '같이 리딩할 상대역을 구해요.\n작품: 갈매기\n제 배역: 니나\n원하는 방법·시간: ',
  });
});

test('배역이 없으면 제목 뒤 배역과 본문 배역 줄을 뺀다', () => {
  assert.deepEqual(communityPromptDraft('partner', { work: '갈매기', role: '' }), {
    category: 'free',
    title: '[상대역 구함] 갈매기',
    body: '같이 리딩할 상대역을 구해요.\n작품: 갈매기\n원하는 방법·시간: ',
  });
});

test('리딩 물어보기는 질문 칸에 「작품 질문」 제목, 본문 첫 줄에 장면·배역을 넣는다', () => {
  assert.deepEqual(communityPromptDraft('question', { work: '갈매기', role: '니나, 트레플레프', scene: '1막 2장' }), {
    category: 'question',
    title: '갈매기 질문',
    body: '장면: 1막 2장 · 배역: 니나, 트레플레프\n',
  });
  // 장면이 없어 대본 제목과 같으면 장면은 다시 적지 않는다.
  assert.equal(communityPromptDraft('question', { work: '갈매기', role: '니나', scene: '갈매기' }).body, '배역: 니나\n');
  assert.deepEqual(communityPromptDraft('question', {}), { category: 'question', title: '연기 질문', body: '' });
});

test('챌린지는 작품 대신 그 주 대사를 넣고, 제목의 긴 대사는 줄이되 본문은 다 둔다', () => {
  const long = '나는 갈매기야. 아니, 그게 아니야. 나는 배우야. 이제 알아, 이해해.';
  const partner = communityPromptDraft('partner', { line: long });
  assert.equal(partner.category, 'free');
  assert.match(partner.title, /^\[상대역 구함\] “.+…”$/);
  assert.ok([...partner.title].length <= TITLE_MAX);
  assert.equal(partner.body, `같이 리딩할 상대역을 구해요.\n대사: “${long}”\n원하는 방법·시간: `);

  const question = communityPromptDraft('question', { line: '  여기서\n쉬어요  ', work: '무시' });
  assert.deepEqual(question, { category: 'question', title: '“여기서 쉬어요” 질문', body: '대사: “여기서 쉬어요”\n' });
});

test('회원만 글을 쓸 수 있다', () => {
  assert.equal(canWriteCommunity({ account_type: 'member' }), true);
  assert.equal(canWriteCommunity({ account_type: 'guest' }), false);
  assert.equal(canWriteCommunity(null), false);
  assert.equal(canWriteCommunity(undefined), false);
});

test('글쓰기 이벤트의 from·kind — 모르는 값과 게시판에서 바로 쓴 글은 board·none', () => {
  assert.deepEqual(postOrigin('reading_done', 'partner'), { from: 'reading_done', kind: 'partner' });
  assert.deepEqual(postOrigin('challenge_done', 'question'), { from: 'challenge_done', kind: 'question' });
  assert.deepEqual(postOrigin('challenge_done', 'x'), { from: 'challenge_done', kind: 'none' });
  assert.deepEqual(postOrigin(undefined, 'partner'), { from: 'board', kind: 'none' });
  assert.deepEqual(postOrigin('home', undefined), { from: 'board', kind: 'none' });
});
