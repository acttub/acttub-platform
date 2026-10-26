package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 10월까지 가입한 회원의 무료 한도 유예(SOMA-818) — 한도만 미루고 Pro 판정은 그대로다. */
class LegacyFreeLimitsTest {
    static final String CLIENT = "test_ck_abcdefgh12345678";
    static final String SECRET = "test_sk_abcdefgh12345678";

    final MutableClock clock = new MutableClock(Instant.parse("2026-11-10T01:00:00Z"));
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final UUID oldUser = UUID.randomUUID();
    final UUID newUser = UUID.randomUUID();

    LegacyFreeLimitsTest() {
        repository.signups.put(oldUser, Instant.parse("2026-10-31T14:59:59Z"));
        repository.signups.put(newUser, Instant.parse("2026-10-31T15:00:00Z"));
    }

    SubscriptionService service(boolean limits) {
        return new SubscriptionService(new BillingSettings(true, false, limits, "https://dev.acttub.com",
                "https://acttub.com/pricing/result", CLIENT, SECRET), repository, new FakeGateway(), null, clock);
    }

    @Test
    @DisplayName("기존 회원은 12월 1일 전까지 한도가 없고, 응답의 limits_enforced 도 false 다")
    void legacyBeforeDecember() {
        SubscriptionService service = service(true);
        clock.set(Instant.parse("2026-11-30T14:59:59Z"));
        assertThat(service.freeLimited(oldUser)).isFalse();
        assertThat(service.view(oldUser).limitsEnforced()).isFalse();
    }

    @Test
    @DisplayName("기존 회원도 12월 1일 00시(KST)부터는 한도가 걸리고 조회는 더 나가지 않는다")
    void legacyAfterDecember() {
        SubscriptionService service = service(true);
        clock.set(Instant.parse("2026-11-30T15:00:00Z"));
        int reads = repository.signupReads;
        assertThat(service.freeLimited(oldUser)).isTrue();
        assertThat(service.view(oldUser).limitsEnforced()).isTrue();
        assertThat(repository.signupReads).isEqualTo(reads);
    }

    @Test
    @DisplayName("11월 1일부터 가입한 회원은 바로 한도가 걸리고 응답도 true 다")
    void newUserLimitedAtOnce() {
        SubscriptionService service = service(true);
        assertThat(service.freeLimited(newUser)).isTrue();
        assertThat(service.view(newUser).limitsEnforced()).isTrue();
    }

    @Test
    @DisplayName("Pro 는 한도가 없다")
    void proNotLimited() {
        SubscriptionService service = service(true);
        repository.grant(newUser, Instant.parse("2026-11-01T00:00:00Z"), Instant.parse("2026-12-31T00:00:00Z"));
        assertThat(service.pro(newUser)).isTrue();
        assertThat(service.freeLimited(newUser)).isFalse();
    }

    @Test
    @DisplayName("limitsEnforced=false 이면 누구도 한도가 없다")
    void flagOff() {
        SubscriptionService service = service(false);
        assertThat(service.freeLimited(newUser)).isFalse();
        assertThat(service.freeLimited(oldUser)).isFalse();
    }

    @Test
    @DisplayName("가입 시각은 한 번만 읽는다 / 모르는 사용자는 바로 한도")
    void signupReadOnce() {
        SubscriptionService service = service(true);
        service.freeLimited(oldUser);
        service.freeLimited(oldUser);
        service.freeLimited(oldUser);
        assertThat(repository.signupReads).isEqualTo(1);
        assertThat(service.freeLimited(UUID.randomUUID())).isTrue();
    }
}
