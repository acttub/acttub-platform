// useLineRecorder·useCompletionPending 을 붙인 최소 컴포넌트. 실행 화면처럼 회차·상태를 props 로 받아
// 상태가 바뀔 때 다시 그려 본다.
import { useCompletionPending } from "@/features/reading/hooks/useCompletionPending";
import { useLineRecorder, type LineRecording } from "@/features/reading/hooks/useLineRecorder";

type Args = Parameters<typeof useLineRecorder>[0];

export function LineRecorderProbe({ args, onRender }: { args: Args; onRender: (r: LineRecording) => void }) {
  const r = useLineRecorder(args);
  onRender(r);
  return <output>{`${r.recording ? "녹음 중" : "녹음 안 함"} · 남은 ${r.pending} · ${r.notice ?? "안내 없음"}`}</output>;
}

export function CompletionPendingProbe({ sessionId }: { sessionId: string | null }) {
  const { completing, uploading } = useCompletionPending(sessionId);
  return <output>{`${completing ? "완료 저장 중" : "완료 저장 끝"} · ${uploading ? "녹음 올리는 중" : "녹음 다 올림"}`}</output>;
}
