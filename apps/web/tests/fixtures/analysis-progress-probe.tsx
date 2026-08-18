// 훅만 붙인 최소 컴포넌트. 테스트가 이 파일을 "@/" 별칭으로 훅을 부르는 .tsx 로 두는 것은
// 일부러다 — 로더가 JSX 를 변환하고 별칭을 풀지 못하면 여기서 먼저 죽는다.
import { useAnalysisProgress } from "@/features/practice/use-analysis-progress";

type Progress = ReturnType<typeof useAnalysisProgress>;

export function AnalysisProgressProbe({
  onRender,
}: {
  onRender: (progress: Progress) => void;
}) {
  const progress = useAnalysisProgress();
  onRender(progress);
  return <output>{Math.round(progress.pct)}</output>;
}
