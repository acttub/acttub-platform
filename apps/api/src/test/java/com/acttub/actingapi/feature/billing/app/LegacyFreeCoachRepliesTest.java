package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachEngine;
import com.acttub.actingapi.feature.coach.app.CoachFreeReplies;
import com.acttub.actingapi.feature.coach.app.CoachMemory;
import com.acttub.actingapi.feature.coach.app.CoachProfile;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.coach.app.NoteWriter;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 무료 코칭 답 상한(SOMA-1131)도 무료 한도 판정({@link SubscriptionService#freeLimited})을 그대로 따른다 — 10월까지 가입한 회원은
 * 12/1 00:00(KST) 전까지 상한 24 그대로다. 판정은 billing adapter 의 BillingCoachFreeReplies 와 같다(freeLimited 면 7).
 */
class LegacyFreeCoachRepliesTest {
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-10T01:00:00Z"));
    final InMemoryBillingRepository repository = new InMemoryBillingRepository();
    final UUID octoberUser = UUID.randomUUID();
    final UUID novemberUser = UUID.randomUUID();
    final SubscriptionService subscriptions = new SubscriptionService(new BillingSettings(true, false, true, "https://dev.acttub.com",
            "https://acttub.com/pricing/result", LegacyFreeLimitsTest.CLIENT, LegacyFreeLimitsTest.SECRET), repository, new FakeGateway(), null, clock);
    final ConversationService conversations = new ConversationService(mock(ConversationRepository.class), mock(CoachEngine.class),
            mock(NoteWriter.class), clock, null, mock(CoachProfile.class), mock(CoachMemory.class), new RecordingFailureReporter(), null)
            .withFreeReplies(userId -> subscriptions.freeLimited(userId) ? 7 : 0);

    LegacyFreeCoachRepliesTest() {
        repository.termsV2 = Instant.parse("2026-11-01T00:00:00Z");
        repository.signups.put(octoberUser, Instant.parse("2026-10-20T00:00:00Z"));
        repository.signups.put(novemberUser, Instant.parse("2026-11-05T00:00:00Z"));
    }

    @Test
    @DisplayName("10월 가입 회원은 12/1 전까지 24, 12/1 00:00(KST)부터 8 — 11월 가입 회원은 바로 8")
    void octoberMembersKeepTheFullConversationUntilDecember() {
        clock.set(Instant.parse("2026-11-30T14:59:59Z"));
        assertThat(conversations.replyLimit(octoberUser, "three_layers_v1")).isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
        assertThat(conversations.replyLimit(novemberUser, "three_layers_v1")).isEqualTo(8);
        clock.set(Instant.parse("2026-11-30T15:00:00Z"));
        assertThat(conversations.replyLimit(octoberUser, "three_layers_v1")).isEqualTo(8);
    }

    @Test
    @DisplayName("Pro 는 상한 24 그대로다")
    void proKeepsTheFullConversation() {
        repository.grant(novemberUser, Instant.parse("2026-11-01T00:00:00Z"), Instant.parse("2026-12-31T00:00:00Z"));
        assertThat(CoachFreeReplies.coachReplyCap(userId -> subscriptions.freeLimited(userId) ? 7 : 0, novemberUser)).isZero();
        assertThat(conversations.replyLimit(novemberUser, "three_layers_v1")).isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
    }
}
