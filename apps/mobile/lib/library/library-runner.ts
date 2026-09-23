import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { deleteDeviceFile, keepDeviceFile, libraryDirectory, trackTemporaryDeviceFile } from '@/lib/account-files';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { compressVideo } from '@/lib/compress';
import { createUploadQueue, type QueuedVideo, type UploadQueue } from '@/lib/library/upload-queue';
import { VIDEO_MAX_MS, checkVideoForUpload } from '@/lib/library/video-checks';
import { newRequestId } from '@/lib/request-id';

/**
 * 보관함 업로드 큐의 실행 배선(practice.record). 무엇을 언제 올리고 버리는지는 upload-queue 가 정하고, 여기는
 * 저장소·압축·API·파일을 넣어 준다. 촬영이 끝나면 기기(문서 폴더 archive)에 먼저 복사해 두고 큐에 넣는다.
 * 올릴 때는 720px 로 줄인 업로드본을 만들어 크기를 검사하고(100MiB), 원본은 서버에 두지 않는다.
 * 확정된 영상의 기기 복사본은 남겨 두어(local copies) 재생·다음 단계에 쓰고, 탈퇴 때 폴더째 지운다.
 */
const LOCAL_COPIES_KEY = 'acttub.library.localCopies';

let queue: UploadQueue | null = null;
const listeners = new Set<() => void>();
let lastDiscarded = 0;
/** 이번 실행에서 확정된 대기 항목 → 영상 id. 새 연습이 "올리는 중"을 기다렸다 시작할 때 쓴다. */
const confirmedVideos = new Map<string, string>();

function rejection(code: string): ApiError {
  return new ApiError(422, code, code, code, { detail: code });
}

