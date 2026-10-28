import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen, type StatusAction } from '@/components/ui/status-screen';

/**
 * 코칭의 한 장짜리 안내 — 공통 StatusScreen 에 갸웃하는 액티(pen 「카메라와 마이크가 필요해요」·「끊긴 코칭 이어 하기」).
 */
export function CoachNotice(props: { title: string; body: string; primary: StatusAction; secondary?: StatusAction }) {
  return <StatusScreen mascot={MASCOT.coach} {...props} />;
}
