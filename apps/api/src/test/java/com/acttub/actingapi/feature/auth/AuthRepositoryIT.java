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
        accounts.linkIdentity(FIRST_USER, "development", "shared-identity", null);
        accounts.linkIdentity(FIRST_USER, "development", "shared-identity", null);

        assertThat(identityOwners()).containsExactly(FIRST_USER);

        assertThatThrownBy(() -> accounts.linkIdentity(
                        SECOND_USER, "development", "shared-identity", null))
                .isInstanceOf(IdentityAlreadyLinkedError.class);
        assertThat(identityOwners()).containsExactly(FIRST_USER);
    }

    @Test
    void rotatingAnUnknownOrExpiredRefreshFailsAndTheExpiredOneIsRevoked() {
        Instant issuedAt = Instant.parse("2026-09-01T00:00:00Z");
        accounts.issueRefresh(FIRST_USER, "c".repeat(64), issuedAt.plusSeconds(60), "phone", issuedAt);

        var unknown = accounts.rotate("d".repeat(64), "e".repeat(64), issuedAt.plusSeconds(3600), null,
                issuedAt.plusSeconds(10));
        var expired = accounts.rotate("c".repeat(64), "f".repeat(64), issuedAt.plusSeconds(7200), null,
                issuedAt.plusSeconds(120));

        assertThat(unknown).isEqualTo(new AuthRepository.Rotation(null, false));
        assertThat(expired).isEqualTo(new AuthRepository.Rotation(null, false));
        assertThat(accounts.getRefresh("c".repeat(64)).revokedAt()).isEqualTo(issuedAt.plusSeconds(120));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens", Integer.class)).isEqualTo(1);
    }

    @Test
    void rotationWithoutADeviceKeepsTheOldTokensDevice() {
        Instant issuedAt = Instant.parse("2026-09-01T00:00:00Z");
        accounts.issueRefresh(FIRST_USER, "1".repeat(64), issuedAt.plusSeconds(3600), "tablet", issuedAt);

        var rotation = accounts.rotate("1".repeat(64), "2".repeat(64), issuedAt.plusSeconds(7200), null,
                issuedAt.plusSeconds(10));

        assertThat(rotation.reused()).isFalse();
        assertThat(jdbc.queryForObject("SELECT device_info FROM refresh_tokens WHERE id=?", String.class, rotation.id()))
                .isEqualTo("tablet");
    }

    @Test
    void providersWithoutAStoredTokenNeverLackOneAndStoringIsANoOp() {
        accounts.linkIdentity(FIRST_USER, "google", "g-1", null);

        accounts.storeProviderToken("google", "g-1", "encrypted");

        assertThat(accounts.lacksProviderToken("google", "g-1")).isFalse();
        assertThat(jdbc.queryForObject(
                "SELECT apple_token_encrypted IS NULL AND naver_token_encrypted IS NULL FROM user_identities "
                        + "WHERE provider_uid='g-1'", Boolean.class)).isTrue();
    }

    @Test
    void onlyAnActiveGuestCountsAsAGuest() {
        var guests = (com.acttub.actingapi.feature.auth.app.GuestAccounts) accounts;
        UUID guest = accounts.createGuest("guest-uid-1").id();

        assertThat(guests.activeGuest(guest)).isTrue();
        assertThat(guests.activeGuest(FIRST_USER)).isFalse();
        assertThat(guests.activeGuest(UUID.randomUUID())).isFalse();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", guest);
        assertThat(guests.activeGuest(guest)).isFalse();
    }

    @Test
    void refreshHashMustBeLowercaseSha256Hex() {
        // 저장소 예외 번역이 감싸도 이유는 그대로다.
        assertThatThrownBy(() -> accounts.getRefresh("ABC")).hasRootCauseMessage("expected SHA-256 hex");
        assertThatThrownBy(() -> accounts.getRefresh(null)).hasRootCauseMessage("expected SHA-256 hex");
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
