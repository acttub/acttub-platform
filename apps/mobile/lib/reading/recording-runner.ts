import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { deleteDeviceFile } from '@/lib/account-files';
import { api } from '@/lib/api';
import { checkRecordingFile, fileNameFor } from '@/lib/reading/recording-plan';
import { createRecordingQueue, type QueuedRecording, type RecordingQueue } from '@/lib/reading/recording-queue';

/**
 * 녹음 올리기 큐의 실행 배선(reading.recording). 무엇을 언제 올리고 버리는지는 recording-queue 가 정하고,
 * 여기는 저장소·API·파일 삭제를 넣어 준다. 회차가 끝난 뒤에도, 앱을 다시 열어도(게이트 통과 뒤 flush) 이어서 올린다.
 */
let queue: RecordingQueue | null = null;
const listeners = new Set<(pending: number) => void>();

function instance(): RecordingQueue {
  if (queue) return queue;
  queue = createRecordingQueue({
    storage: AsyncStorage,
    upload: (entry: QueuedRecording) =>
      api.uploadReadingRecording(entry.sessionId, {
        request_id: entry.requestId,
        line_id: entry.lineId,
        attempt_no: entry.attemptNo,
        duration_ms: entry.durationMs,
        transcript: entry.transcript,
        transcript_source: entry.transcriptSource,
        matched: entry.matched,
        audio: { uri: entry.uri, name: fileNameFor(entry.contentType), type: entry.contentType },
      }),
    deleteFile: deleteDeviceFile,
    onUploaded: () => notify(),
    onDropped: () => notify(),
  });
  return queue;
}

async function notify(): Promise<void> {
  const pending = (await instance().pending()).length;
  for (const fn of listeners) fn(pending);
}

export function onRecordingQueueChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type LineRecordingInput = Omit<QueuedRecording, 'createdAt'>;

export type EnqueueOutcome = { kind: 'queued' } | { kind: 'rejected'; reason: 'too_large' | 'too_long' | 'empty' | 'missing' };

/**
 * 내 차례가 끝난 줄의 녹음을 큐에 넣고 올리기를 시작한다. 10,000,000바이트를 넘거나 비어 있으면 보내지 않고
 * 파일을 지운다("이 줄 녹음은 너무 길어 저장하지 않았어요"). 올리기는 진행을 막지 않는다.
 */
export async function enqueueLineRecording(input: LineRecordingInput): Promise<EnqueueOutcome> {
  let byteSize = 0;
  try {
    const file = new File(input.uri);
    byteSize = file.exists ? (file.size ?? 0) : 0;
  } catch {
    byteSize = 0;
  }
  if (byteSize === 0) {
    await deleteDeviceFile(input.uri).catch(() => undefined);
    return { kind: 'rejected', reason: 'missing' };
  }
  const check = checkRecordingFile({ byteSize, durationMs: input.durationMs });
  if (!check.ok) {
    await deleteDeviceFile(input.uri).catch(() => undefined);
    return { kind: 'rejected', reason: check.reason };
  }
  await instance().enqueue({ ...input, createdAt: Date.now() });
  await notify();
  void flushRecordingUploads();
  return { kind: 'queued' };
}

/** 밀린 녹음을 올린다. 실패한 것은 남아 다음에 다시 시도한다. */
export async function flushRecordingUploads(): Promise<void> {
  try {
    await instance().flush();
  } finally {
    await notify().catch(() => undefined);
  }
}

export function pendingRecordingUploads(): Promise<number> {
  return instance()
    .pending()
    .then((list) => list.length);
}
