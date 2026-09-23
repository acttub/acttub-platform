/**
 * 보관함 업로드 대기 큐(practice.record). 촬영이 끝나면 기기에 먼저 저장하고 여기 넣어 서버로 올린다 — 올릴 자리
 * 받기 · 올리기 · 마무리 세 단계를 지나면 videos 행(보관함 저장)이 생긴다. 큐는 저장소에 남아 앱을 다시 열어도
 * 이어 올리고, 실패(오프라인)는 기기 파일과 같은 요청 id 를 들고 다시 시도한다. 자리가 만료됐으면(422
 * upload_expired) 같은 요청 id 로 처음부터 다시 올린다. 7일 지난 대기 파일은 버리고 알린다. 총량 초과(video_quota)는
 * 실패로 남겨 정리 뒤 다시 올리고, 크기·길이 거절은 다시 보내도 같아 버린다. 큐는 계정별이다(owner).
 *
 * 압축·크기 재기(prepare)·API·파일 삭제는 넣어 받는다 — 네이티브 없이 성립한다.
 */
import { ApiError, NetworkError, RequestAbortError } from '../api-request.ts';
import type { Video, VideoIntentResponse } from './types.ts';
import { videoErrorCodeOf } from './video-checks.ts';

export const LIBRARY_QUEUE_KEY = 'acttub.library.uploadQueue';
export const LIBRARY_QUEUE_TTL_MS = 7 * 86_400_000;

export type QueuedVideoStatus = 'queued' | 'uploading' | 'failed';

export type QueuedVideo = {
  /** 기기 안 항목 id */
  id: string;
  owner: string;
  requestId: string;
  /** 기기 보관 복사본(원본). 올릴 때는 prepare 가 줄인 파일을 만든다. */
  uri: string;
  contentType: string;
  /** 기기가 잰 길이. 모르면 null — prepare 가 잰다. */
  durationMs: number | null;
  createdAt: number;
  intentId: string | null;
  intentExpiresAt: string | null;
  status: QueuedVideoStatus;
  lastError: string | null;
};

export type PreparedUpload = { uri: string; byteSize: number; contentType: string; durationMs?: number | null };

export type UploadQueueDependencies = {
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  /** 올릴 파일을 만든다(압축·크기 검사). 한도를 넘으면 code 가 video_too_large·video_too_long 인 오류를 던진다. */
  prepare: (entry: QueuedVideo) => Promise<PreparedUpload>;
  intent: (entry: QueuedVideo, prepared: PreparedUpload) => Promise<VideoIntentResponse>;
  put: (uploadUrl: string, uri: string, contentType: string) => Promise<'uploaded' | 'cancelled'>;
  complete: (intentId: string, requestId: string) => Promise<Video>;
  /** 올리려고 만든 임시 파일을 지운다(선택). */
  cleanup?: (prepared: PreparedUpload, entry: QueuedVideo) => Promise<void>;
  /** 없는 파일이어도 던지지 않는다. */
  deleteFile: (uri: string) => Promise<void>;
  now?: () => number;
  onChange?: () => void;
  onUploaded?: (entry: QueuedVideo, video: Video) => void;
  onDiscarded?: (entries: QueuedVideo[]) => void;
  onFailed?: (entry: QueuedVideo, code: string) => void;
};

export type FlushResult = { uploaded: number; failed: number; discarded: number };

function isConnection(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RequestAbortError || (error instanceof ApiError && error.status >= 500);
}

