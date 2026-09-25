"use client";

/**
 * 내 차례마다 한 줄을 녹음해 올리기 큐에 넣는다(reading.recording). 내 차례(me)에만 켜고 상대 재생·일시정지·나가기에
 * 꺼진다. 줄이 끝나면 request_id·attempt_no·전사·대조와 함께 큐로 간다 — 진행과 분리돼 다음 줄을 막지 않는다.
 * 입력하기(타이핑)로 대조한 줄은 녹음 행을 만들지 않는다. 마이크를 열 수 없으면 녹음 없이 진행한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadRecording } from "@/lib/api/v2/reading-recordings";
import type { SessionDetail } from "@/lib/reading/api-types";
import { clipTooLarge, RECORDING_TOO_LARGE_COPY } from "@/lib/reading/recording/limits";
import { attemptCounter, createRecordingQueue, sharedRecordingQueue, type RecordingQueue } from "@/lib/reading/recording/queue";
import { recorderSupported, startLineRecording, type LineRecorder } from "@/lib/reading/recording/recorder";
import type { RehearsalState } from "@/lib/reading/rehearsal/machine";
import { newRequestId } from "@/lib/reading/request-id";
import type { StoredScript } from "@/lib/reading/storage";

/** 앱 전체가 함께 쓰는 큐. 회차가 끝나거나 다른 화면으로 가도 남은 파일을 이어서 보낸다. */
export function recordingQueue(onNotice?: (m: string) => void): RecordingQueue {
  return sharedRecordingQueue(() =>
    createRecordingQueue({
      send: (item) => uploadRecording(item.sessionId, item),
      onNotice: (m) => onNotice?.(m),
    }),
  );
}

export interface LineRecording {
  /** 지금 이 줄을 녹음하고 있는가 */
  recording: boolean;
  /** 아직 올리지 못한 녹음 수 */
  pending: number;
  /** 버린 녹음 등의 안내 */
  notice: string | null;
  /** STT·입력 결과. 줄이 끝날 때 함께 올린다. typed 면 녹음을 버린다. */
  noteTranscript: (lineId: string, text: string, matched: boolean | null, source: "stt" | "typed") => void;
  /** 같은 줄을 다시 말한다(quiz 의 "다시") — 지금 것을 올리고 새 시도를 시작한다 */
  restart: () => void;
  /** 화면을 떠난다 — 지금 것을 올리고 마이크를 놓는다 */
  finish: () => void;
}

export function useLineRecorder(args: { script: StoredScript; session: SessionDetail; state: RehearsalState; enabled: boolean }): LineRecording {
  const { script, session, state } = args;
  const enabled = args.enabled && recorderSupported();
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useMemo(() => recordingQueue(setNotice), []);
  const attempts = useMemo(() => attemptCounter(session.recordings), [session.recordings]);
  const [pending, setPending] = useState(queue.pending());
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<LineRecorder | null>(null);
  const lineRef = useRef<string | null>(null);
  const transcripts = useRef(new Map<string, { text: string; matched: boolean | null; source: "stt" | "typed" }>());
  const unavailable = useRef(false);

  useEffect(() => queue.subscribe(setPending), [queue]);

  const stopAndEnqueue = useCallback(
    (discard = false) => {
      const rec = recorderRef.current;
      const lineId = lineRef.current;
      recorderRef.current = null;
      lineRef.current = null;
      setRecording(false);
      if (!rec || !lineId) return;
      const note = transcripts.current.get(lineId);
      if (discard || note?.source === "typed") {
        rec.cancel();
        return;
      }
      void rec.stop().then((clip) => {
        if (!clip) return;
        if (clipTooLarge(clip.blob.size)) {
          setNotice(RECORDING_TOO_LARGE_COPY);
          return;
        }
        queue.enqueue({
          requestId: newRequestId(),
          sessionId: session.id,
          lineId,
          attemptNo: attempts.next(lineId),
          blob: clip.blob,
          contentType: clip.contentType,
          durationMs: clip.durationMs,
          transcript: note?.source === "stt" ? note.text : null,
          transcriptSource: note?.source === "stt" ? "stt" : "none",
          matched: note?.source === "stt" ? note.matched : null,
          createdAt: Date.now(),
        });
      });
    },
    [queue, attempts, session.id],
  );

  const start = useCallback(
    (lineId: string) => {
      if (unavailable.current || recorderRef.current) return;
      lineRef.current = lineId;
      void startLineRecording()
        .then((rec) => {
          // 기다리는 사이 줄이 바뀌었으면 버린다.
          if (lineRef.current !== lineId) {
            rec.cancel();
            return;
          }
          recorderRef.current = rec;
          setRecording(true);
        })
        .catch(() => {
          // 마이크 권한 거부 등 — record 는 끔이고 화면에 녹음 표시가 없다.
          unavailable.current = true;
          lineRef.current = null;
        });
    },
    [],
  );

  const lineId = script.lineIds[state.index];
  const myTurn = enabled && state.status === "me" && !!lineId;
  useEffect(() => {
    if (!myTurn) return;
    start(lineId);
    // 내 차례가 끝나면(다음 줄·일시정지·완료) 멈추고 올린다.
    return () => stopAndEnqueue();
  }, [myTurn, lineId, start, stopAndEnqueue]);

  useEffect(() => () => stopAndEnqueue(), [stopAndEnqueue]);

  return {
    recording,
    pending,
    notice,
    noteTranscript: (id, text, matched, source) => transcripts.current.set(id, { text, matched, source }),
    restart: () => {
      const id = lineRef.current;
      stopAndEnqueue();
      if (id) {
        transcripts.current.delete(id);
        start(id);
      }
    },
    finish: () => stopAndEnqueue(),
  };
}
