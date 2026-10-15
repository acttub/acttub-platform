package com.acttub.actingapi.feature.billing.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * PG 심사 전용 로그인 세션 저장소. 프로세스 메모리에만 있고(DB·디스크 없음) 재기동하면 사라진다.
 *
 * <ul>
 *   <li>수명은 로그인 시각부터 {@link #SESSION_TTL}, 절대 시간이다(연장 없음).</li>
 *   <li>동시에 {@link #MAX_SESSIONS} 개까지만 둔다. 가득 차면 새 로그인을 거절한다(만료 정리 뒤에도).</li>
 *   <li>만료 정리는 접근할 때마다 한다(스케줄러 없음).</li>
 * </ul>
 */
public final class PgReviewSessions {
    public static final Duration SESSION_TTL = Duration.ofMinutes(30);
    public static final Duration CHECKOUT_TTL = Duration.ofMinutes(15);
    public static final int MAX_SESSIONS = 50;
    public static final int MAX_CHECKOUTS_PER_SESSION = 5;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final Clock clock;
    private final Map<String, Session> sessions = new LinkedHashMap<>();

    public PgReviewSessions(Clock clock) {
        this.clock = clock;
    }

    /** 새 세션을 만든다. 자리가 없으면 비어 있다. */
    public synchronized Optional<Session> open() {
        purge();
        if (sessions.size() >= MAX_SESSIONS) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        Session session = new Session(token(32), now.plus(SESSION_TTL));
        sessions.put(session.id, session);
        return Optional.of(session);
    }

    public synchronized Optional<Session> find(String id) {
        if (id == null || id.isEmpty() || id.length() > 128) {
            return Optional.empty();
        }
        purge();
        return Optional.ofNullable(sessions.get(id));
    }

    public synchronized void close(String id) {
        if (id != null) {
            sessions.remove(id);
        }
    }

    public synchronized int size() {
        purge();
        return sessions.size();
    }

    private void purge() {
        Instant now = clock.instant();
        sessions.values().removeIf(session -> !now.isBefore(session.expiresAt));
    }

    static String token(int bytes) {
        byte[] raw = new byte[bytes];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    /** 결제 등록 시도 하나. 서버가 발급한 값이며 브라우저가 정하는 값이 없다. */
    public record Checkout(String customerKey, String state, String orderId, String idempotencyKey,
            Instant expiresAt) {
    }

    public enum Begin {
        /** 카드 등록 확인과 첫 승인을 이 호출이 맡는다. */
        PROCEED,
        /** 이미 처리 중이거나 끝난 콜백이다. 아무것도 하지 않는다. */
        DUPLICATE,
        /** 발급한 시도가 없다. */
        NO_CHECKOUT,
        /** state 가 맞지 않는다. 시도는 그대로 둔다. */
        BAD_STATE,
        /** customerKey 가 맞지 않는다. 시도를 닫는다. */
        BAD_CUSTOMER,
        /** 시도가 오래됐다. 시도를 닫는다. */
        EXPIRED
    }

    public static final class Session {
        private enum Phase {
            PENDING,
            PROCESSING,
            CLOSED
        }

        private final String id;
        private final Instant expiresAt;
        private Checkout checkout;
        private Phase phase = Phase.CLOSED;
        private int checkouts;
        private PgReviewResult result = PgReviewResult.idle();

        private Session(String id, Instant expiresAt) {
            this.id = id;
            this.expiresAt = expiresAt;
        }

        public String id() {
            return id;
        }

        public synchronized PgReviewResult result() {
            return result;
        }

        /** 새 시도를 발급한다. 처리 중이거나 이미 승인·불명이면, 또는 횟수를 넘으면 비어 있다. */
        public synchronized Optional<Checkout> startCheckout(Instant now) {
            String status = result.status();
            if (phase == Phase.PROCESSING || "approved".equals(status) || "unknown".equals(status)
                    || checkouts >= MAX_CHECKOUTS_PER_SESSION) {
                return Optional.empty();
            }
            checkouts++;
            checkout = new Checkout(
                    "pgr_" + UUID.randomUUID(),
                    token(24),
                    "pgr-" + UUID.randomUUID(),
                    UUID.randomUUID().toString(),
                    now.plus(CHECKOUT_TTL));
            phase = Phase.PENDING;
            result = PgReviewResult.idle();
            return Optional.of(checkout);
        }

        /** 성공 콜백 한 번만 {@link Begin#PROCEED} 를 받는다(원자적). */
        public synchronized Begin begin(String state, String customerKey, Instant now) {
            if (checkout == null) {
                return Begin.NO_CHECKOUT;
            }
            if (phase != Phase.PENDING) {
                return Begin.DUPLICATE;
            }
            if (!constantTimeEquals(checkout.state, state)) {
                result = PgReviewResult.failed(null, "state_mismatch", "요청을 확인하지 못했습니다. 처음부터 다시 시도해 주세요.");
                return Begin.BAD_STATE;
            }
            if (!now.isBefore(checkout.expiresAt)) {
                phase = Phase.CLOSED;
                result = PgReviewResult.failed(checkout.orderId, "checkout_expired", "등록 시간이 지났습니다. 처음부터 다시 시도해 주세요.");
                return Begin.EXPIRED;
            }
            if (!constantTimeEquals(checkout.customerKey, customerKey)) {
                phase = Phase.CLOSED;
                result = PgReviewResult.failed(checkout.orderId, "customer_mismatch", "요청을 확인하지 못했습니다. 처음부터 다시 시도해 주세요.");
                return Begin.BAD_CUSTOMER;
            }
            phase = Phase.PROCESSING;
            result = PgReviewResult.processing(checkout.orderId);
            return Begin.PROCEED;
        }

        public synchronized Checkout checkout() {
            return checkout;
        }

        /** 실패 콜백. state 가 맞고 대기 중일 때만 실패로 기록하고 시도를 닫는다. */
        public synchronized boolean fail(String state, String errorCode, String message) {
            if (checkout == null || phase != Phase.PENDING || !constantTimeEquals(checkout.state, state)) {
                return false;
            }
            phase = Phase.CLOSED;
            result = PgReviewResult.failed(checkout.orderId, errorCode, message);
            return true;
        }

        public synchronized void finish(PgReviewResult finalResult) {
            phase = Phase.CLOSED;
            result = finalResult;
        }

        private static boolean constantTimeEquals(String expected, String actual) {
            if (actual == null) {
                return false;
            }
            return MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
        }
    }
}
