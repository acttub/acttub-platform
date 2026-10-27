package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PostgresJournalRoleTest {

    // 10/28 dev — AI 가 인물 칸에 배우 이름을 넣어 일지 머리가 「WooYoung 역」으로 보였다.
    @Test void theActorsOwnNameIsNotARole() {
        assertThat(PostgresJournalRepository.roleOrNull("WooYoung", "WooYoung", null)).isNull();
        assertThat(PostgresJournalRepository.roleOrNull(" wooyoung ", null, "WooYoung")).isNull();
    }

    @Test void aRealRoleStaysAndBlankIsUnknown() {
        assertThat(PostgresJournalRepository.roleOrNull("지민", "WooYoung", "WooYoung")).isEqualTo("지민");
        assertThat(PostgresJournalRepository.roleOrNull("  ", "WooYoung", null)).isNull();
        assertThat(PostgresJournalRepository.roleOrNull(null, null, null)).isNull();
    }
}
