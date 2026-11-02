// 훅만 붙인 최소 컴포넌트. 화면이 그리는 값을 실제로 내보내는 것은 일부러다 —
// 자리를 세우는 것이 렌더까지 닿는지를 텍스트로 확인한다.
import { useActiveSession } from "@/features/workspace/use-active-session";

type Active = ReturnType<typeof useActiveSession>;

export function ActiveSessionProbe({
  onRender,
}: {
  onRender: (active: Active) => void;
}) {
  const active = useActiveSession();
  onRender(active);
  return <output>{active.id ?? "none"}</output>;
}
