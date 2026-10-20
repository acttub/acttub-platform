package com.acttub.actingapi.feature.profile.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.PendingConsent;
import com.acttub.actingapi.feature.auth.app.PendingConsentDocuments;
import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.DiscoveryAnswer;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.feature.profile.domain.SignupAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttributionClient;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

/**
 * account.profile: 게이트를 지난 뒤 다른 기기의 탈퇴가 먼저 끝나 저장소가 쓰지 않았으면 403 account_deactivated,
 * 계정이 아예 없으면 404 user_not_found 다. 쓰기마다 같은 판정을 쓴다.
 */
class ProfileServiceRefusalTest {
    final ProfileRepository profiles = mock(ProfileRepository.class);
    final ProfilePhotoStorage photos = mock(ProfilePhotoStorage.class);
    final AccountCleanup cleanup = mock(AccountCleanup.class);
    final AirbridgeAttributionClient airbridge = mock(AirbridgeAttributionClient.class);
    final PendingConsentDocuments consents = mock(PendingConsentDocuments.class);
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    final ProfileService service = new ProfileService(profiles, photos, cleanup, clock, airbridge, consents, "v9");
    final UUID user = UUID.randomUUID();
    final Profile adult = new Profile("김배우", "선택 안 함", LocalDate.of(2000, 1, 1), List.of("매체(TV·영화)"), "5년 이상", "전문 배우", null, null);

    void deactivated() {
        when(profiles.find(user)).thenReturn(new Account(user, null, "deactivated", "member", null));
    }

    void rejects(ThrowingCallable call, int status, String detail) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(status))
                .hasMessage(detail);
    }

    @Test void writesRefusedAfterAnotherDeviceWithdrewAreReportedAsDeactivated() {
        deactivated();
        rejects(() -> service.saveProfile(user, adult), 403, "account_deactivated");
        rejects(() -> service.updateNotificationSettings(user, true, null, null), 403, "account_deactivated");
        rejects(() -> service.recordSignupAttribution(user,
                new SignupAttribution("google", "ios", null, null, null, null, null, null, null, null), "sdk"), 403, "account_deactivated");
        rejects(() -> service.recordDiscoveryAnswer(user, new DiscoveryAnswer("instagram", null, null)), 403, "account_deactivated");
        when(profiles.clearPhoto(eq(user), any())).thenReturn(null);
        rejects(() -> service.deletePhoto(user), 403, "account_deactivated");
    }

    @Test void writesForAMissingAccountAreNotFound() {
        rejects(() -> service.notificationSettings(user), 404, "user_not_found");
        rejects(() -> service.withdraw(user), 404, "user_not_found");
        rejects(() -> service.updateNotificationSettings(user, true, null, null), 404, "user_not_found");
        assertThat(service.completeFor(user)).isFalse();
        assertThat(service.completeProfileOf(user)).isNull();
    }

    @Test void theAirbridgeDeviceIsOnlyKeptWhenEnabledAndTheConsentCoversIt() {
        PendingConsent privacy = mock(PendingConsent.class);
        when(privacy.type()).thenReturn("privacy");
        when(privacy.version()).thenReturn("v8");
        when(consents.currentDocuments()).thenReturn(List.of(privacy));
        when(airbridge.enabled()).thenReturn(false);
        service.recordAirbridgeDevice(user, "ios", "device-1");
        when(airbridge.enabled()).thenReturn(true);
        service.recordAirbridgeDevice(user, "ios", "device-1");
        verify(profiles, never()).recordAirbridgeDevice(any(), anyString(), anyString());

        when(privacy.version()).thenReturn("v9");
        deactivated();
        rejects(() -> service.recordAirbridgeDevice(user, "ios", "device-1"), 403, "account_deactivated");
        when(profiles.recordAirbridgeDevice(user, "ios", "device-1")).thenReturn(true);
        service.recordAirbridgeDevice(user, "ios", "device-1");
        verify(profiles, org.mockito.Mockito.times(2)).recordAirbridgeDevice(user, "ios", "device-1");
    }

    @Test void aPhotoUploadCannotStartOrFinishForAWithdrawnAccount() {
        deactivated();
        when(photos.presignUpload(anyString(), eq("image/jpeg"), eq(1000L), org.mockito.ArgumentMatchers.anyInt())).thenReturn("https://upload");
        rejects(() -> service.beginPhotoUpload(user, "image/jpeg", java.math.BigInteger.valueOf(1000)), 403, "account_deactivated");
        when(profiles.pendingPhotoUpload(user)).thenReturn(new ProfileRepository.PhotoUpload("users/p.jpg", "image/jpeg", 1000, clock.instant().plusSeconds(60)));
        when(photos.sizeOf("users/p.jpg")).thenReturn(1000L);
        when(profiles.completePhotoUpload(eq(user), eq("users/p.jpg"), any())).thenReturn(null);
        rejects(() -> service.completePhotoUpload(user), 403, "account_deactivated");
        verify(cleanup, never()).attempt(any());
    }

    @Test void anUnderageSignupWhoseAccountIsAlreadyGoneStillGetsTheClosedAnswer() {
        when(profiles.find(user)).thenReturn(new Account(user, null, "active", "member", null));
        Profile child = new Profile("어린이", "선택 안 함", LocalDate.of(2020, 1, 1), List.of("매체(TV·영화)"), "1년 미만", "취미", null, null);
        rejects(() -> service.saveProfile(user, child), 422, "under_14_account_closed");
        verify(cleanup, never()).attempt(any());
        verify(profiles, never()).saveProfile(any(), any(), any());
        assertThat(new Profile(null, "남", null, List.of(), null, null, null, null).complete()).isFalse();
        assertThat(new Profile("이름", "남", LocalDate.of(2000, 1, 1), List.of(), "1년", "취미", null, null).complete()).isFalse();
    }
}
