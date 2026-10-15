import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import { logEvent } from '@/lib/analytics';
import { ApiError, api } from '@/lib/api';
import {
  createSignupAttributionTracker,
  signupAttributionEventParams,
  signupAttributionRetryDelayMs,
  toSignupAttribution,
} from '@/lib/signup-attribution';

/**
 * 가입 유입 광고(SOMA-588)를 실제 기기에 잇는다 — 저장은 AsyncStorage, 전송은 acting-api, 귀속은 Airbridge SDK.
 *
 * Airbridge SDK 는 운영 빌드(airbridge.production.json)에서만 켜진다. 개발 빌드·Expo Go 에서는 귀속 결과가 오지
 * 않거나 네이티브 모듈이 없어 require 가 실패하고, 그러면 아무것도 보내지 않는다. 계측은 앱 흐름을 막지 않는다.
 */
let failedAttempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** 같은 실행 안에서 잠시 뒤 다시 보낸다(15초·1분·3분, 세 번까지). 그 뒤는 앱이 앞으로 올 때·다음 실행 때. */
function scheduleRetry(): void {
  const delay = signupAttributionRetryDelayMs(failedAttempts);
  failedAttempts += 1;
  if (delay === null || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void tracker.retry();
  }, delay);
}

const tracker = createSignupAttributionTracker({
  storage: AsyncStorage,
  report: (diagnostic) => {
    // 어디서 빠지는지 PostHog·Firebase 로 센다(SOMA-643). 광고 이름·계정 번호는 싣지 않는다.
    void logEvent('signup_attribution', signupAttributionEventParams(diagnostic, Platform.OS));
  },
  onSendFailed: scheduleRetry,
  send: async (payload) => {
    try {
      await api.recordSignupAttribution(payload);
    } catch (error) {
      // 값 규칙 위반(422)은 다시 보내도 같다 — 보낸 것으로 끝낸다. 나머지는 다음 기회에 다시 보낸다.
      // 조용히 빠지지 않게 거절도 센다(SOMA-643).
      if (error instanceof ApiError && error.status === 422) {
        void logEvent('signup_attribution', { stage: 'rejected', platform: Platform.OS });
        return;
      }
      throw error;
    }
  },
});

type AirbridgeModule = {
  Airbridge: {
    setOnAttributionReceived(onReceived: (attribution: Record<string, string>) => void): void;
    setUserID(id: string): void;
    clearUser(): void;
    trackEvent(category: string): void;
  };
  AirbridgeCategory: { SIGN_UP: string };
};

function withAirbridge(use: (module: AirbridgeModule) => void): void {
  try {
    use(require('airbridge-react-native-sdk') as AirbridgeModule);
  } catch {
    // 네이티브 모듈 없음(Expo Go·웹) — no-op
  }
}

let listening = false;

/**
 * 앱 기동 때 한 번. 귀속 결과는 SDK 초기화 뒤 1분 안(늦으면 5분)에 온다.
 * 앱이 앞으로 올 때마다 보내지 못한 것을 다시 보낸다 — 가입 당일 한 번 쓰고 다시 열지 않는 사람이 많다(SOMA-643).
 */
export function startSignupAttributionListener(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (next) => {
    if (next === 'active') void tracker.retry();
  });
  withAirbridge(({ Airbridge }) => {
    Airbridge.setOnAttributionReceived((attribution) => {
      const payload = toSignupAttribution(attribution, Platform.OS);
      if (payload) void tracker.received(payload);
    });
  });
}

/** 이 기기에서 가입(프로필 입력)을 마쳤다. Airbridge 에 계정과 가입 이벤트를 알리고 유입 광고를 보낸다. */
export function recordSignupCompleted(userId: string): void {
  withAirbridge(({ Airbridge, AirbridgeCategory }) => {
    Airbridge.setUserID(userId);
    Airbridge.trackEvent(AirbridgeCategory.SIGN_UP);
  });
  void tracker.signedUp(userId);
}

/**
 * 로그인한 계정을 확인했다. 가입을 마친 회원이면 Airbridge 에 계정 ID 를 붙이고, 보내지 못한 유입 광고가 있으면
 * 보낸다. 로그아웃·탈퇴면 `null` 로 불러 Airbridge 의 사용자 정보를 지운다.
 */
export function identifySignupAttributionAccount(userId: string | null): void {
  withAirbridge(({ Airbridge }) => {
    if (userId) Airbridge.setUserID(userId);
    else Airbridge.clearUser();
  });
  void tracker.accountResolved(userId);
}
