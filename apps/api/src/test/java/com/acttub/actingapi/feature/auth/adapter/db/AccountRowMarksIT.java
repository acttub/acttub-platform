package com.acttub.actingapi.feature.auth.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AgeConfirmation;
import com.acttub.actingapi.feature.auth.app.ExitSurveyAsk;
import com.acttub.actingapi.feature.auth.app.MemoryEpoch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 행({@code users})에 얹힌 다른 기능의 칸 셋을 고치는 Port({@link AgeConfirmation}, {@link ExitSurveyAsk},
 * {@link MemoryEpoch})의 결과를 실제 PostgreSQL 에서 본다. 이 칸들을 쓰는 흐름 전체는 {@code ConsentEndpointIT}·
 * {@code ExitSurveyIT}·{@code ActorMemoryIT}·{@code GuestTransferIT} 가 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class AccountRowMarksIT {

    @Autowired
    AgeConfirmation ages;

    @Autowired
    ExitSurveyAsk asks;

    @Autowired
    MemoryEpoch epochs;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TransactionTemplate transaction;

    private final Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    private UUID user;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        user = account("active");
    }

    @Test
    @DisplayName("나이 확인: 아직 확인하지 않은 계정에만 적는다. 다시 확인해도 처음 시각이 남는다")
    void ageConfirmationKeepsTheFirstTime() {
        assertThat(ages.confirmed(user)).isFalse();
        assertThat(ages.confirmed(UUID.randomUUID())).as("없는 계정").isFalse();

        ages.confirm(user, now);
        ages.confirm(user, now.plusSeconds(60));

        assertThat(ages.confirmed(user)).isTrue();
        assertThat(jdbc.queryForMap("SELECT age_confirmed_at,updated_at FROM users WHERE id=?", user))
                .containsEntry("age_confirmed_at", Timestamp.from(now))
                .containsEntry("updated_at", Timestamp.from(now));
    }

    @Test
    @DisplayName("설문 노출 선점: 활성 계정이 처음 물을 때만 이긴다. 다시 묻거나 탈퇴한 계정이면 진다")
    void exitSurveyAskIsClaimedOnceByAnActiveAccount() {
        UUID closed = account("deactivated");

        assertThat(asks.claim(user, now)).isTrue();
        assertThat(asks.claim(user, now.plusSeconds(60))).as("두 번째").isFalse();
        assertThat(asks.claim(closed, now)).as("탈퇴한 계정").isFalse();
        assertThat(asks.claim(UUID.randomUUID(), now)).as("없는 계정").isFalse();

        assertThat(jdbc.queryForObject("SELECT exit_survey_asked_at FROM users WHERE id=?", Timestamp.class, user))
                .isEqualTo(Timestamp.from(now));
        assertThat(jdbc.queryForObject("SELECT exit_survey_asked_at FROM users WHERE id=?", Timestamp.class, closed)).isNull();
    }

    @Test
    @DisplayName("설문 표식 넘기기: 게스트에게 물어봤으면 회원도 물어본 것이고, 둘 다면 먼저 시각이 남는다. 게스트에게 묻지 않았으면 회원은 그대로다")
    void exitSurveyAskCarriesOverTheEarlierTime() {
        UUID askedGuest = asked(now.minusSeconds(100));
        UUID freshGuest = account("active");
        UUID freshMember = account("active");
        UUID earlierMember = asked(now.minusSeconds(500));
        UUID laterMember = asked(now.minusSeconds(10));
        UUID untouchedMember = asked(now.minusSeconds(10));

        transaction.executeWithoutResult(tx -> {
            asks.carryOver(askedGuest, freshMember);
            asks.carryOver(askedGuest, earlierMember);
            asks.carryOver(askedGuest, laterMember);
            asks.carryOver(freshGuest, untouchedMember);
        });

        assertThat(askedAt(freshMember)).isEqualTo(Timestamp.from(now.minusSeconds(100)));
        assertThat(askedAt(earlierMember)).isEqualTo(Timestamp.from(now.minusSeconds(500)));
        assertThat(askedAt(laterMember)).isEqualTo(Timestamp.from(now.minusSeconds(100)));
        assertThat(askedAt(untouchedMember)).isEqualTo(Timestamp.from(now.minusSeconds(10)));
        assertThat(askedAt(askedGuest)).as("게스트 행은 그대로다").isEqualTo(Timestamp.from(now.minusSeconds(100)));
    }

    @Test
    @DisplayName("기억 세대: 부를 때마다 그 계정만 하나 오른다. 부르는 쪽의 트랜잭션이 되돌아가면 함께 되돌아간다")
    void memoryEpochGoesUpByOneInsideTheCallersTransaction() {
        UUID other = account("active");

        transaction.executeWithoutResult(tx -> epochs.bump(user));
        transaction.executeWithoutResult(tx -> epochs.bump(user));
        transaction.executeWithoutResult(tx -> {
            epochs.bump(user);
            tx.setRollbackOnly();
        });

        assertThat(jdbc.queryForObject("SELECT memory_epoch FROM users WHERE id=?", Integer.class, user)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT memory_epoch FROM users WHERE id=?", Integer.class, other)).isZero();
    }

    private UUID account(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status,deactivated_at) VALUES (?,?,CASE WHEN ?='deactivated' THEN now() END)",
                id, status, status);
        return id;
    }

    private UUID asked(Instant at) {
        UUID id = account("active");
        jdbc.update("UPDATE users SET exit_survey_asked_at=? WHERE id=?", Timestamp.from(at), id);
        return id;
    }

    private Timestamp askedAt(UUID id) {
        return jdbc.queryForObject("SELECT exit_survey_asked_at FROM users WHERE id=?", Timestamp.class, id);
    }
}
