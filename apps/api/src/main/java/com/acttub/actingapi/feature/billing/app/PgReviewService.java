package com.acttub.actingapi.feature.billing.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.Optional;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.billing.app.PgReviewGateway.GatewayException;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions.Begin;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions.Checkout;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * PG 심사 전용 테스트 결제의 규칙(SOMA-620). 실제 앱 계정·유료 권한·무료 한도와 아무 관계가 없다.
 * 승인 결과는 이 메모리 세션에만 남고, 빌링키는 승인 호출 동안 지역 변수로만 존재한다.
 */
public class PgReviewService {
    private static final Logger LOG = LoggerFactory.getLogger(PgReviewService.class);
    public static final String ORDER_NAME = "ACTTUB Pro 월 구독 테스트";
    private static final Pattern GATEWAY_CODE = Pattern.compile("[A-Z0-9_]{1,64}");
    private static final String REGISTRATION_FAILED = "카드 등록이 완료되지 않았습니다.";
    private static final String APPROVAL_FAILED = "테스트 결제가 승인되지 않았습니다.";

    private final PgReviewSettings settings;
    private final PgReviewSessions sessions;
    private final PgReviewGateway gateway;
    private final Clock clock;
    private final byte[] usernameDigest;
    private final byte[] passwordDigest;

    public PgReviewService(PgReviewSettings settings, PgReviewSessions sessions, PgReviewGateway gateway, Clock clock) {
        this.settings = settings;
        this.sessions = sessions;
        this.gateway = gateway;
        this.clock = clock;
        this.usernameDigest = sha256(settings.username());
        this.passwordDigest = settings.usable() ? HexFormat.of().parseHex(settings.passwordSha256()) : new byte[32];
    }

    public PgReviewSettings settings() {
        return settings;
    }

    /** 설정이 올바르고 호출 직전에도 테스트 키일 때만 true. */
    public boolean available() {
        return settings.usable();
    }

    public Optional<Session> authenticate(String sessionId) {
        return available() ? sessions.find(sessionId) : Optional.empty();
    }

    /** 맞으면 새 세션, 틀리면 비어 있고, 자리가 없으면 {@link LoginFull}. */
    public Optional<Session> login(String username, String password) {
        boolean userMatches = MessageDigest.isEqual(usernameDigest, sha256(username == null ? "" : username));
        boolean passwordMatches = MessageDigest.isEqual(passwordDigest, sha256(password == null ? "" : password));
        if (!available() || !userMatches || !passwordMatches) {
            return Optional.empty();
        }
        Optional<Session> session = sessions.open();
        if (session.isEmpty()) {
            throw new LoginFull();
        }
        return session;
    }

    public void logout(String sessionId) {
        sessions.close(sessionId);
    }

    /** 발급할 수 없으면(처리 중·승인 뒤·횟수 초과) 비어 있다. */
    public Optional<Checkout> checkout(Session session) {
        return session.startCheckout(clock.instant());
    }

    /**
     * 토스 성공 콜백. 반환은 없다 — 호출한 쪽은 항상 깨끗한 결과 URL 로 보내고 결과는 세션에서 읽는다.
     * 예상 밖 예외가 나도 authKey 가 담긴 요청이 오류 수집으로 새지 않도록 여기서 삼킨다.
     */
    public void completeRegistration(Session session, String state, String customerKey, String authKey) {
        Begin begin = session.begin(state, customerKey, clock.instant());
        if (begin != Begin.PROCEED) {
            return;
        }
        Checkout checkout = session.checkout();
        PgReviewResult outcome;
        try {
            outcome = register(checkout, authKey);
        } catch (RuntimeException unexpected) {
            LOG.error("pg review registration failed unexpectedly order={} type={}",
                    checkout.orderId(), unexpected.getClass().getSimpleName());
            outcome = PgReviewResult.unknown(checkout.orderId(), "unexpected_error");
        }
        session.finish(outcome);
        LOG.info("pg review result order={} status={} code={}", checkout.orderId(), outcome.status(), outcome.errorCode());
    }

    public void failRegistration(Session session, String state, String gatewayCode) {
        String code = gatewayCode != null && GATEWAY_CODE.matcher(gatewayCode).matches() ? gatewayCode : "registration_failed";
        session.fail(state, code, REGISTRATION_FAILED);
    }

    private PgReviewResult register(Checkout checkout, String authKey) {
        if (authKey == null || authKey.isBlank() || authKey.length() > 200) {
            return PgReviewResult.failed(checkout.orderId(), "auth_key_missing", REGISTRATION_FAILED);
        }
        String billingKey;
        try {
            billingKey = gateway.issueBillingKey(authKey, checkout.customerKey());
        } catch (GatewayException e) {
            // 빌링키를 못 받았으니 승인은 시도하지 않았다 — 돈이 움직일 수 없다.
            return PgReviewResult.failed(checkout.orderId(), safeCode(e.code()), REGISTRATION_FAILED);
        }
        PgReviewGateway.Approval approval;
        try {
            approval = gateway.approve(billingKey, checkout.customerKey(), checkout.orderId(),
                    PgReviewResult.AMOUNT, ORDER_NAME, checkout.idempotencyKey());
        } catch (GatewayException e) {
            if (e.outcome() == GatewayException.Outcome.UNKNOWN) {
                // 시간 초과 등: 승인됐을 수도 있다. 실패로 단정하지 않고 새 주문도 만들지 않는다.
                return PgReviewResult.unknown(checkout.orderId(), safeCode(e.code()));
            }
            return PgReviewResult.failed(checkout.orderId(), safeCode(e.code()), APPROVAL_FAILED);
        }
        if (approval == null
                || !"DONE".equals(approval.status())
                || !checkout.orderId().equals(approval.orderId())
                || approval.amount() != PgReviewResult.AMOUNT) {
            return PgReviewResult.unknown(checkout.orderId(), "verification_mismatch");
        }
        return PgReviewResult.approved(checkout.orderId(), approval.approvedAt());
    }

    private static String safeCode(String code) {
        return code != null && GATEWAY_CODE.matcher(code).matches() ? code : "gateway_error";
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** 세션 자리가 없다. */
    public static final class LoginFull extends RuntimeException {
        public LoginFull() {
            super("pg review sessions full");
        }
    }
}
