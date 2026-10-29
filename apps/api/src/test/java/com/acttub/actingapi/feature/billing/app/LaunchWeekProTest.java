package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.MutableClock;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 출시 주간 Pro(SOMA-899) — 11/1 0시(KST) 전 가입자는 11/1~11/7 카드 없이 Pro 다. */
class LaunchWeekProTest {
    static final String CLIENT = "test_ck_abcdefgh12345678";
    static final String SECRET = "test_sk_abcdefgh12345678";
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-03T03:00:00Z"));
    final UUID oldUser = UUID.randomUUID();
    final UUID newUser = UUID.randomUUID();

    LaunchWeekProTest() {
        repository.signups.put(oldUser, Instant.parse("2026-10-31T14:59:59Z")); // 10/31 23:59:59 KST
        repository.signups.put(newUser, Instant.parse("2026-10-31T15:00:00Z")); // 11/1 00:00 KST
    }

    SubscriptionService service() {
        return new SubscriptionService(new BillingSettings(true, false, true, "https://dev.acttub.com",
                "https://acttub.com/pricing/result", CLIENT, SECRET), repository, new FakeGateway(), null, clock);
    }

    @Test
    @DisplayName("11/1 0시 전 가입자는 11/1~11/7 Pro 이고, 끝 시각은 11/8 0시(KST)다")
    void oldMemberIsProDuringLaunchWeek() {
        SubscriptionService service = service();
        assertThat(service.pro(oldUser)).isTrue();
        SubscriptionService.View view = service.view(oldUser);
        assertThat(view.pro()).isTrue();
        assertThat(view.grantEndsAt()).isEqualTo(Instant.parse("2026-11-07T15:00:00Z"));
    }

    @Test
    @DisplayName("11/1 0시부터 가입한 사람은 출시 주간 Pro 가 아니다")
    void newMemberIsNot() {
        assertThat(service().pro(newUser)).isFalse();
    }

    @Test
    @DisplayName("주간 밖(10/31 23:59, 11/8 0시)에는 아무도 출시 주간 Pro 가 아니고 가입 시각도 읽지 않는다")
    void outsideTheWeek() {
        SubscriptionService service = service();
        clock.set(Instant.parse("2026-10-31T14:59:59Z"));
        int reads = repository.signupReads;
        assertThat(service.pro(oldUser)).isFalse();
        clock.set(Instant.parse("2026-11-07T15:00:00Z"));
        assertThat(service.pro(oldUser)).isFalse();
        assertThat(repository.signupReads).isEqualTo(reads);
    }

    @Test
    @DisplayName("서버가 준 기간이 더 길면 그 끝을 쓴다")
    void longerStoredGrantWins() {
        repository.grant(oldUser, Instant.parse("2026-11-01T00:00:00Z"), Instant.parse("2026-12-31T00:00:00Z"));
        assertThat(service().view(oldUser).grantEndsAt()).isEqualTo(Instant.parse("2026-12-31T00:00:00Z"));
    }

    @Test
    @DisplayName("규칙 — 가입 시각을 모르면 아니다")
    void rule() {
        Instant inWeek = Instant.parse("2026-11-01T00:00:00Z");
        assertThat(BillingRules.launchWeekEnd(null, inWeek)).isNull();
        assertThat(BillingRules.launchWeekEnd(Instant.parse("2026-10-01T00:00:00Z"), inWeek)).isEqualTo(BillingRules.LAUNCH_WEEK_END);
    }
}
