package com.acttub.actingapi.feature.profile.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository.Abandoned;
import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository.CleanupOperation;
import com.acttub.actingapi.integration.oidc.AppleTokenClient;
import com.acttub.actingapi.integration.oidc.KakaoUserClient;
import com.acttub.actingapi.integration.oidc.NaverTokenClient;
import com.acttub.actingapi.integration.revenuecat.RevenueCatCustomerClient;
import com.acttub.actingapi.integration.revenuecat.RevenueCatUnavailable;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AccountSecrets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 탈퇴 정리 장부의 RevenueCat 고객 삭제(SOMA-818). 장부·RevenueCat 은 가짜다 — 외부 호출 없음. */
class AccountCleanupRevenueCatTest {
    static final Instant NOW = Instant.parse("2026-11-01T00:00:00Z");
    static final UUID USER = UUID.fromString("11111111-2222-4333-8444-555555555555");
    static final UUID OP = UUID.fromString("99999999-2222-4333-8444-555555555555");

    final AccountCleanupRepository operations = mock(AccountCleanupRepository.class);
    final RevenueCatCustomerClient revenueCat = mock(RevenueCatCustomerClient.class);
    final FailureReporter reporter = mock(FailureReporter.class);
    final AccountSecrets secrets = new AccountSecrets("jwt-secret", "hash-key", "encryption-key");
    final AccountCleanup cleanup = new AccountCleanup(operations, mock(ProfilePhotoStorage.class),
            mock(AppleTokenClient.class), mock(KakaoUserClient.class), mock(NaverTokenClient.class), revenueCat,
            secrets, reporter, Clock.fixed(NOW, ZoneOffset.UTC));

    private CleanupOperation operation(int attempts) {
        return new CleanupOperation(OP, USER, "revenuecat_delete", secrets.encrypt(USER.toString()), attempts);
    }

    @Test
    @DisplayName("revenuecat_delete 는 장부의 값(우리 user id)으로 RevenueCat 고객을 지우고 성공을 적는다")
    void deletesCustomerWithUserId() {
        when(operations.claim(eq(List.of(OP)), eq(NOW), any())).thenReturn(List.of(operation(1)));

        cleanup.attempt(List.of(OP));

        verify(revenueCat).delete(USER.toString());
        verify(operations).succeeded(OP);
        verify(operations, never()).failed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("RevenueCat 이 실패하면 탈퇴를 막지 않고 실패를 적어 다음 시도를 미루고 보고한다")
    void failureIsRetriedNotThrown() {
        when(operations.claim(eq(List.of(OP)), eq(NOW), any())).thenReturn(List.of(operation(1)));
        org.mockito.Mockito.doThrow(new RevenueCatUnavailable("revenuecat customer delete answered 500"))
                .when(revenueCat).delete(any());

        cleanup.attempt(List.of(OP));

        verify(operations, never()).succeeded(any());
        verify(operations).failed(eq(OP), eq("RevenueCatUnavailable"), eq(NOW.plus(AccountCleanup.retryDelay(1))), eq(NOW));
        verify(reporter).report(any(RevenueCatUnavailable.class), any(FailureContext.class));
    }

    @Test
    @DisplayName("7일 동안 못 지워 포기하면 운영자에게 따로 알린다")
    void abandonedDeletionIsReported() {
        when(operations.removeExpired(NOW)).thenReturn(
                List.of(new Abandoned(OP, USER, "revenuecat_delete", 12, "RevenueCatUnavailable")));
        when(operations.claimDue(eq(NOW), anyInt(), any())).thenReturn(List.of());

        cleanup.runDue();

        ArgumentCaptor<Throwable> failure = ArgumentCaptor.forClass(Throwable.class);
        ArgumentCaptor<FailureContext> context = ArgumentCaptor.forClass(FailureContext.class);
        verify(reporter).report(failure.capture(), eq(FailureKind.EXTERNAL), context.capture());
        assertThat(failure.getValue()).isInstanceOf(AccountCleanup.RevenueCatDeletionAbandoned.class)
                .hasMessageNotContaining(USER.toString());
        assertThat(context.getValue().location()).isEqualTo("AccountCleanup.revenueCatDeletionAbandoned");
    }
}
