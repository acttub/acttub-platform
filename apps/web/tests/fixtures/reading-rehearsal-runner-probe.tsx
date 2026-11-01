// useRehearsalRunner 를 붙인 최소 컴포넌트. 지금 상태를 글자로 내보내 화면이 보는 값과 같은 것을 단언한다.
import { useRehearsalRunner, type RunnerOptions } from "@/features/reading/hooks/useRehearsalRunner";
import type { RehearsalConfig } from "@/lib/reading/rehearsal/machine";

type Runner = ReturnType<typeof useRehearsalRunner>;

export function RehearsalRunnerProbe({ cfg, opts, onRender }: { cfg: RehearsalConfig; opts: RunnerOptions; onRender: (r: Runner) => void }) {
  const r = useRehearsalRunner(cfg, opts);
  onRender(r);
  const flags = [r.preparing && "준비 중", r.voiceFailed && "목소리 실패", r.noSpeech && "무발화", r.micError].filter(Boolean).join(",");
  return <output>{`${r.state.status}@${r.state.index} · ${r.myTurn} · 음량 ${r.volume} · ${flags || "-"}`}</output>;
}
