// useRunSession(안에서 useSessionSync)·useRevealed 를 붙인 최소 컴포넌트. 실행 화면처럼 대본·회차를 props 로 받는다.
import { useRevealed, useRunSession } from "@/features/reading/hooks/useRunSession";
import type { SessionDetail } from "@/lib/reading/api-types";
import type { StoredScript } from "@/lib/reading/storage";

type Run = ReturnType<typeof useRunSession>;

export function RunSessionProbe({ script, session, onRender }: { script: StoredScript; session: SessionDetail; onRender: (run: Run) => void }) {
  const run = useRunSession(script, session);
  onRender(run);
  return <output>{`흐른 ${run.sync.elapsedMs}ms · 가리기 ${run.mask}`}</output>;
}

export function RevealedProbe({ lineIndex, onRender }: { lineIndex: number; onRender: (r: [boolean, () => void]) => void }) {
  const r = useRevealed(lineIndex);
  onRender(r);
  return <output>{r[0] ? "원문 보임" : "가림"}</output>;
}
