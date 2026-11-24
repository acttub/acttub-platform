package com.acttub.actingapi.feature.invite.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.invite.app.InviteRepository.Practice;
import com.acttub.actingapi.feature.invite.app.InviteRepository.RedeemOutcome;
import com.acttub.actingapi.feature.invite.app.InviteRepository.Reward;
import com.acttub.actingapi.feature.invite.app.InviteRepository.State;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 친구 초대의 규칙(SOMA-865) — 스위치, 게스트, 코드 모양·발급, 넣기 거절의 오류 코드, 연습 완료 뒤 지급과 알림. */
class InviteServiceTest {
    private static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");
    private static final UUID ME = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final AuthenticatedUser MEMBER = new AuthenticatedUser(ME, "me@example.com", UserStatus.ACTIVE, false);
    private static final AuthenticatedUser GUEST = new AuthenticatedUser(ME, null, UserStatus.ACTIVE, true);

    private final FakeRepository repository = new FakeRepository();
    private final List<String> notified = new ArrayList<>();
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final MutableClock clock = new MutableClock(NOW);

    private InviteService service(boolean enabled) {
        return new InviteService(new InviteSettings(enabled, 5, Duration.ofDays(7)), repository,
                (user, asInviter) -> notified.add(user + (asInviter ? ":inviter" : ":invitee")), failures, clock);
    }

    @Test
    @DisplayName("스위치가 꺼져 있으면 경로는 404 invite_unavailable 이고 연습 완료는 저장소를 부르지 않는다")
    void disabledHidesTheFeatureAndIgnoresPractice() {
        InviteService service = service(false);

        assertThatThrownBy(() -> service.view(MEMBER)).isInstanceOf(ApiException.class)
                .hasMessage("invite_unavailable")
                .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(404));
        service.onReadingCompleted(ME, UUID.randomUUID());
        service.onConversationClosed(ME, UUID.randomUUID());

