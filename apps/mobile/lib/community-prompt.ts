/**
 * 연습을 마친 화면에서 게시판 글쓰기로 이어 주기(SOMA-1054) — 「상대역 구하기」·「물어보기」가 미리 채울 분류·제목·본문.
 *
 * 서버 글쓰기 API는 그대로다(필드 추가 없음). 글쓰기 분류는 자유·질문·홍보 셋뿐이라(V88 — 상대역 구함은 꺼졌다) 상대역 글은
 * 「자유」에 제목 머리 「[상대역 구함]」으로 올린다. 연락처는 글에 적을 수 없으니(422 community_contact_info) 연락은 글쓴이 이름 →
 * 메시지로 받는다. 챌린지는 작품 대신 그 주 대사 한 줄을 넣는다.
 */

import { BODY_MAX, TITLE_MAX } from './community.ts';
import { translate } from './i18n.ts';

export type CommunityPromptFrom = 'reading_done' | 'challenge_done';
export type CommunityPromptKind = 'partner' | 'question';
/** community_post_create 의 from·kind — 게시판에서 바로 쓴 글은 board·none 이다. */
export type CommunityPostFrom = CommunityPromptFrom | 'board';
export type CommunityPostKind = CommunityPromptKind | 'none';

/** 리딩은 작품(대본 제목)·내 배역·장면, 챌린지는 그 주 대사 한 줄. */
export type CommunityPromptInput = { work?: string | null; role?: string | null; scene?: string | null; line?: string | null };

export type CommunityPromptDraft = { category: string; title: string; body: string };

/** 제목에 넣는 대사는 이만큼만 — 나머지는 본문에 그대로 둔다. */
const TITLE_LINE_MAX = 30;

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function communityPromptDraft(kind: CommunityPromptKind, input: CommunityPromptInput): CommunityPromptDraft {
  const line = clean(input.line);
  const work = clean(input.work);
  const role = clean(input.role);
  const scene = clean(input.scene);
  // 챌린지는 대사가 작품 자리에 든다. 제목에는 짧게, 본문에는 다 넣는다.
  const subject = line ? `“${clip(line, TITLE_LINE_MAX)}”` : work;
  const sourceLine = line
    ? translate('communityPrompt.lineLine', { value: `“${line}”` })
    : work
      ? translate('communityPrompt.workLine', { value: work })
      : '';

  if (kind === 'partner') {
    const title = role
      ? translate('communityPrompt.partnerTitle', { subject, role })
      : translate('communityPrompt.partnerTitleNoRole', { subject });
    const body = [
      translate('communityPrompt.partnerIntro'),
      sourceLine,
      role ? translate('communityPrompt.roleLine', { value: role }) : '',
      translate('communityPrompt.whenLine'),
    ]
      .filter(Boolean)
      .join('\n');
    return { category: 'free', title: clip(title, TITLE_MAX), body: clip(body, BODY_MAX) };
  }

  const title = subject ? translate('communityPrompt.questionTitle', { subject }) : translate('communityPrompt.questionTitleBare');
  const first = line
    ? sourceLine
    : [
        scene && scene !== work ? translate('communityPrompt.sceneLine', { value: scene }) : '',
        role ? translate('communityPrompt.questionRoleLine', { value: role }) : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return { category: 'question', title: clip(title, TITLE_MAX), body: first ? clip(`${first}\n`, BODY_MAX) : '' };
}

/** 게시판은 회원 전용이다(게스트 403 member_only) — 회원이 아니면 이어 주는 버튼을 숨긴다. */
export function canWriteCommunity(me: { account_type?: string | null } | null | undefined): boolean {
  return me?.account_type === 'member';
}

/** 글쓰기 화면이 받은 from·kind 를 이벤트 값으로 — 모르는 값이면 게시판에서 바로 쓴 글이다. */
export function postOrigin(from: string | null | undefined, kind: string | null | undefined): { from: CommunityPostFrom; kind: CommunityPostKind } {
  const f: CommunityPostFrom = from === 'reading_done' || from === 'challenge_done' ? from : 'board';
  const k: CommunityPostKind = f !== 'board' && (kind === 'partner' || kind === 'question') ? kind : 'none';
  return { from: f, kind: k };
}
