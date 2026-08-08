/**
 * 브라우저 쪽 Sentry 진입점. Next가 앱 코드보다 먼저 이 파일을 실행한다.
 *
 * 파일 이름과 위치를 Next가 정해 두었다 — `src/instrumentation-client.ts`가 아니면
 * 아무 일도 일어나지 않는다. 옵션은 `lib/observability/sentry-shared.ts`에 있다.
 */
import * as Sentry from "@sentry/nextjs";

import { isSentryEnabled, sentryBaseOptions } from "@/lib/observability/sentry-shared";

if (isSentryEnabled()) {
  Sentry.init(sentryBaseOptions);
}

/**
 * App Router의 화면 전환을 이어 붙인다. 없으면 전환 도중 난 에러가 어느 화면에서
 * 시작됐는지 알 수 없다. Sentry가 꺼져 있어도 내보내야 한다 — Next가 이 이름을
 * 찾아 부르고, SDK 쪽은 초기화되지 않았으면 스스로 아무것도 하지 않는다.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
