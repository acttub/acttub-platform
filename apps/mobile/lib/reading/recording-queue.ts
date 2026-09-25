/**
 * 녹음 올리기 큐(reading.recording). 내 차례가 끝나면 파일과 요청 id 를 여기에 넣고, 회차의 진행과 분리해 하나씩
 * 올린다. 올리기 실패(오프라인, 503 변환 실패)면 파일과 요청 id 를 들고 있다가 다시 시도하고, 회차가 끝난 뒤에도·
 * 앱을 다시 열어도 큐가 남는다(AsyncStorage). 7일 지난 파일은 버린다. 같은 요청 id 의 재전송은 서버가 같은
 * 결과로 답한다(멱등). 404(대본·회차가 지워짐)·422(한도·구간 밖 줄)·403 은 다시 보내도 같아 버린다.
 *
 * 네이티브 모듈 없이 성립하도록 저장소·올리기·파일 삭제를 넣어 받는다.
 */
import { ApiError, NetworkError, RequestAbortError } from '../api-request.ts';
import type { SessionRecording } from './types.ts';

export const RECORDING_QUEUE_KEY = 'acttub.reading.recordingQueue';
export const RECORDING_QUEUE_TTL_MS = 7 * 86_400_000;

export type QueuedRecording = {
  requestId: string;
  sessionId: string;
  lineId: string;
  attemptNo: number;
  uri: string;
  contentType: string;
  durationMs: number;
  transcript: string | null;
  transcriptSource: 'stt' | 'none';
  matched: boolean | null;
  createdAt: number;
};

export type RecordingQueueDependencies = {
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  upload: (entry: QueuedRecording) => Promise<Pick<SessionRecording, 'id' | 'line_id' | 'attempt_no'> | unknown>;
  /** 없는 파일이어도 던지지 않는다. */
  deleteFile: (uri: string) => Promise<void>;
  now?: () => number;
  onUploaded?: (entry: QueuedRecording) => void;
  onDropped?: (entry: QueuedRecording, reason: unknown) => void;
};

export type FlushResult = { sent: number; dropped: number; failed: number };

function isPermanent(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error instanceof NetworkError || error instanceof RequestAbortError) return false;
  return error.status === 404 || error.status === 422 || error.status === 403 || error.status === 409;
}

export function createRecordingQueue(deps: RecordingQueueDependencies) {
  const now = deps.now ?? Date.now;
  let flushing: Promise<FlushResult> | null = null;

  async function read(): Promise<QueuedRecording[]> {
    try {
      const raw = await deps.storage.getItem(RECORDING_QUEUE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? (list as QueuedRecording[]) : [];
    } catch {
      return [];
    }
  }

  async function write(list: QueuedRecording[]): Promise<void> {
    if (list.length === 0) await deps.storage.removeItem(RECORDING_QUEUE_KEY);
    else await deps.storage.setItem(RECORDING_QUEUE_KEY, JSON.stringify(list));
  }

  async function runFlush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0, failed: 0 };
    let list = await read();
    const cutoff = now() - RECORDING_QUEUE_TTL_MS;
    // 7일 지난 파일은 버린다.
    const stale = list.filter((e) => e.createdAt < cutoff);
    if (stale.length > 0) {
      await Promise.allSettled(stale.map((e) => deps.deleteFile(e.uri)));
      list = list.filter((e) => e.createdAt >= cutoff);
      result.dropped += stale.length;
      await write(list);
    }
    while (list.length > 0) {
      const entry = list[0];
      try {
        await deps.upload(entry);
        result.sent += 1;
        deps.onUploaded?.(entry);
      } catch (error) {
        if (!isPermanent(error)) {
          // 오프라인·503 — 파일과 요청 id 를 들고 있다가 다음에 같은 id 로 다시 보낸다.
          result.failed += list.length;
          break;
        }
        result.dropped += 1;
        deps.onDropped?.(entry, error);
      }
      await deps.deleteFile(entry.uri).catch(() => undefined);
      list = list.slice(1);
      await write(list);
    }
    return result;
  }

  return {
    async enqueue(entry: QueuedRecording): Promise<void> {
      const list = await read();
      await write([...list.filter((e) => e.requestId !== entry.requestId), entry]);
    },
    /** 한 번에 하나씩만 돈다. 도는 중에 부르면 그 결과를 함께 기다린다. */
    flush(): Promise<FlushResult> {
      if (flushing) return flushing;
      flushing = runFlush().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    pending(): Promise<QueuedRecording[]> {
      return read();
    },
  };
}

export type RecordingQueue = ReturnType<typeof createRecordingQueue>;