/** 다시 보내도 같은 답인 거절 — 항목을 버린다. */
function isPermanent(error: unknown): boolean {
  const code = videoErrorCodeOf(error);
  if (code === 'video_too_large' || code === 'video_too_long' || code === 'video_not_ready' || code === 'request_fingerprint_mismatch') return true;
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

export function createUploadQueue(deps: UploadQueueDependencies) {
  const now = deps.now ?? Date.now;
  const flushing = new Map<string, Promise<FlushResult>>();

  async function read(): Promise<QueuedVideo[]> {
    try {
      const raw = await deps.storage.getItem(LIBRARY_QUEUE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? (list as QueuedVideo[]) : [];
    } catch {
      return [];
    }
  }

  async function write(list: QueuedVideo[]): Promise<void> {
    if (list.length === 0) await deps.storage.removeItem(LIBRARY_QUEUE_KEY);
    else await deps.storage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(list));
    deps.onChange?.();
  }

  async function patch(id: string, change: Partial<QueuedVideo>): Promise<void> {
    const list = await read();
    await write(list.map((e) => (e.id === id ? { ...e, ...change } : e)));
  }

  async function drop(id: string, uri: string | null): Promise<void> {
    const list = await read();
    await write(list.filter((e) => e.id !== id));
    if (uri) await deps.deleteFile(uri).catch(() => undefined);
  }

  function intentAlive(entry: QueuedVideo): boolean {
    if (!entry.intentId || !entry.intentExpiresAt) return false;
    const at = Date.parse(entry.intentExpiresAt);
    return Number.isNaN(at) ? false : at - 60_000 > now();
  }

  /** 한 항목을 끝까지. 결과: uploaded · retry(남김) · dropped. */
  async function uploadOne(entry: QueuedVideo): Promise<'uploaded' | 'retry' | 'dropped'> {
    let prepared: PreparedUpload;
    try {
      prepared = await deps.prepare(entry);
    } catch (error) {
      const code = videoErrorCodeOf(error) ?? 'prepare_failed';
      if (isPermanent(error) || code === 'prepare_failed') {
        deps.onFailed?.(entry, code);
        await drop(entry.id, entry.uri);
        return 'dropped';
      }
      await patch(entry.id, { status: 'failed', lastError: code });
      return 'retry';
    }
    try {
      let current = entry;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!intentAlive(current)) {
          const intent = await deps.intent(current, prepared);
          await patch(current.id, { intentId: intent.intent_id, intentExpiresAt: intent.expires_at, status: 'uploading', lastError: null });
          current = { ...current, intentId: intent.intent_id, intentExpiresAt: intent.expires_at, status: 'uploading' };
          const put = await deps.put(intent.upload_url, prepared.uri, prepared.contentType);
          if (put === 'cancelled') {
            await patch(current.id, { status: 'queued' });
            return 'retry';
          }
        }
        try {
          const video = await deps.complete(current.intentId!, current.requestId);
          await drop(current.id, null);
          deps.onUploaded?.(current, video);
          return 'uploaded';
        } catch (error) {
          if (videoErrorCodeOf(error) === 'upload_expired' && attempt === 0) {
            // 마무리 전에 앱이 죽어 자리가 만료됐다 — 같은 요청 id 로 처음부터 다시 올린다.
            await patch(current.id, { intentId: null, intentExpiresAt: null });
            current = { ...current, intentId: null, intentExpiresAt: null };
            continue;
          }
          throw error;
        }
      }
      await patch(entry.id, { status: 'queued' });
      return 'retry';
    } catch (error) {
      if (isPermanent(error)) {
        deps.onFailed?.(entry, videoErrorCodeOf(error) ?? 'rejected');
        await drop(entry.id, entry.uri);
        return 'dropped';
      }
      const code = videoErrorCodeOf(error);
      if (code === 'video_quota') {
        // 기존은 보존되고 이 항목만 실패로 남는다 — 보관함을 정리한 뒤 다시 올린다.
        await patch(entry.id, { status: 'failed', lastError: code });
        return 'retry';
      }
      await patch(entry.id, { status: isConnection(error) ? 'queued' : 'failed', lastError: code ?? (error instanceof Error ? error.name : 'error') });
      return 'retry';
    } finally {
      await deps.cleanup?.(prepared, entry).catch(() => undefined);
    }
  }

  async function runFlush(owner: string): Promise<FlushResult> {
    const result: FlushResult = { uploaded: 0, failed: 0, discarded: 0 };
    let list = await read();
    const cutoff = now() - LIBRARY_QUEUE_TTL_MS;
    const stale = list.filter((e) => e.owner === owner && e.createdAt < cutoff);
    if (stale.length > 0) {
      await Promise.allSettled(stale.map((e) => deps.deleteFile(e.uri)));
      list = list.filter((e) => !stale.includes(e));
      await write(list);
      result.discarded += stale.length;
      deps.onDiscarded?.(stale);
    }
    const mine = list.filter((e) => e.owner === owner);
    for (const entry of mine) {
      const outcome = await uploadOne(entry);
      if (outcome === 'uploaded') result.uploaded += 1;
      else if (outcome === 'dropped') result.failed += 1;
      else {
        result.failed += 1;
        // 연결이 끊겼으면 나머지도 실패할 것이다 — 다음 flush 로 미룬다.
        const latest = (await read()).find((e) => e.id === entry.id);
        if (latest?.status === 'queued') {
          result.failed += mine.length - mine.indexOf(entry) - 1;
          break;
        }
      }
    }
    return result;
  }

  return {
    async enqueue(entry: Omit<QueuedVideo, 'intentId' | 'intentExpiresAt' | 'status' | 'lastError'> & Partial<Pick<QueuedVideo, 'status' | 'lastError'>>): Promise<QueuedVideo> {
      const full: QueuedVideo = { intentId: null, intentExpiresAt: null, status: 'queued', lastError: null, ...entry };
      const list = await read();
      await write([...list.filter((e) => e.id !== full.id), full]);
      return full;
    },
    /** 그 계정의 대기 항목(오래된 것부터). */
    async pending(owner: string): Promise<QueuedVideo[]> {
      return (await read()).filter((e) => e.owner === owner);
    },
    async remove(id: string): Promise<void> {
      const list = await read();
      const target = list.find((e) => e.id === id);
      await drop(id, target?.uri ?? null);
    },
    /** 계정별로 한 번에 하나씩만 돈다. 도는 중에 부르면 같은 결과를 기다린다. */
    flush(owner: string): Promise<FlushResult> {
      const running = flushing.get(owner);
      if (running) return running;
      const next = runFlush(owner).finally(() => {
        if (flushing.get(owner) === next) flushing.delete(owner);
      });
      flushing.set(owner, next);
      return next;
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;