        assertThat(repository.calls).isEmpty();
    }

    @Test
    @DisplayName("게스트는 403 invite_member_required")
    void guestIsRejected() {
        assertThatThrownBy(() -> service(true).view(GUEST)).isInstanceOf(ApiException.class)
                .hasMessage("invite_member_required")
                .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(403));
        assertThatThrownBy(() -> service(true).redeem(GUEST, "ABCDEF")).hasMessage("invite_member_required");
    }

    @Test
    @DisplayName("처음 열면 0·O·1·I 가 없는 6자리 코드를 붙이고, 겹치면 새 코드로 다시 시도한다. 다음부터는 같은 코드다")
    void viewAttachesAReadableCode() {
        repository.collisions = 2;
        InviteService.View first = service(true).view(MEMBER);

        assertThat(first.code()).matches("[A-HJ-NP-Z2-9]{6}");
        assertThat(repository.attachAttempts).isEqualTo(3);
        assertThat(service(true).view(MEMBER).code()).isEqualTo(first.code());
        assertThat(first.canRedeem()).isTrue();
        assertThat(first.redeemUntil()).isEqualTo(repository.signedUpAt.plus(Duration.ofDays(7)));
    }

    @Test
    @DisplayName("가입 뒤 7일이 지났거나 이미 넣었으면 코드 넣기 칸을 열지 않는다")
    void canRedeemFollowsTheWindowAndOnce() {
        repository.signedUpAt = NOW.minus(Duration.ofDays(7));
        assertThat(service(true).view(MEMBER).canRedeem()).isFalse();
        assertThat(service(true).view(MEMBER).redeemUntil()).isNull();

        repository.signedUpAt = NOW.minus(Duration.ofDays(1));
        repository.redeemed = true;
        assertThat(service(true).view(MEMBER).canRedeem()).isFalse();
    }

    @Test
    @DisplayName("넣은 글은 대소문자·띄어쓰기·하이픈을 가려 저장소에 넘기고, 모양이 틀리면 저장소에 묻지 않고 404")
    void redeemNormalizesTheCode() {
        service(true).redeem(MEMBER, " abc-d ef ");
        assertThat(repository.redeemedCode).isEqualTo("ABCDEF");
        assertThat(repository.redeemWindow).isEqualTo(Duration.ofDays(7));

        repository.redeemedCode = null;
        for (String bad : new String[] {null, "", "ABCDE", "ABCDEFG", "ABCDE0", "ABCDEO", "ABCDE1", "ABCDEI", "가나다라마바"}) {
            assertThatThrownBy(() -> service(true).redeem(MEMBER, bad)).hasMessage("invite_code_not_found");
        }
        assertThat(repository.redeemedCode).isNull();
    }

    @Test
    @DisplayName("저장소의 거절은 사유마다 오류 코드 하나로 나간다")
    void redeemRejectionsMapToErrorCodes() {
        Map<RedeemOutcome, String> expected = new LinkedHashMap<>();
        expected.put(RedeemOutcome.ALREADY_REDEEMED, "409 invite_already_redeemed");
        expected.put(RedeemOutcome.WINDOW_CLOSED, "409 invite_window_closed");
        expected.put(RedeemOutcome.CODE_NOT_FOUND, "404 invite_code_not_found");
        expected.put(RedeemOutcome.OWN_CODE, "409 own_invite_code");
        expected.put(RedeemOutcome.ACCOUNT_INACTIVE, "403 account_deactivated");
        expected.forEach((outcome, error) -> {
            repository.outcome = outcome;
            assertThatThrownBy(() -> service(true).redeem(MEMBER, "ABCDEF"))
                    .isInstanceOf(ApiException.class)
                    .satisfies(thrown -> assertThat(((ApiException) thrown).status() + " " + thrown.getMessage())
                            .isEqualTo(error));
        });

        repository.outcome = RedeemOutcome.REDEEMED;
        repository.redeemed = true;
        InviteService.View view = service(true).redeem(MEMBER, "ABCDEF");
        assertThat(view.redeemed()).isTrue();
        assertThat(view.canRedeem()).isFalse();
    }

    @Test
    @DisplayName("연습 완료가 지급을 부르면 받은 사람과 초대한 사람에게 차례로 알리고, 이번 달 1일(한국 시간)부터 상한 5로 센다")
    void practiceRewardsBothAndNotifies() {
        UUID inviter = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        repository.reward = Optional.of(new Reward(ME, inviter));

        service(true).onReadingCompleted(ME, session);

        assertThat(repository.rewardCall).isEqualTo(List.of(ME, Practice.READING, session,
                Instant.parse("2026-10-31T15:00:00Z"), 5));
        assertThat(notified).containsExactly(ME + ":invitee", inviter + ":inviter");
    }

    @Test
    @DisplayName("초대한 사람이 상한에 걸려 못 받았으면 받은 사람에게만 알린다. 지급이 없으면 아무에게도 알리지 않는다")
    void inviterOverCapIsNotNotified() {
        repository.reward = Optional.of(new Reward(ME, null));
        service(true).onConversationClosed(ME, UUID.randomUUID());
        assertThat(repository.rewardCall.get(1)).isEqualTo(Practice.COACHING);
        assertThat(notified).containsExactly(ME + ":invitee");

        notified.clear();
        repository.reward = Optional.empty();
        service(true).onReadingCompleted(ME, UUID.randomUUID());
        assertThat(notified).isEmpty();
    }

    @Test
    @DisplayName("지급이나 알림이 실패해도 연습 완료 쪽으로 예외를 내보내지 않고 보고만 한다")
    void failuresNeverReachThePractice() {
        repository.rewardFailure = new IllegalStateException("db down");
        assertThatCode(() -> service(true).onReadingCompleted(ME, UUID.randomUUID())).doesNotThrowAnyException();
        assertThat(failures.contexts()).containsExactly("InviteService.practiced");

        repository.rewardFailure = null;
        repository.reward = Optional.of(new Reward(ME, null));
        InviteService failingPush = new InviteService(new InviteSettings(true, 5, Duration.ofDays(7)), repository,
                (user, asInviter) -> {
                    throw new IllegalStateException("push down");
                }, failures, clock);
        assertThatCode(() -> failingPush.onReadingCompleted(ME, UUID.randomUUID())).doesNotThrowAnyException();
        assertThat(failures.contexts()).containsExactly("InviteService.practiced", "InviteService.notifyRewarded");
    }

    @Test
    @DisplayName("설정은 음수 상한과 0일 기간을 받지 않는다")
    void settingsRejectNonsense() {
        assertThatThrownBy(() -> new InviteSettings(true, -1, Duration.ofDays(7))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new InviteSettings(true, 5, Duration.ZERO)).isInstanceOf(IllegalArgumentException.class);
    }

    private static final class FakeRepository implements InviteRepository {
        final List<String> calls = new ArrayList<>();
        String code;
        int collisions;
        int attachAttempts;
        Instant signedUpAt = NOW.minus(Duration.ofDays(1));
        boolean redeemed;
        RedeemOutcome outcome = RedeemOutcome.REDEEMED;
        String redeemedCode;
        Duration redeemWindow;
        Optional<Reward> reward = Optional.empty();
        RuntimeException rewardFailure;
        List<Object> rewardCall;

        @Override
        public Optional<String> findCode(UUID userId) {
            calls.add("findCode");
            return Optional.ofNullable(code);
        }

        @Override
        public Optional<String> attachCode(UUID userId, String candidate) {
            calls.add("attachCode");
            attachAttempts++;
            if (collisions > 0) {
                collisions--;
                return Optional.empty();
            }
            code = candidate;
            return Optional.of(candidate);
        }

        @Override
        public State state(UUID userId) {
            calls.add("state");
            return new State(signedUpAt, redeemed, false, 0);
        }

        @Override
        public RedeemOutcome redeem(UUID inviteeId, String candidate, Instant now, Duration window) {
            calls.add("redeem");
            redeemedCode = candidate;
            redeemWindow = window;
            return outcome;
        }

        @Override
        public Optional<Reward> rewardIfCounted(UUID inviteeId, Practice practice, UUID practiceId, Instant now,
                Instant monthStart, int inviterCap) {
            calls.add("reward");
            if (rewardFailure != null) {
                throw rewardFailure;
            }
            rewardCall = List.of(inviteeId, practice, practiceId, monthStart, inviterCap);
            return reward;
        }
    }
}
