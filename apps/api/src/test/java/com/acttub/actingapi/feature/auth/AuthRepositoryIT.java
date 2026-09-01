package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.acttub.actingapi.feature.auth.app.IdentityAlreadyLinkedError;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class AuthRepositoryIT {
    private static final UUID FIRST_USER =
            UUID.fromString("00000000-0000-4000-8000-000000000701");
    private static final UUID SECOND_USER =
            UUID.fromString("00000000-0000-4000-8000-000000000702");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("auth_repository_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    AuthRepository accounts;

    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        insertUser(FIRST_USER, "first@example.test");
        insertUser(SECOND_USER, "second@example.test");
    }

    @Test
    void identityLinkIsIdempotentForItsOwnerAndRejectsAnotherOwner() {
        accounts.linkIdentity(FIRST_USER, "development", "shared-identity");
        accounts.linkIdentity(FIRST_USER, "development", "shared-identity");

        assertThat(identityOwners()).containsExactly(FIRST_USER);

        assertThatThrownBy(() -> accounts.linkIdentity(
                        SECOND_USER, "development", "shared-identity"))
                .isInstanceOf(IdentityAlreadyLinkedError.class);
        assertThat(identityOwners()).containsExactly(FIRST_USER);
    }

    @Test
    void refreshIssuePersistsTheCallersTimestampAndDevice() {
        Instant issuedAt = Instant.parse("2026-09-01T07:30:00.123456Z");
        Instant expiresAt = issuedAt.plusSeconds(3600);
        String hash = "b".repeat(64);

        accounts.issueRefresh(FIRST_USER, hash, expiresAt, "test-device", issuedAt);

        var stored = jdbc.queryForMap("""
                SELECT token_hash,device_info,issued_at,expires_at
                FROM refresh_tokens
                WHERE user_id=?
                """, FIRST_USER);
        assertThat(((String) stored.get("token_hash")).strip()).isEqualTo(hash);
        assertThat(stored).containsEntry("device_info", "test-device");
        assertThat(((Timestamp) stored.get("issued_at")).toInstant()).isEqualTo(issuedAt);
        assertThat(((Timestamp) stored.get("expires_at")).toInstant()).isEqualTo(expiresAt);
    }

    private void insertUser(UUID id, String email) {
        jdbc.update(
                "INSERT INTO users(id,email,status) VALUES (?,?,'active')",
                id,
                email);
    }

    private List<UUID> identityOwners() {
        return jdbc.queryForList(
                "SELECT user_id FROM user_identities ORDER BY created_at",
                UUID.class);
    }
}
