package com.acttub.actingapi.support;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * 분 단위 고정 창({@code FixedWindowRateLimiter})의 경계를 피해 한도를 세는 테스트를 돌린다.
 *
 * <p>운영 빈({@code RateLimiterConfiguration})은 창 번호를 {@code System.nanoTime() / 1분} 으로 낸다. 테스트가 같은 JVM 에서
 * 같은 시계를 읽으므로, 지금 창이 끝나기까지 남은 시간을 알 수 있다. 요청 묶음이 창 경계에 걸치면 카운터가 처음부터 세어
 * "61번째는 429" 같은 단언이 흔들린다(CI 에서 {@code AccountNotificationIT}·{@code GuestTransferIT} 가 한 번씩 그랬다).
 */
public final class RateLimitWindow {
    private static final long MINUTE = TimeUnit.MINUTES.toNanos(1);

    private RateLimitWindow() {
    }

    /** 지금 창에 {@code needed} 보다 적게 남았으면 다음 창이 열릴 때까지 기다린다. */
    public static void awaitRoom(Duration needed) throws InterruptedException {
        long left = MINUTE - Math.floorMod(System.nanoTime(), MINUTE);
        if (left < needed.toNanos()) {
            TimeUnit.NANOSECONDS.sleep(left + TimeUnit.MILLISECONDS.toNanos(10));
        }
    }
}
