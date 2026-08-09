/**
 * Next 서버(Node) 쪽 Sentry 진입점.
 *
 * 이 서버가 하는 일은 정적 HTML 서빙과 `/v2/*` 프록시뿐이지만(apps/web/CLAUDE.md),
 * 프록시가 백엔드로 못 닿거나 렌더가 서버에서 터지는 경우가 여기로 잡힌다. 운영은
 * back alb가 private subnet에 있어 이 프로세스가 유일한 통로라, 여기서 나는 에러는
 * 사용자 눈에 바로 보인다.
 */
import * as Sentry from "@sentry/nextjs";

import { isSentryEnabled, sentryBaseOptions } from "@/lib/observability/sentry-shared";

export async function register() {
  if (!isSentryEnabled()) return;
  // edge 런타임은 쓰지 않는다 — middleware도 Route Handler도 두지 않기 때문이다.
  // 나중에 생기면 여기에 'edge' 분기를 더한다.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(sentryBaseOptions);
  }
}

/** 서버 렌더 중 난 에러를 Next가 이 이름으로 넘겨준다. */
export const onRequestError = Sentry.captureRequestError;
