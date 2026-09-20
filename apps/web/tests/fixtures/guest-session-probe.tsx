// useGuestSession 을 실제로 돌려 보기 위한 최소 컴포넌트. 게스트가 생기고 끝나는 것은
// 화면 밖(공용 클라이언트)에서 일어나므로, 그 변화가 렌더에 닿는지는 띄워 봐야 안다.
import { useGuestSession } from "@/features/consent/use-guest-session";

export function GuestSessionProbe({
  onRender,
}: {
  onRender: (value: { hasSession: boolean }) => void;
}) {
  onRender(useGuestSession());
  return null;
}
