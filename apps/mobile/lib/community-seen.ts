import { deviceStorage as storage } from './device-storage.ts';

/**
 * 게시판을 마지막으로 본 시각(SOMA-873) — 「게시판」 옆 빨간 점을 정한다. 계정이 아니라 기기 기준이고,
 * 못 읽거나 못 적어도 흐름은 그대로 간다(점이 한 번 더 보이거나 안 보일 뿐이다).
 */

const SEEN_KEY = 'acttub.community.boardSeenAt';

export async function boardSeenAt(): Promise<string | null> {
  try {
    return await storage().getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** 본 글 가운데 가장 최근 글 시각을 적는다. 이미 더 늦은 시각이 있으면 그대로 둔다. */
export async function markBoardSeen(latestCreatedAt: string): Promise<void> {
  try {
    const prev = await storage().getItem(SEEN_KEY);
    if (prev && Date.parse(prev) >= Date.parse(latestCreatedAt)) return;
    await storage().setItem(SEEN_KEY, latestCreatedAt);
  } catch {
    // 못 적어도 점이 한 번 더 보일 뿐이다.
  }
}
