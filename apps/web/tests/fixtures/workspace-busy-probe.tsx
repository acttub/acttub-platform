// 훅만 붙인 최소 컴포넌트. 무엇이 잠겼는지를 화면에 내보내는 것은 일부러다 —
// 도는 일이 렌더까지 닿는지를 텍스트로 확인한다.
import { useWorkspaceBusy } from "@/features/workspace/use-workspace-busy";

type Busy = ReturnType<typeof useWorkspaceBusy>;

export function WorkspaceBusyProbe({
  onRender,
}: {
  onRender: (busy: Busy) => void;
}) {
  const busy = useWorkspaceBusy();
  onRender(busy);
  const locked = Object.entries(busy.disabled)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return <output>{locked.length ? locked.join(",") : "none"}</output>;
}
