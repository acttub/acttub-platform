/**
 * 보관함(A2.2·A2.3, practice.library)의 표시 규칙 — 서버 영상과 기기의 업로드 대기 항목을 한 목록으로 펴고, 상태·사용처
 * 문구와 삭제 판정을 만든다. 예시 영상은 섞지 않는다.
 */
import type { QueuedVideo } from './upload-queue.ts';
import type { Video, VideoFilter, VideoUsage } from './types.ts';
import { translate as t } from '../i18n.ts';

const DAY_MS = 86_400_000;

export type LibraryItem =
  | { kind: 'pending'; id: string; key: string; uri: string; durationMs: number | null; createdAt: number; favorite: false; entry: QueuedVideo }
  | { kind: 'video'; id: string; key: string; uri: null; durationMs: number; createdAt: number; favorite: boolean; video: Video };

export function mergeLibrary(input: { videos: Video[]; pending: QueuedVideo[]; filter: VideoFilter; now: number }): LibraryItem[] {
  const since = input.now - 7 * DAY_MS;
  const pending: LibraryItem[] = [...input.pending]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((e) => ({ kind: 'pending', id: e.id, key: `p:${e.id}`, uri: e.uri, durationMs: e.durationMs, createdAt: e.createdAt, favorite: false, entry: e }));
  const videos: LibraryItem[] = [...input.videos]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((v) => ({ kind: 'video', id: v.id, key: `v:${v.id}`, uri: null, durationMs: v.duration_ms, createdAt: Date.parse(v.created_at), favorite: v.favorite, video: v }));
  const all = [...pending, ...videos];
  if (input.filter === 'recent7') return all.filter((i) => i.createdAt >= since);
  if (input.filter === 'favorite') return all.filter((i) => i.kind === 'video' && i.favorite);
  return all;
}

/** "기기에 저장 · 업로드 대기" / "보관함 저장" / "업로드 실패 · 다시 시도" / "재생할 수 없어요" */
export function statusLabel(item: LibraryItem): string {
  if (item.kind === 'pending') {
    if (item.entry.status === 'failed') return t('archive.statusFailed');
    if (item.entry.status === 'uploading') return t('archive.statusUploading');
    return t('archive.statusPending');
  }
  return item.video.purged_at ? t('archive.statusPurged') : t('archive.statusSaved');
}

/** "회차 n개 · 챌린지 참여작 n개" */
export function usageLabel(usage: VideoUsage): string {
  if (usage.practice_count === 0 && usage.entry_count === 0) return t('archive.usageNone');
  return t('archive.usage', { practices: usage.practice_count, entries: usage.entry_count });
}

export type DeleteDecision = { kind: 'delete' } | { kind: 'in_use'; usage: string; canPurge: boolean };

/** 참조가 없을 때만 지운다. 참조가 있으면 사용처와 "파일만 파기"(아직 파기하지 않았을 때)를 안내한다. */
export function deleteDecision(video: Pick<Video, 'usage' | 'purged_at'>): DeleteDecision {
  const inUse = video.usage.practice_count > 0 || video.usage.entry_count > 0;
  if (!inUse) return { kind: 'delete' };
  return { kind: 'in_use', usage: usageLabel(video.usage), canPurge: video.purged_at === null };
}
