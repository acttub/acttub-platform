package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PostgresCoachPersonasTest {
    @Test void eachAdvisorAlternatesAndStartsFromTheirOwnSide() {
        assertThat(PostgresCoachPersonas.order(0, 0, 0)).isEqualTo("a");
        assertThat(PostgresCoachPersonas.order(0, 0, 1)).isEqualTo("b1");
        assertThat(PostgresCoachPersonas.order(0, 1, 1)).isEqualTo("a");
        assertThat(PostgresCoachPersonas.order(1, 0, 0)).isEqualTo("b1");
        assertThat(PostgresCoachPersonas.order(1, 1, 1)).isEqualTo("b1");
        assertThat(PostgresCoachPersonas.order(-1, 0, 0)).as("음수 해시도 두 쪽 중 하나").isEqualTo("b1");
    }

    @Test void advisorsWhoOnlyGotTheDefaultCatchUpOnB1First() {
        assertThat(PostgresCoachPersonas.order(0, 0, 3)).isEqualTo("b1");
        assertThat(PostgresCoachPersonas.order(1, 2, 3)).isEqualTo("b1");
        assertThat(PostgresCoachPersonas.order(1, 3, 2)).as("b1 이 앞서면 a").isEqualTo("a");
    }

    @Test void emailsAreMatchedByLowercaseTrimmedHash() {
        assertThat(PostgresCoachPersonas.hash(" Someone@Example.com ")).isEqualTo(PostgresCoachPersonas.hash("someone@example.com"))
                .hasSize(64).matches("[0-9a-f]{64}");
    }
}
