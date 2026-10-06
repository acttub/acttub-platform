"use client";

/**
 * 완료 저장·녹음 올리기가 아직 끝나지 않았는지(완료 화면의 "저장 중"). 새 페이지에서는 기기에 남은 완료 저장을
 * 이어서 시도한다.
 */
import { useEffect, useState } from "react";
import { recordingQueue } from "@/features/reading/hooks/useLineRecorder";
import { completionPending, resumeCompletionRetries, subscribeCompletion } from "@/lib/reading/session/completion";

export function useCompletionPending(sessionId: string | null): { completing: boolean; uploading: boolean } {
  const [completing, setCompleting] = useState(() => sessionId !== null && completionPending(sessionId));
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    resumeCompletionRetries();
    const queue = recordingQueue();
    const compute = () => {
      setCompleting(sessionId !== null && completionPending(sessionId));
      setUploading(queue.pending() > 0);
    };
    compute();
    const offCompletion = subscribeCompletion(compute);
    const offQueue = queue.subscribe(compute);
    return () => {
      offCompletion();
      offQueue();
    };
  }, [sessionId]);
  return { completing, uploading };
}
