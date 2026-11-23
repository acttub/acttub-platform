package com.acttub.actingapi.feature.billing.app;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/**
 * 앱 ACTTUB Pro 정기결제의 고정 규칙(SOMA-818, billing.subscription). 값은 acttub.com/pricing 과 같다 —
 * 월 3,900원(부가세 포함), 무료는 코칭 하루 3번·리딩 대본 3개 보관.
 */
public final class BillingRules {
    public static final long AMOUNT = 3900L;
    /** 결제 출처. toss 는 웹 정기결제, apple·google 은 스토어 구독(2단계)이고 스토어 알림이 갱신한다. */
    public static final String PROVIDER_TOSS = "toss";
    public static final String PROVIDER_APPLE = "apple";
    public static final String PROVIDER_GOOGLE = "google";
    /** 양 스토어 공통 상품 ID. 구글은 구독 ID 이고 기본 요금제(base plan)는 {@link #GOOGLE_BASE_PLAN_ID}. */
    public static final String STORE_PRODUCT_ID = "acttub_pro_monthly";
    public static final String GOOGLE_BASE_PLAN_ID = "monthly";
    /**
     * 연 구독. 월 3,900원 × 12개월에서 30% 할인한 연 32,500원(46,800원의 69.4%). 구글 기본 요금제는 yearly. 웹 토스 연 구독(SOMA-1068)은
     * BILLING_WEB_YEARLY_ENABLED 뒤에 있다.
     */
    public static final String STORE_PRODUCT_YEARLY_ID = "acttub_pro_yearly";
    public static final String GOOGLE_BASE_PLAN_YEARLY_ID = "yearly";
    public static final long YEARLY_AMOUNT = 32500L;
    /** 스토어 갱신 알림이 늦어도 갱신 직후 Pro 가 끊기지 않게 active 에 주는 여유. */
    public static final Duration STORE_RENEWAL_SKEW = Duration.ofHours(6);
    /** 구글 결제 유예(IN_GRACE_PERIOD) 때 만료 시각 뒤로 Pro 를 이어 주는 기간. 알림이 상태를 바로잡는다. */
    public static final Duration GOOGLE_GRACE = Duration.ofDays(7);

    /**
     * 출시 주간 Pro(SOMA-899, 10/26 대표 결정) — 11/1 0시(한국) 전에 가입한 사람은 11/1 0시부터 11/8 0시 전까지(11/1~11/7) 카드 없이
     * Pro 다. 운영 DB 에 줄을 넣지 않고 가입 시각으로 판정하므로, 11/1 직전까지 가입한 사람도 빠지지 않는다.
     */
    public static final Instant LAUNCH_WEEK_START = Instant.parse("2026-10-31T15:00:00Z");
    public static final Instant LAUNCH_WEEK_END = Instant.parse("2026-11-07T15:00:00Z");

    /** 출시 주간 Pro 의 끝 — 지금이 그 주간이고 가입이 시작 전이면 끝 시각, 아니면 null. 가입 시각을 모르면 null. */
    public static Instant launchWeekEnd(Instant signedUpAt, Instant now) {
        if (signedUpAt == null || now.isBefore(LAUNCH_WEEK_START) || !now.isBefore(LAUNCH_WEEK_END)) {
            return null;
        }
        return signedUpAt.isBefore(LAUNCH_WEEK_START) ? LAUNCH_WEEK_END : null;
    }
    public static final String ORDER_NAME = "ACTTUB Pro 월 구독";
    public static final String YEARLY_ORDER_NAME = "ACTTUB Pro 연 구독";
    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    /** 무료 코칭은 한국 시간 하루에 회차 3개. */
    public static final int FREE_DAILY_COACHING = 3;
    /** 무료 리딩 대본 보관 개수. */
    public static final int FREE_SCRIPTS = 3;
    /** 자동결제가 실패한 뒤 다시 시도하는 간격과 횟수. 횟수를 다 쓰면 expired 다. */
    public static final Duration RETRY_DELAY = Duration.ofDays(1);
    public static final int MAX_RETRIES = 3;
    /** 결과를 모르는 승인을 같은 키로 다시 묻는 횟수. 토스 멱등 키는 15일 유효하다. */
    public static final int MAX_UNKNOWN_CHECKS = 20;
    /** 카드 등록 창(일회용 state)의 수명. */
    public static final Duration CHECKOUT_TTL = Duration.ofMinutes(30);

    private BillingRules() {
    }

    /** 우리가 파는 스토어 구독 상품(월·연)인가. */
    public static boolean storeProduct(String productId) {
        return STORE_PRODUCT_ID.equals(productId) || STORE_PRODUCT_YEARLY_ID.equals(productId);
    }

    /** 스토어 구독 상품의 정가(부가세 포함). 장부의 amount 와 구독 관리 화면에 쓴다 — 실제 청구액은 스토어가 정한다. */
    public static long storeAmount(String productId) {
        return STORE_PRODUCT_YEARLY_ID.equals(productId) ? YEARLY_AMOUNT : AMOUNT;
    }

    /** 요금제. 토스 구독은 고른 요금제의 금액·주문명·기간으로 첫 결제와 자동결제를 한다. */
    public enum Plan {
        MONTHLY("monthly", AMOUNT, ORDER_NAME),
        YEARLY("yearly", YEARLY_AMOUNT, YEARLY_ORDER_NAME);

