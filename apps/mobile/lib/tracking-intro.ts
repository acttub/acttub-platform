/** 시스템 상태와 기기 내 표시 기록을 함께 확인한다. */
export const TRACKING_INTRO_KEY = 'tracking-intro-v1';
export async function beforeTrackingRequest(deps: {
  platform: string;
  getStatus: () => Promise<string>;
  getSeen: () => Promise<string | null>;
  markSeen: () => Promise<void>;
  show: () => Promise<void>;
}): Promise<void> {
  if (deps.platform !== 'ios' || await deps.getStatus() !== 'undetermined') return;
  // 기기 저장소 오류 때문에 기존 ATT 요청을 건너뛰지 않는다.
  const seen = await deps.getSeen().catch(() => null);
  if (seen) return;
  await deps.show();
  await deps.markSeen().catch(() => undefined);
}
