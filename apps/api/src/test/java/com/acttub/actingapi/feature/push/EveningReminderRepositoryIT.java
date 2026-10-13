package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import com.acttub.actingapi.feature.push.app.EveningReminderRepository;
import com.acttub.actingapi.feature.push.app.ReminderTarget;
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
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_fingerprint,created_at) VALUES (?,?, 't','r',repeat('0',64),'paste',?,?)",
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

        assertThat(first).extracting(ReminderTarget::token).containsExactly("token-eligible");
        assertThat(first).extracting(ReminderTarget::userId).containsExactly(eligible);
        assertThat(second).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM evening_reminder_sends WHERE user_id=?", Long.class, eligible))
                .isEqualTo(1L);
    }

    /** 가장 최근 노트 하나만 본다. 그 노트에 해볼 것이 없으면 그 사람은 빠진다. 숨긴 회차와 오래된 노트도 뺀다. */
    @Test void latestNextTakeIsTheNewestVisibleNote() {
        Instant now = Instant.parse("2026-10-14T11:00:00Z");
        Instant since = now.minusSeconds(30L * 86400);
        UUID withAction = user("with-action", true, "0.1.2", now.minusSeconds(86400));
        UUID older = practice(withAction);
        note(older, "예전에 정한 것", now.minusSeconds(5L * 86400));
        UUID newer = practice(withAction);
        note(newer, "상대가 흔들리는지 확인하며 따져 봐도 좋아요.", now.minusSeconds(86400));

        UUID latestObservation = user("latest-observation", true, "0.1.2", now.minusSeconds(86400));
        note(practice(latestObservation), "먼저 정한 것", now.minusSeconds(3L * 86400));
        note(practice(latestObservation), null, now.minusSeconds(86400));

        UUID hidden = user("hidden", true, "0.1.2", now.minusSeconds(86400));
        UUID hiddenPractice = practice(hidden);
        note(hiddenPractice, "숨긴 회차의 제안", now.minusSeconds(86400));
        jdbc.update("UPDATE practices SET hidden_at=now() WHERE id=?", hiddenPractice);

        UUID stale = user("stale-note", true, "0.1.2", now.minusSeconds(86400));
        note(practice(stale), "오래된 제안", now.minusSeconds(40L * 86400));

        UUID other = user("not-asked", true, "0.1.2", now.minusSeconds(86400));
        note(practice(other), "묻지 않은 사람", now.minusSeconds(86400));

        var latest = reminders.latestNextTakes(java.util.List.of(withAction, latestObservation, hidden, stale), since);

        assertThat(latest).containsOnlyKeys(withAction);
        assertThat(latest.get(withAction).text()).isEqualTo("상대가 흔들리는지 확인하며 따져 봐도 좋아요.");
        assertThat(latest.get(withAction).practiceId()).isEqualTo(newer);
        assertThat(reminders.latestNextTakes(java.util.List.of(), since)).isEmpty();
    }

    private UUID practice(UUID owner) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',1,1)",
                videoId, owner, "videos/" + owner + "/" + videoId + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'conversing','legacy','분석','캐릭터 분석')
                """, id, owner, videoId, id);
        return id;
    }

    private void note(UUID practiceId, String nextTake, Instant createdAt) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?, 'closed','user_ended',now())
                """, conversation, practiceId, UUID.randomUUID());
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,next_take,source_revision,created_at)
                VALUES (?,?, 'v2',?,?,1,?)
                """, UUID.randomUUID(), conversation, nextTake == null ? "observation" : "action", nextTake,
                java.sql.Timestamp.from(createdAt));
        jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE id=?", practiceId);
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
