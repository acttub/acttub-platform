package com.acttub.actingapi.feature.billing.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 무료 코칭 한 번의 배우 답 상한(SOMA-1131)은 무료 한도가 걸리는 회원에게만, COACHING_FREE_REPLY_LIMIT 값으로 준다. */
class BillingCoachFreeRepliesTest {
    final SubscriptionService subscriptions = mock(SubscriptionService.class);
    final UUID free = UUID.randomUUID();
    final UUID notLimited = UUID.randomUUID();

    BillingCoachFreeRepliesTest() {
        when(subscriptions.freeLimited(free)).thenReturn(true);
        when(subscriptions.freeLimited(notLimited)).thenReturn(false);
    }

    @Test
    @DisplayName("무료 한도 대상이면 설정값(기본 7), Pro·유예·한도 꺼짐(freeLimited=false)이면 0")
    void onlyFreeLimitedMembersGetTheLimit() {
        var replies = new BillingCoachFreeReplies(subscriptions, 7);
        assertThat(replies.actorReplies(free)).isEqualTo(7);
        assertThat(replies.actorReplies(notLimited)).isZero();
        assertThat(replies.actorReplies(null)).isZero();
    }

    @Test
    @DisplayName("COACHING_FREE_REPLY_LIMIT 가 0 이하면 끄고 결제 상태를 읽지 않는다")
    void zeroOrLessTurnsItOff() {
        assertThat(new BillingCoachFreeReplies(subscriptions, 0).actorReplies(free)).isZero();
        assertThat(new BillingCoachFreeReplies(subscriptions, -3).actorReplies(free)).isZero();
        verify(subscriptions, never()).freeLimited(any());
    }
}