        private final String db;
        private final long amount;
        private final String orderName;

        Plan(String db, long amount, String orderName) {
            this.db = db;
            this.amount = amount;
            this.orderName = orderName;
        }

        public String db() {
            return db;
        }

        public long amount() {
            return amount;
        }

        public String orderName() {
            return orderName;
        }

        /** 이 기간의 끝(= 다음 결제일). 월은 다음 달 같은 날(31일 → 말일), 연은 다음 해 같은 날(2월 29일 → 2월 28일). 한국 시간 기준. */
        public Instant nextPeriodEnd(Instant periodStart) {
            return this == YEARLY ? periodStart.atZone(SEOUL).plusYears(1).toInstant() : BillingRules.nextPeriodEnd(periodStart);
        }

        /** 알 수 없는 값이면 null. */
        public static Plan of(String value) {
            for (Plan plan : values()) {
                if (plan.db.equals(value)) {
                    return plan;
                }
            }
            return null;
        }

        /** 장부 값. 모르는 값은 기존 행과 같이 monthly 로 읽는다. */
        public static Plan ofDb(String value) {
            Plan plan = of(value);
            return plan == null ? MONTHLY : plan;
        }

        /** 스토어 상품의 요금제. */
        public static Plan ofStoreProduct(String productId) {
            return STORE_PRODUCT_YEARLY_ID.equals(productId) ? YEARLY : MONTHLY;
        }
    }

    /** 웹 결제의 청약철회 기간 — 결제 후 이 기간 안이고 유료 기능을 쓰지 않았으면 전액 환불(약관 제14조). */
    public static final Duration REFUND_FULL_WINDOW = Duration.ofDays(7);

    /**
     * 웹(토스) 결제 한 건의 환불액(약관 제14조 제1항·제2항). 결제주기의 길이(월 28~31일, 연 365·366일)를 그대로 쓰므로 월·연 구독에 같은
     * 규칙이 맞는다.
     *
     * <ul>
     *   <li>결제 후 7일 이내이고 유료 기능을 쓰지 않았다 → 전액</li>
     *   <li>결제 후 7일 이내이고 썼다 → 이용한 날짜만큼 뺀다</li>
     *   <li>결제 후 7일이 지났다 → 이용한 날짜만큼 빼고, 남은 금액의 10%를 더 뺀다</li>
     * </ul>
     *
     * 이용일수는 기간 시작부터 요청 시각까지이고 24시간이 안 되는 시간도 1일이다. 하루 이용료는 결제금액 ÷ 결제주기 전체 일수이며, 1원
     * 미만은 올려서 환불하고 결제금액을 넘지 않는다. 회사 잘못으로 해지하는 경우(남은 금액의 10%를 더함)는 사람이 판정하므로 여기에 없다.
     *
     * @param amount      실제 결제금액(원)
     * @param periodStart 이 결제로 열린 이용 기간의 시작(= 결제 시각)
     * @param periodEnd   이용 기간의 끝(= 다음 결제일)
     * @param requestedAt 환불 요청을 받은 시각
     * @param usedPaidFeatures 이 기간에 유료 기능을 썼는가
     */
    public static long refundAmount(long amount, Instant periodStart, Instant periodEnd, Instant requestedAt,
            boolean usedPaidFeatures) {
        if (amount <= 0 || !periodEnd.isAfter(periodStart)) {
            return 0L;
        }
        Duration elapsed = Duration.between(periodStart, requestedAt);
        if (elapsed.isNegative()) {
            elapsed = Duration.ZERO;
        }
        boolean withinWindow = elapsed.compareTo(REFUND_FULL_WINDOW) <= 0;
        if (withinWindow && !usedPaidFeatures) {
            return amount;
        }
        long totalDays = ceilDays(Duration.between(periodStart, periodEnd));
        long usedDays = Math.min(ceilDays(elapsed), totalDays);
        long leftDays = totalDays - usedDays;
        // 남은 금액 = amount × leftDays / totalDays. 7일이 지났으면 그 90%.
        long refund = withinWindow
                ? Math.ceilDiv(amount * leftDays, totalDays)
                : Math.ceilDiv(amount * leftDays * 9, totalDays * 10);
        return Math.min(refund, amount);
    }

    private static long ceilDays(Duration duration) {
        long millis = duration.toMillis();
        return Math.ceilDiv(millis, Duration.ofDays(1).toMillis());
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

    /**
     * 출처를 아는 Pro 권한. 스토어 구독(apple·google)은 active 여도 기간이 끝나면(여유 {@link #STORE_RENEWAL_SKEW}) Pro 가 아니다 —
     * 만료 알림을 못 받아도 영구 Pro 로 남지 않는다. 토스는 {@link #pro(Status, Instant, Instant)} 와 같다.
     */
    public static boolean pro(Status status, Instant periodEnd, Instant now, String provider) {
        if (PROVIDER_TOSS.equals(provider) || provider == null) {
            return pro(status, periodEnd, now);
        }
        if (periodEnd == null) {
            return false;
        }
        return switch (status) {
            case ACTIVE -> now.isBefore(periodEnd.plus(STORE_RENEWAL_SKEW));
            case CANCELED -> now.isBefore(periodEnd);
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
