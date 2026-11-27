package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.MutableClock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 출시 주간 Pro(SOMA-899, 11/1~11/7 KST)가 끝난 뒤의 Pro 판정. 그 주간의 grant 계산 갈래를 지워도(SOMA-1176) 11/8 0시(KST)
 * 이후에는 가입 시각과 상관없이 결과가 같다 — 구독도 서버가 준 기간도 없으면 Pro 가 아니고, 서버가 준 기간이 있으면 그 끝을 쓴다.
 */
class ProAfterLaunchWeekTest {
    static final String CLIENT = "test_ck_abcdefgh12345678";
    static final String SECRET = "test_sk_abcdefgh12345678";
    /** 11/8 0시(KST) — 출시 주간이 끝난 시각, 이 작업 날짜, 한참 뒤. */
    static final List<Instant> AFTER_WEEK = List.of(Instant.parse("2026-11-07T15:00:00Z"),
            Instant.parse("2026-11-27T03:00:00Z"), Instant.parse("2027-11-03T03:00:00Z"));
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final MutableClock clock = new MutableClock(AFTER_WEEK.get(0));
    /** 11/1 0시(KST) 직전 가입 — 그 주간에는 카드 없이 Pro 였다. */
    final UUID beforeWeek = UUID.randomUUID();
    /** 출시 주간 안(11/3 KST) 가입. */
    final UUID inWeek = UUID.randomUUID();

    ProAfterLaunchWeekTest() {
        repository.signups.put(beforeWeek, Instant.parse("2026-10-31T14:59:59Z"));
        repository.signups.put(inWeek, Instant.parse("2026-11-03T03:00:00Z"));
    }

    SubscriptionService service() {
        return new SubscriptionService(new BillingSettings(true, false, true, "https://dev.acttub.com",
                "https://acttub.com/pricing/result", CLIENT, SECRET), repository, new FakeGateway(), null, clock,
                BillingMailer.NONE, RefundNotifier.NONE);
    }

    @Test
    @DisplayName("주간이 끝난 뒤에는 그 전에 가입했어도, 그 주간에 가입했어도 구독·서버가 준 기간 없이는 Pro 가 아니다")
    void noProWithoutSubscriptionOrGrant() {
        SubscriptionService service = service();
        for (Instant now : AFTER_WEEK) {
            clock.set(now);
            for (UUID user : List.of(beforeWeek, inWeek)) {
                assertThat(service.pro(user)).as("%s %s", now, user).isFalse();
                SubscriptionService.View view = service.view(user);
                assertThat(view.pro()).as("%s %s", now, user).isFalse();
                assertThat(view.grantEndsAt()).as("%s %s", now, user).isNull();
            }
        }
    }

    @Test
    @DisplayName("서버가 준 기간이 있으면 가입 시각과 상관없이 그 기간의 끝이 grant 끝이다")
    void storedGrantDecides() {
        Instant end = Instant.parse("2027-12-31T15:00:00Z");
        repository.grant(beforeWeek, Instant.parse("2026-11-01T00:00:00Z"), end);
        repository.grant(inWeek, Instant.parse("2026-11-01T00:00:00Z"), end);
        SubscriptionService service = service();
        for (Instant now : AFTER_WEEK) {
            clock.set(now);
            for (UUID user : List.of(beforeWeek, inWeek)) {
                assertThat(service.pro(user)).as("%s %s", now, user).isTrue();
                assertThat(service.view(user).grantEndsAt()).as("%s %s", now, user).isEqualTo(end);
            }
        }
    }

    @Test
    @DisplayName("Pro 판정은 가입 시각을 읽지 않는다")
    void proDoesNotReadSignupTime() {
        SubscriptionService service = service();
        int reads = repository.signupReads;
        for (Instant now : AFTER_WEEK) {
            clock.set(now);
            service.pro(beforeWeek);
            service.pro(inWeek);
        }
        assertThat(repository.signupReads).isEqualTo(reads);
    }
}
