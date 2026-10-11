import type { MeasurementSwitch } from "@/features/consent/analytics-consent";

export type AnalyticsMeasurementActions = {
  grant: () => void;
  startPostHog: (userId: string) => void;
  setAnalyticsUser: (userId: string) => void;
  activateAttribution: (userId: string) => Promise<boolean>;
  revoke: () => void;
  clearAnalyticsUser: () => void;
  stopPostHog: () => void;
  pauseAttribution: () => void;
};

/** 서버 privacy 관문이 켜고 끄는 모든 수집 손잡이의 순서를 한 곳에 둔다. */
export function createAnalyticsMeasurementSwitch(
  actions: AnalyticsMeasurementActions,
): MeasurementSwitch {
  return {
    on(userId) {
      actions.grant();
      // GA4처럼 denied 상태로 먼저 켜지 않는다. 동의 조건을 통과한 뒤에만 init한다.
      actions.startPostHog(userId);
      actions.setAnalyticsUser(userId);
      // 같은 서버 동의 관문을 통과한 뒤에만 실제 URL의 최초 UTM을 저장한다.
      void actions.activateAttribution(userId);
    },
    off() {
      actions.revoke();
      actions.clearAnalyticsUser();
      actions.stopPostHog();
      actions.pauseAttribution();
    },
  };
}
