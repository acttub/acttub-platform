package com.acttub.actingapi.feature.practice.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.RewardedCoachingService;
import com.acttub.actingapi.feature.practice.app.RewardedCoachingService.Outcome;
import com.acttub.actingapi.integration.admob.AdMobRewardVerifier;
import com.acttub.actingapi.integration.admob.AdMobRewardVerifier.AdMobKeysUnavailable;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 보상형 광고 콜백의 서명·오류 변환과 앱 조회(SOMA-1067). 지급 규칙은 RewardedCoachingServiceTest 가 본다. */
class CoachingRewardControllerTest {
    static final String QUERY = "custom_data=0f8fad5b-d9cb-469f-a165-70867728950e&transaction_id=tx1"
            + "&user_id=33333333-3333-4333-8333-333333333333&signature=abc&key_id=1";

    final RewardedCoachingService rewards = mock(RewardedCoachingService.class);
    final AdMobRewardVerifier verifier = mock(AdMobRewardVerifier.class);
    final AccessGate gate = mock(AccessGate.class);
    final CoachingRewardController controller = new CoachingRewardController(rewards, verifier, gate);

    static MockHttpServletRequest callback(String query) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/coaching-rewards/ssv");
        request.setQueryString(query);
        return request;
    }

    @Test
    @DisplayName("서명이 틀리면 403 invalid_signature 이고 지급을 부르지 않는다")
    void badSignatureIsForbidden() {
        when(verifier.verify(QUERY)).thenReturn(false);
        assertThatThrownBy(() -> controller.verify(callback(QUERY)))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status()).isEqualTo(403);
                    assertThat(e.getMessage()).contains("invalid_signature");
                });
        verify(rewards, never()).grant(any(), any(), any());
    }

    @Test
    @DisplayName("Google 공개키를 받지 못하면 503 admob_keys_unavailable — AdMob 이 다시 보낼 수 있다")
    void keysUnavailableIsRetryable() {
        when(verifier.verify(QUERY)).thenThrow(new AdMobKeysUnavailable("down"));
        assertThatThrownBy(() -> controller.verify(callback(QUERY)))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status()).isEqualTo(503);
                    assertThat(e.getMessage()).contains("admob_keys_unavailable");
                });
    }

    @Test
    @DisplayName("서명이 맞으면 user_id·custom_data·transaction_id 로 지급하고 결과를 200 으로 답한다")
    void validSignatureGrants() {
        when(verifier.verify(QUERY)).thenReturn(true);
        when(rewards.grant("33333333-3333-4333-8333-333333333333", "0f8fad5b-d9cb-469f-a165-70867728950e", "tx1"))
                .thenReturn(Outcome.GRANTED);
        assertThat(controller.verify(callback(QUERY))).containsEntry("result", "granted");
    }

    @Test
    @DisplayName("앱 조회는 토큰의 사람으로 묻고, 모양이 틀린 요청 id 는 지급되지 않은 것이다")
    void appQueriesUseTheTokenUser() {
        UUID user = UUID.randomUUID();
        UUID request = UUID.randomUUID();
        MockHttpServletRequest http = new MockHttpServletRequest();
        when(gate.gatedUser(http)).thenReturn(new AuthenticatedUser(user, null, null, false));
        when(rewards.available(user, false)).thenReturn(true);
        when(rewards.granted(user, request)).thenReturn(true);
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThat(controller.status(http, response)).containsEntry("available", true);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(controller.confirm(request.toString(), http, new MockHttpServletResponse())).containsEntry("granted", true);
        assertThat(controller.confirm("nope", http, new MockHttpServletResponse())).containsEntry("granted", false);
    }
}
