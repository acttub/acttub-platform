package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class ActorMemoryServiceTest {
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final List<String> writes = new ArrayList<>();
    private boolean active = true;

    private final ActorMemoryStore store = new ActorMemoryStore() {
        @Override
        public List<ActorMemory> list(UUID userId) {
            return List.of();
        }

        @Override
        public ActorMemory writeAsActor(UUID userId, String field, String value) {
            writes.add(field + "=" + value);
            return active ? new ActorMemory(field, value, true, null, Instant.EPOCH) : null;
        }

        @Override
        public void delete(UUID userId, String field) {
        }
    };

    @Test
    void valueIsTrimmedBeforeItIsStoredAsTheActors() {
        ActorMemory written = new ActorMemoryService(store).write(USER, "goal", "  무대에서 멈추지 않기 ");

        assertThat(written.value()).isEqualTo("무대에서 멈추지 않기");
        assertThat(writes).containsExactly("goal=무대에서 멈추지 않기");
    }

    @Test
    void accountClosedAfterTheGateGets403AccountDeactivated() {
        active = false;

        assertThatThrownBy(() -> new ActorMemoryService(store).write(USER, "goal", "목표"))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(403);
                    assertThat(exception.getMessage()).isEqualTo("account_deactivated");
                });
        assertThat(writes).containsExactly("goal=목표");
    }

    @Test
    void blankValueIsRejectedWithoutWriting() {
        assertThatThrownBy(() -> new ActorMemoryService(store).write(USER, "goal", "  "))
                .isInstanceOf(BlankMemoryValue.class);
        assertThat(writes).isEmpty();
    }

    @Test
    void valueWithStackedCombiningMarksIsRejectedAndNotStored() {
        assertThatThrownBy(() -> new ActorMemoryService(store).write(USER, "goal", "Z\u0325\u031c\u0318\u0316\u0323x"))
                .isInstanceOf(ApiException.class).hasMessageContaining("unreadable_text");
        assertThat(writes).isEmpty();
    }
}
