import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen, type StatusAction } from '@/components/ui/status-screen';

/**
 * 리딩의 실패·권한 안내 화면 — 공통 StatusScreen 에 대본 든 액티(pen 「대본을 못 나눴어요」·「상대역 목소리를 못 만들었어요」).
 * 화면 전체를 차지하므로 안전 영역을 띄운다.
 */
export function ReadingStatus(props: {
  title: string;
  body?: string;
  note?: string;
  primary?: StatusAction;
  secondary?: StatusAction;
  onBack?: () => void;
}) {
  return <StatusScreen mascot={MASCOT.reading} safeArea {...props} />;
}
