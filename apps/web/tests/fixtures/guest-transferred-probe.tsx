// useGuestTransferred 를 실제로 돌려 보기 위한 최소 컴포넌트. 옮겨졌다는 소식은 화면 밖(공용
// 클라이언트)에서 오므로, 그것이 안내를 띄우는 상태에 닿는지는 띄워 봐야 안다.
import { useGuestTransferred } from "@/features/transfer/use-guest-transferred";

const navigations: string[] = [];

export function navigationsSoFar(): string[] {
  return navigations;
}

export function resetNavigations(): void {
  navigations.length = 0;
}

const recordNavigation = (path: string) => {
  navigations.push(path);
};

export function GuestTransferredProbe({
  onRender,
}: {
  onRender: (value: { transferred: boolean; startOver: () => void }) => void;
}) {
  onRender(useGuestTransferred(recordNavigation));
  return null;
}