function fileSize(uri: string): number {
  try {
    const f = new File(uri);
    return f.exists ? (f.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

async function measureDuration(uri: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const compressor = require('react-native-compressor') as typeof import('react-native-compressor');
    const meta = await compressor.getVideoMetaData(uri);
    return typeof meta?.duration === 'number' && meta.duration > 0 ? Math.round(meta.duration * 1000) : null;
  } catch {
    return null;
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

function instance(): UploadQueue {
  if (queue) return queue;
  queue = createUploadQueue({
    storage: AsyncStorage,
    prepare: async (entry) => {
      const durationMs = entry.durationMs ?? (await measureDuration(entry.uri));
      if (durationMs !== null && durationMs > VIDEO_MAX_MS) throw rejection('video_too_long');
      const compressed = await compressVideo(entry.uri);
      if (compressed.kind === 'cancelled') throw new ApiError(0, 'cancelled', 'cancelled');
      if (compressed.uri !== entry.uri) await trackTemporaryDeviceFile(compressed.uri).catch(() => undefined);
      const byteSize = compressed.compressedBytes ?? fileSize(compressed.uri);
      const check = checkVideoForUpload({ byteSize, durationMs });
      if (!check.ok) throw rejection(check.code === 'video_empty' ? 'video_too_large' : check.code);
      return { uri: compressed.uri, byteSize, contentType: 'video/mp4', durationMs };
    },
    intent: (entry, prepared) =>
      api.createVideoIntent({
        request_id: entry.requestId,
        content_type: prepared.contentType,
        byte_size: prepared.byteSize,
        // 길이를 끝내 모르면 1초로 보낸다 — 서버가 실제 길이를 다시 잰다. (압축 모듈이 없는 빌드에서만 생긴다)
        duration_ms: entry.durationMs ?? prepared.durationMs ?? 1_000,
      }),
    put: (url, uri, contentType) => api.startUploadToUrl(url, uri, contentType).result.then((r) => r.kind),
    complete: (intentId, requestId) => api.completeVideoIntent(intentId, requestId),
    cleanup: async (prepared, entry) => {
      if (prepared.uri !== entry.uri) await deleteDeviceFile(prepared.uri).catch(() => undefined);
    },
    deleteFile: deleteDeviceFile,
    onChange: notify,
    onUploaded: (entry, video) => {
      confirmedVideos.set(entry.id, video.id);
      void rememberLocalCopy(video.id, entry.uri).finally(notify);
    },
    onDiscarded: (entries) => {
      lastDiscarded += entries.length;
      notify();
    },
    onFailed: () => notify(),
  });
  return queue;
}

async function readCopies(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_COPIES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function rememberLocalCopy(videoId: string, uri: string): Promise<void> {
  try {
    const all = await readCopies();
    all[videoId] = uri;
    await AsyncStorage.setItem(LOCAL_COPIES_KEY, JSON.stringify(all));
  } catch {}
}

/** 확정된 영상의 기기 복사본. 없거나 파일이 사라졌으면 null. */
export async function localCopyFor(videoId: string): Promise<string | null> {
  const uri = (await readCopies())[videoId];
  if (!uri) return null;
  return fileSize(uri) > 0 ? uri : null;
}

export async function forgetLocalCopy(videoId: string): Promise<void> {
  try {
    const all = await readCopies();
    const uri = all[videoId];
    delete all[videoId];
    await AsyncStorage.setItem(LOCAL_COPIES_KEY, JSON.stringify(all));
    if (uri) await deleteDeviceFile(uri).catch(() => undefined);
  } catch {}
}

export function onLibraryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type SaveOutcome = { kind: 'queued'; entry: QueuedVideo } | { kind: 'rejected'; code: 'video_too_long' | 'video_empty' };

/**
 * 촬영·선택한 영상을 기기에 먼저 저장하고(문서 폴더로 복사) 업로드 대기 큐에 넣는다(A2.1 "기기에 저장 · 업로드 대기").
 * 5분을 넘는 길이는 여기서 거른다. 크기는 압축한 뒤 큐가 검사한다.
 */
export async function saveRecordingToLibrary(input: { uri: string; durationMs: number | null; owner: string }): Promise<SaveOutcome> {
  if (input.durationMs !== null && input.durationMs > VIDEO_MAX_MS) return { kind: 'rejected', code: 'video_too_long' };
  const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let uri = input.uri;
  try {
    const dest = new File(libraryDirectory(), `${id}.mp4`);
    new File(input.uri).copy(dest);
    uri = dest.uri;
  } catch {
    // 복사 실패 — 원본을 그대로 가리킨다(캐시가 지워지면 큐가 파일 없음으로 버린다)
  }
  if (fileSize(uri) <= 0) return { kind: 'rejected', code: 'video_empty' };
  void keepDeviceFile(uri);
  const entry = await instance().enqueue({
    id,
    owner: input.owner,
    requestId: newRequestId(),
    uri,
    contentType: 'video/mp4',
    durationMs: input.durationMs,
    createdAt: Date.now(),
  });
  notify();
  void flushLibraryUploads(input.owner);
  return { kind: 'queued', entry };
}

/** 밀린 업로드를 올린다. 실패한 것은 남아 다음에 다시 시도한다. */
export async function flushLibraryUploads(owner: string): Promise<void> {
  try {
    await instance().flush(owner);
  } finally {
    notify();
  }
}

export function pendingLibraryUploads(owner: string): Promise<QueuedVideo[]> {
  return instance().pending(owner);
}

export async function removePendingUpload(id: string): Promise<void> {
  await instance().remove(id);
  notify();
}

/** 옛 보관함 옮기기(legacy-archive)가 항목을 넣을 때 쓴다. */
export function enqueueLibraryUpload(entry: Parameters<UploadQueue['enqueue']>[0]): Promise<QueuedVideo> {
  return instance().enqueue(entry);
}

/** 올리는 중이던 항목이 확정돼 받은 영상 id. 아직이면 null. */
export function confirmedVideoFor(pendingId: string): string | null {
  return confirmedVideos.get(pendingId) ?? null;
}

/** 7일이 지나 버린 대기 파일 수를 한 번 가져가며 비운다(안내용). */
export function takeDiscardedCount(): number {
  const n = lastDiscarded;
  lastDiscarded = 0;
  return n;
}
