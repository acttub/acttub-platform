package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import com.acttub.actingapi.feature.push.app.EveningReminderRepository;
import com.acttub.actingapi.feature.push.app.PushTarget;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = {"JWT_SECRET=test-secret", "EVENING_REMINDER_ENABLED=false"})
class EveningReminderRepositoryIT {
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        String db = PostgresContainerSupport.createDatabaseName("evening_reminder_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(db));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }
    @Autowired JdbcTemplate jdbc;
    @Autowired EveningReminderRepository reminders;

    @Test void filtersActivitySettingsAndVersionsAndClaimsOnlyOnce() {
        Instant start = Instant.parse("2026-09-30T15:00:00Z"); // 2026-10-01 KST
        UUID eligible = user("eligible", true, "0.1.2", start.minusSeconds(86400));
        user("today-practice", true, "0.1.2", start.plusSeconds(60));
        UUID todayReading = user("today-reading", true, "0.1.2", start.minusSeconds(86400));
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,source,request_fingerprint,created_at) VALUES (?,?, 't','r','paste',?,?)",
                UUID.randomUUID(), todayReading, "f".repeat(64), java.sql.Timestamp.from(start.plusSeconds(120)));
        user("stale", true, "0.1.2", start.minusSeconds(31L * 86400));
        user("toggle-off", false, "0.1.2", start.minusSeconds(86400));
        user("old-version", true, "0.1.1", start.minusSeconds(86400));
        user("unknown-version", true, null, start.minusSeconds(86400));
        UUID inactive = user("inactive", true, "0.1.2", start.minusSeconds(86400));
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", inactive);

        var first = reminders.claimTargets(LocalDate.of(2026, 10, 1), start,
                start.plusSeconds(86400), start.minusSeconds(30L * 86400), "0.1.2");
        var second = reminders.claimTargets(LocalDate.of(2026, 10, 1), start,
                start.plusSeconds(86400), start.minusSeconds(30L * 86400), "0.1.2");

        assertThat(first).extracting(PushTarget::token).containsExactly("token-eligible");
        assertThat(second).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM evening_reminder_sends WHERE user_id=?", Long.class, eligible))
                .isEqualTo(1L);
    }

    private UUID user(String name, boolean enabled, String version, Instant activity) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,?, 'active')", id, name + "@test.invalid");
        jdbc.update("INSERT INTO user_profiles(user_id,name,notify_evening_reminder) VALUES (?,?,?)", id, name, enabled);
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform,locale,app_version) VALUES (?,?,'ios','ko',?)",
                id, "token-" + name, version);
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                UUID.randomUUID(), id, "video/" + id, java.sql.Timestamp.from(activity));
        return id;
    }
}
