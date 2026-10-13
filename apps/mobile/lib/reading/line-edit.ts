/**
 * 대본 줄 고치기(SOMA-669, reading.script). 나누기가 틀린 줄 하나의 종류·배역·글을 고친다 — 줄 id 는 그대로라
 * 회차·녹음·외운 줄이 이어진다. 화면(대본 전체 R3.4의 줄 고치기 시트)이 쓰는 판정만 둔다.
 */
import type { LineKind } from './types.ts';

/** 고치기 시트가 든 줄. 대사만 배역이 있다. */
export type LineDraft = { kind: LineKind; characterId: string | null; text: string };

/** 서버에 보낼 바뀐 항목. 대사가 아니게 바꾸면 배역은 서버가 뺀다. */
export type LineChange = { kind?: LineKind; characterId?: string; text?: string };

/** 바뀐 항목만 모은다. 앞뒤 공백만 다른 글은 바뀐 것이 아니다. 바뀐 게 없으면 null. */
export function linePatch(original: LineDraft, draft: LineDraft): LineChange | null {
  const change: LineChange = {};
  if (draft.kind !== original.kind) change.kind = draft.kind;
  if (draft.kind === 'dialogue' && draft.characterId && (draft.kind !== original.kind || draft.characterId !== original.characterId)) {
    change.characterId = draft.characterId;
  }
  const text = draft.text.trim();
  if (text !== original.text.trim()) change.text = text;
  return Object.keys(change).length ? change : null;
}

/** 서버가 받을 줄인가 — 글이 있고, 대사면 배역을 골랐다. */
export function lineDraftValid(draft: LineDraft): boolean {
  return !!draft.text.trim() && (draft.kind !== 'dialogue' || !!draft.characterId);
}

/** 저장을 켤 수 있는가 — 받을 수 있는 줄이고 바뀐 것이 있다. */
export function canSaveLineDraft(original: LineDraft, draft: LineDraft): boolean {
  return lineDraftValid(draft) && linePatch(original, draft) !== null;
}
