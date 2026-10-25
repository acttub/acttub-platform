package com.acttub.actingapi.feature.billing.app;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/**
 * 앱 ACTTUB Pro 정기결제의 고정 규칙(SOMA-818, billing.subscription). 값은 acttub.com/pricing 과 같다 —
 * 월 3,900원(부가세 포함), 무료는 코칭 하루 1번·리딩 대본 1개 보관.
 */
public final class BillingRules {
    public static final long AMOUNT = 3900L;
    /** 결제 출처. toss 는 웹 정기결제, apple·google 은 스토어 구독(2단계)이고 스토어 알림이 갱신한다. */
    public static final String PROVIDER_TOSS = "toss";
    public static final String PROVIDER_APPLE = "apple";
    public static final String PROVIDER_GOOGLE = "google";
    public static final String ORDER_NAME = "ACTTUB Pro 월 구독";
    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    /** 무료 코칭은 한국 시간 하루에 회차 1개. */
    public static final int FREE_DAILY_COACHING = 1;
    /** 무료 리딩 대본 보관 개수. */
    public static final int FREE_SCRIPTS = 1;
    /** 자동결제가 실패한 뒤 다시 시도하는 간격과 횟수. 횟수를 다 쓰면 expired 다. */
    public static final Duration RETRY_DELAY = Duration.ofDays(1);
    public static final int MAX_RETRIES = 3;
    /** 결과를 모르는 승인을 같은 키로 다시 묻는 횟수. 토스 멱등 키는 15일 유효하다. */
    public static final int MAX_UNKNOWN_CHECKS = 20;
    /** 카드 등록 창(일회용 state)의 수명. */
    public static final Duration CHECKOUT_TTL = Duration.ofMinutes(30);

    private BillingRules() {
    }

    public enum Status {
        ACTIVE("active"),
        CANCELED("canceled"),
        PAST_DUE("past_due"),
        EXPIRED("expired");

        private final String db;

        Status(String db) {
            this.db = db;
        }

        public String db() {
            return db;
        }

        public static Status of(String value) {
            for (Status status : values()) {
                if (status.db.equals(value)) {
                    return status;
                }
            }
            throw new IllegalArgumentException("unknown subscription status");
        }
    }

    public enum Purpose {
        SUBSCRIBE("subscribe"),
        CHANGE_CARD("change_card");

        private final String db;

        Purpose(String db) {
            this.db = db;
        }

        public String db() {
            return db;
        }

        public static Purpose of(String value) {
            for (Purpose purpose : values()) {
                if (purpose.db.equals(value)) {
                    return purpose;
                }
            }
            return null;
        }
    }

    /**
     * Pro 권한. active 는 기간과 상관없이 Pro 다(스케줄러가 늦어도 끊지 않는다). canceled 는 이번 기간이 끝날 때까지만,
     * past_due·expired 는 Pro 가 아니다.
     */
    public static boolean pro(Status status, Instant periodEnd, Instant now) {
        return switch (status) {
            case ACTIVE -> true;
            case CANCELED -> periodEnd != null && now.isBefore(periodEnd);
            case PAST_DUE, EXPIRED -> false;
        };
    }

    /** 다음 결제일 — 한국 시간 같은 날짜의 다음 달(31일 → 말일). */
    public static Instant nextPeriodEnd(Instant periodStart) {
        return periodStart.atZone(SEOUL).plusMonths(1).toInstant();
    }

    /** 자동결제 주문 ID. 같은 구독·같은 기간·같은 시도는 언제나 같은 값이라 두 번 승인되지 않는다. */
    public static String renewalOrderId(java.util.UUID subscriptionId, Instant periodStart, int attempt) {
        String day = java.time.format.DateTimeFormatter.BASIC_ISO_DATE.format(periodStart.atZone(SEOUL));
        return "pro-" + subscriptionId.toString().replace("-", "").substring(0, 16) + "-" + day + "-" + attempt;
    }

    /** 첫 결제 주문 ID(카드 등록 창 하나에 하나). */
    public static String firstOrderId(java.util.UUID checkoutId) {
        return "pro-first-" + checkoutId.toString().replace("-", "");
    }
}
