package com.acttub.actingapi.feature.memory.adapter.db;

import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code enqueue_memory_update} 의 멱등은 request_id 가 파이썬 {@code uuid5} 와 <b>정확히</b>
 * 같을 때만 성립한다. 다르면 같은 연습이 두 잡이 되어 모델을 두 번 부르는데, 응답은
 * 정상이라 아무도 모른다. 기대값은 파이썬으로 계산해 박아 둔다.
 */
class MemoryUuid5Test {
    private static final UUID NAMESPACE = UUID.fromString("6f3a1d52-8c47-4b19-9e0a-2d5c7b41f8e3");

    @Test
    @DisplayName("uuid5 가 파이썬 uuid.uuid5 와 같은 값을 낸다 (v3/MD5 가 아니다)")
    void matchesPythonUuid5() {
        assertThat(PostgresMemoryRepository.uuid5(NAMESPACE, "00000000-0000-4000-8000-000000000702"))
                .isEqualTo(UUID.fromString("b6e55667-dd18-5982-bd36-30d2c368b89d"));
        assertThat(PostgresMemoryRepository.uuid5(NAMESPACE, "11111111-2222-4333-8444-555555555555"))
                .isEqualTo(UUID.fromString("ba0c6b44-0567-5185-8f6f-2bbaea425562"));
        // UUID.nameUUIDFromBytes 는 v3 라 이 값과 달라야 한다 — 실수로 갈아끼우면 여기서 걸린다.
        assertThat(PostgresMemoryRepository.uuid5(NAMESPACE, "00000000-0000-4000-8000-000000000702").version())
                .isEqualTo(5);
    }
}
