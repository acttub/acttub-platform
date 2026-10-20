package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachFlows;
import com.acttub.actingapi.feature.coach.app.CoachPersonas;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.app.PriorContext;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 코치 흐름·성격 배정을 실제 사용자 행으로: 자문위원이 아닌 배우는 성격이 없고 흐름은 계정마다 고정된 쪽이다. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false"})
class PostgresCoachAssignmentsIT {
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("coach_assignments");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired CoachFlows flows;
    @Autowired CoachPersonas personas;

    UUID user(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status,email) VALUES (?,'active',?)", id, email);
        return id;
    }

    static CoachSessionSnapshot session(UUID user) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), user, null, "", "", "", 8000, "그 외", "그 외", "",
                "open", "", List.of(), PriorContext.EMPTY, "three_layers_v1", 0, null, null);
    }

    @Test void anOrdinaryActorKeepsTheAccountFlowOnEveryPractice() {
        UUID actor = user("actor-" + UUID.randomUUID() + "@example.com");
        String first = flows.assign(session(actor));
        assertThat(first).isEqualTo(PostgresCoachFlows.byAccount(actor));
        assertThat(flows.assign(session(actor))).isEqualTo(first);
        assertThat(flows.assign(session(null))).isEqualTo(CoachFlows.A);
    }

    @Test void anAccountWithoutEmailIsAnOrdinaryActor() {
        UUID noEmail = user(null);
        assertThat(flows.assign(session(noEmail))).isEqualTo(PostgresCoachFlows.byAccount(noEmail));
        assertThat(personas.assign(session(noEmail))).isEmpty();
    }

    @Test void onlyAdvisorAccountsGetAPersona() {
        assertThat(personas.assign(session(user("actor-" + UUID.randomUUID() + "@example.com")))).isEmpty();
        assertThat(personas.assign(session(null))).isEmpty();
        assertThat(personas.assign(session(UUID.randomUUID()))).as("없는 사용자").isEmpty();
    }
}
