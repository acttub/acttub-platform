package com.acttub.actingapi.feature.auth.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 계정을 닫는 순서({@link AccountErasureSequence})가 적힌 그대로 도는지 본다. DB 없이 가짜 구현으로 본다 — 실제 문장의 순서는
 * {@code AccountLifecycleFreezeIT} 가 고정한다.
 */
class AccountErasureSequenceTest {

    private static final UUID USER = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final Instant NOW = Instant.parse("2026-11-20T03:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 20);

    private final List<String> calls = new ArrayList<>();
    private AccountDeactivation.State state = AccountDeactivation.State.ACTIVE;
    private boolean retentionGranted = true;

    @Test
    @DisplayName("활성 계정: 잠금 → 밀린 일 → 상태 전환 → 보관 동의 → AccountErasureStep 순서의 자리들 → 닫은 시각. 구현을 넘긴 순서는 쓰지 않는다")
    void closesInTheWrittenOrderWhateverOrderTheOwnersArrive() {
        AccountErasureStep[] steps = AccountErasureStep.values();
        // 뒤 절반을 맡은 구현을 먼저 넘긴다.
        AccountErasure late = owner("뒤", EnumSet.copyOf(Arrays.asList(steps).subList(steps.length / 2, steps.length)));
        AccountErasure early = owner("앞", EnumSet.copyOf(Arrays.asList(steps).subList(0, steps.length / 2)));

        AccountErasureSequence.Closed closed = sequence(List.of(late, early)).close(USER, false, NOW, TODAY);

        List<String> expected = new ArrayList<>(List.of("lock", "settle", "deactivate", "retention"));
        for (AccountErasureStep step : steps) {
            expected.add((step.ordinal() < steps.length / 2 ? "앞" : "뒤") + ":" + step + ":retain=true");
        }
        expected.add("deactivatedAt");
        assertThat(calls).containsExactlyElementsOf(expected);
        assertThat(closed.deactivatedAt()).isEqualTo(NOW);
        assertThat(closed.cleanupOperationIds())
                .as("구현이 돌려준 장부 id 를 자리 순서대로 모은다")
                .containsExactlyElementsOf(Arrays.stream(steps).map(AccountErasureSequenceTest::cleanupOf).toList());
    }

    @Test
    @DisplayName("이미 닫힌 계정: 밀린 일과 상태 전환을 건너뛰고 파기만 다시 돈다")
    void repeatedCloseSkipsSettlementAndDeactivation() {
        state = AccountDeactivation.State.DEACTIVATED;

        sequence(List.of(owner("모두", EnumSet.allOf(AccountErasureStep.class)))).close(USER, false, NOW, TODAY);

        assertThat(calls).startsWith("lock", "retention").doesNotContain("settle", "deactivate").endsWith("deactivatedAt");
        assertThat(calls).hasSize(3 + AccountErasureStep.values().length);
    }

    @Test
    @DisplayName("없는 계정: null 이고 잠금 뒤로 아무것도 부르지 않는다")
    void missingAccountStopsAfterTheLock() {
        state = null;

        assertThat(sequence(List.of(owner("모두", EnumSet.allOf(AccountErasureStep.class)))).close(USER, false, NOW, TODAY))
                .isNull();
        assertThat(calls).containsExactly("lock");
    }

    @Test
    @DisplayName("영상·녹음을 남기는 것은 보관 동의가 있고 「동의와 무관하게 파기」가 아닐 때뿐이다. 무관하게 파기할 때는 동의를 읽지 않는다")
    void mediaIsRetainedOnlyWithConsentAndWithoutTheOverride() {
        AccountErasureSequence sequence = sequence(List.of(owner("모두", EnumSet.allOf(AccountErasureStep.class))));

        retentionGranted = false;
        sequence.close(USER, false, NOW, TODAY);
        assertThat(calls).contains("retention").anyMatch(call -> call.endsWith("retain=false")).noneMatch(call -> call.endsWith("retain=true"));

        calls.clear();
        retentionGranted = true;
        sequence.close(USER, true, NOW, TODAY);
        assertThat(calls).doesNotContain("retention").noneMatch(call -> call.endsWith("retain=true"));
    }

    @Test
    @DisplayName("맡은 구현이 없는 자리가 있으면 만들 때 실패한다")
    void aStepWithoutAnOwnerFailsAtConstruction() {
        Set<AccountErasureStep> allButOne = EnumSet.complementOf(EnumSet.of(AccountErasureStep.SESSIONS));

        assertThatThrownBy(() -> sequence(List.of(owner("하나 빠짐", allButOne))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("without an owner")
                .hasMessageContaining("SESSIONS");
        assertThatThrownBy(() -> sequence(List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("without an owner");
    }

    @Test
    @DisplayName("한 자리를 두 구현이 맡으면 만들 때 실패한다")
    void aStepWithTwoOwnersFailsAtConstruction() {
        assertThatThrownBy(() -> sequence(List.of(
                owner("모두", EnumSet.allOf(AccountErasureStep.class)),
                owner("겹침", EnumSet.of(AccountErasureStep.PROFILE)))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("two owners")
                .hasMessageContaining("PROFILE");
    }

    private static UUID cleanupOf(AccountErasureStep step) {
        return new UUID(0, step.ordinal());
    }

    private AccountErasure owner(String name, Set<AccountErasureStep> steps) {
        return new Recording(name, steps);
    }

    private AccountErasureSequence sequence(List<AccountErasure> owners) {
        AccountDeactivation accounts = new AccountDeactivation() {
            @Override
            public State lock(UUID userId) {
                calls.add("lock");
                return state;
            }

            @Override
            public void deactivate(UUID userId, Instant now) {
                calls.add("deactivate");
            }

            @Override
            public Instant deactivatedAt(UUID userId) {
                calls.add("deactivatedAt");
                return NOW;
            }
        };
        return new AccountErasureSequence(accounts, (userId, now) -> calls.add("settle"), userId -> {
            calls.add("retention");
            return retentionGranted;
        }, owners);
    }

    private final class Recording implements AccountErasure {
        private final String name;
        private final Set<AccountErasureStep> steps;

        private Recording(String name, Set<AccountErasureStep> steps) {
            this.name = name;
            this.steps = steps;
        }

        @Override
        public Set<AccountErasureStep> steps() {
            return steps;
        }

        @Override
        public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
            calls.add(name + ":" + step + ":retain=" + account.retainMedia());
            return List.of(cleanupOf(step));
        }
    }
}
