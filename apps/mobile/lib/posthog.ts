/**
 * PostHog(제품 분석·화면 녹화). 이벤트는 lib/analytics.ts 가 Firebase 와 함께 이리로 보낸다.
 *
 * 켜는 규칙은 decidePostHog 한 곳이다 — 운영 API 빌드이고, 키가 있고, 현재 판 동의를 마쳤을 때
 * (consentEntry 'allowed')만 켠다. 화면을 녹화하므로 Firebase 와 달리 동의 전·로그아웃 뒤에는 끈다.
 *
 * 클라이언트는 처음 켜질 때 만든다. 리플레이 네이티브 모듈(posthog-react-native-session-replay)은
 * JS 의 optOut 을 받지 않고 만들어지는 순간 녹화를 시작하므로, 미리 만들어 두면 동의 전에 녹화된다.
 * 같은 이유로 끌 때는 optOut 과 함께 녹화도 직접 멈춘다.
 *
 * ⚠️ lib/crashlytics.ts 와 같은 규칙 — CI 는 설치 없이 node --test 로 이 파일을 읽으므로 SDK 는
 * 최상위 import 없이 함수 안 require 로만 닿는다.
 */
import type { PostHog, PostHogOptions } from 'posthog-react-native';

import { isProductionApiUrl } from './api-env.ts';
import type { ConsentEntryState } from './auth.tsx';

type ConsentStatus = ConsentEntryState['status'];

type PostHogClient = Pick<
  PostHog,
  | 'capture'
  | 'screen'
  | 'identify'
  | 'reset'
  | 'optIn'
  | 'optOut'
  | 'startSessionRecording'
  | 'stopSessionRecording'
>;

export type PostHogDecision = { on: true; key: string } | { on: false };

export function decidePostHog(input: {
  productionApi: boolean;
  key: string | undefined;
  consent: ConsentStatus;
}): PostHogDecision {
  const key = input.key?.trim() ?? '';
  return input.productionApi && key !== '' && input.consent === 'allowed'
    ? { on: true, key }
    : { on: false };
}

const OPTIONS: PostHogOptions = {
  host: 'https://us.i.posthog.com',
  // reset() 은 기기에 저장된 opt-in 도 지운다. 그 뒤에는 꺼진 쪽으로 돌아가게 한다.
  defaultOptIn: false,
  captureAppLifecycleEvents: true,
  // 가리지 않는다는 결정(SOMA-592).
  enableSessionReplay: true,
  sessionReplayConfig: {
    maskAllTextInputs: false,
    maskAllImages: false,
    maskAllSandboxedViews: false,
    captureLog: false,
  },
  // 쓰지 않는 기능. 크래시는 Crashlytics, 알림은 expo-notifications 가 맡는다.
  disableRemoteFeatureFlags: true,
  disableSurveys: true,
  errorTracking: { autocapture: false },
  capturePushNotificationSubscriptions: false,
  capturePushNotificationOpened: false,
};

function createSdkClient(key: string): PostHogClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostHog: Client } = require('posthog-react-native');
    return new Client(key, OPTIONS);
  } catch {
    // 모듈이 없는 환경(Node 테스트·웹) — 계측 없이 간다.
    return null;
  }
}

/** 켜고 끄기와 회원 식별을 한곳에 둔다. 테스트는 가짜 클라이언트를 만드는 함수를 넣는다. */
export function createPostHogBridge(createClient: (key: string) => PostHogClient | null) {
  let client: PostHogClient | null = null;
  let on = false;
  let userId: string | null = null;

  return {
    sync(decision: PostHogDecision): void {
      if (!decision.on) {
        if (client && on) {
          void client.optOut();
          void client.stopSessionRecording();
        }
        on = false;
        return;
      }
      if (on) return;
      if (client) {
        void client.optIn();
        void client.startSessionRecording();
      } else {
        client = createClient(decision.key);
        if (!client) return;
        // 지난 실행에서 끈 채로 끝났으면 opt-out 이 기기에 남아 있다.
        void client.optIn();
        if (userId) client.identify(userId);
      }
      on = true;
    },

    capture(name: string, params?: Record<string, string | number | boolean>): void {
      if (on) client?.capture(name, params);
    },

    screen(name: string): void {
      if (on) void client?.screen(name);
    },

    /** null 은 로그아웃·탈퇴다. 게스트도 null 이라, 식별한 적이 있을 때만 reset 한다. */
    setUser(id: string | null): void {
      if (id === userId) return;
      const identified = userId !== null;
      userId = id;
      if (!client) return;
      if (id) {
        client.identify(id);
      } else if (identified) {
        client.reset();
        if (on) void client.optIn();
      }
    },
  };
}

export const postHog = createPostHogBridge(createSdkClient);

/** 동의 판정이 바뀔 때마다 부른다(app/_layout.tsx). */
export function syncPostHog(consent: ConsentStatus): void {
  postHog.sync(
    decidePostHog({
      productionApi: isProductionApiUrl(process.env.EXPO_PUBLIC_API_URL),
      key: process.env.EXPO_PUBLIC_POSTHOG_KEY,
      consent,
    }),
  );
}
