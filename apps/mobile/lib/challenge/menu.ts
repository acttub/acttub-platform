import { canDelete } from './browse.ts';
import { canBlock } from './moderation.ts';
import { canReact } from './react.ts';

/** 챌린지 상세 머리 오른쪽 칸 — 공유 아이콘 하나이거나 ⋯ 메뉴 하나다. 불러오기 전·실패면 비운다. */
export type DetailHeader =
  | { kind: 'none' }
  | { kind: 'share' }
  | { kind: 'menu'; items: readonly DetailMenuItem[] };
export type DetailMenuItem = 'share' | 'report' | 'delete';

type DetailRole = 'viewer' | 'host_deletable' | 'host_locked';

/**
 * 보는 사람의 역할 → 머리 오른쪽. 내가 연 챌린지는 신고하지 않고, 참여작이 생겨 지울 수 없으면 남는 동작이 공유뿐이라
 * 메뉴 대신 공유 아이콘 하나다. 지우기는 되돌릴 수 없어 메뉴 맨 아래(danger)에 둔다.
 */
const DETAIL_HEADER: Record<DetailRole, DetailHeader> = {
  viewer: { kind: 'menu', items: ['share', 'report'] },
  host_deletable: { kind: 'menu', items: ['share', 'delete'] },
  host_locked: { kind: 'share' },
};

export function detailHeader(challenge: { is_host?: boolean; entry_count: number } | null): DetailHeader {
  if (!challenge) return { kind: 'none' };
  const role: DetailRole = !challenge.is_host ? 'viewer' : canDelete(challenge) ? 'host_deletable' : 'host_locked';
  return DETAIL_HEADER[role];
}

/**
 * 챌린지 재생 ⋯ 메뉴. 좋아요·저장·댓글·공유는 화면에 버튼이 있어 메뉴에 두지 않는다. 남는 것은 신고·차단이고,
 * 각 줄은 그 동작을 할 수 있는 사람에게만 보인다(내 참여작은 신고·차단하지 않고, 내가 연 대사는 신고하지 않는다).
 */
export type PlayMenuItem = 'report_entry' | 'report_challenge' | 'block';

type PlayMenuContext = {
  entry: { is_mine?: boolean; author: { user_id?: string | null } };
  challenge: { is_host?: boolean } | null;
  myId: string | null;
};

const PLAY_MENU: readonly { item: PlayMenuItem; shows: (c: PlayMenuContext) => boolean }[] = [
  { item: 'report_entry', shows: (c) => canReact(c.entry) },
  { item: 'report_challenge', shows: (c) => c.challenge !== null && !c.challenge.is_host },
  { item: 'block', shows: (c) => canBlock({ authorId: c.entry.author.user_id ?? null, myId: c.myId }) },
];

export function playMenuItems(context: PlayMenuContext): PlayMenuItem[] {
  return PLAY_MENU.filter((row) => row.shows(context)).map((row) => row.item);
}
