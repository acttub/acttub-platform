package com.acttub.actingapi.feature.profile.adapter.reader;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ActorProfile;
import com.acttub.actingapi.feature.coach.app.CoachProfile;
import com.acttub.actingapi.feature.report.app.ReportProfile;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * account.profile: 코치와 노트가 프로필을 읽는 포트 둘의 구현을 실제 Postgres 로 본다.
 *
 * <p>내주는 것은 <b>완성된</b> 프로필뿐이고, 값은 표시말이며, 나이는 한국 시간의 오늘로 센 만 나이다.
 * 그 밖의 경우(프로필 없음·미완성·게스트)는 {@code null} 이다 — 그때 코치와 노트의 모델 입력은 프로필이
 * 없던 때와 글자 하나 다르지 않다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@Import(MutableClock.Fixture.class)
class ActorProfileReaderIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("actor_profile_reader");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    CoachProfile coach;

    @Autowired
    ReportProfile report;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MutableClock clock;

    UUID user;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        // 한국 시간 2026-10-02 12:00.
        clock.set(Instant.parse("2026-10-02T03:00:00Z"));
    }

    @Test
    @DisplayName("account.profile: 완성된 프로필은 표시말과 만 나이로 나가고 생년월일은 나가지 않는다 — 코치와 노트가 같은 것을 받는다")
    void completeProfileIsHandedOverAsLabelsAndAge() {
        profile("female", "2001-03-14", "y1_to_3", "professional", "media", "stage");

        assertThat(coach.completeFor(user)).isEqualTo(new ActorProfile(
                "김배우", "여성", 25, List.of("매체(TV·영화)", "무대(연극·뮤지컬)"), "1–3년", "전문 배우"));
        assertThat(report.completeFor(user)).isEqualTo(new ReportProfile.ActorProfile(
                "김배우", "여성", 25, List.of("매체(TV·영화)", "무대(연극·뮤지컬)"), "1–3년", "전문 배우"));
        assertThat(coach.completeFor(user).toString()).doesNotContain("2001");
    }

    @Test
    @DisplayName("account.profile: '선택 안 함'도 값이다 — 비우지 않고 그대로 넘긴다")
    void unspecifiedGenderIsAValue() {
        profile("unspecified", "2001-03-14", "before_start", "hobby", "stage");

        assertThat(coach.completeFor(user).gender()).isEqualTo("선택 안 함");
        assertThat(coach.completeFor(user).directions()).containsExactly("무대(연극·뮤지컬)");
        assertThat(coach.completeFor(user).experience()).isEqualTo("입문 전");
        assertThat(coach.completeFor(user).goal()).isEqualTo("취미");
    }

    @Test
    @DisplayName("account.profile: 만 나이는 읽을 때마다 한국 시간의 오늘로 센다 — 생일 전날과 당일이 한 살 차이다")
    void ageIsCountedOnTheKoreanDateEveryTimeItIsRead() {
        profile("female", "2000-10-03", "exam_prep", "audition", "media");

        assertThat(coach.completeFor(user).age()).as("한국 시간 10월 2일").isEqualTo(25);

        // 한국 시간 10월 3일 0시 30분 — UTC 로는 아직 10월 2일이다.
        clock.set(Instant.parse("2026-10-02T15:30:00Z"));

        assertThat(coach.completeFor(user).age()).as("한국 시간 10월 3일").isEqualTo(26);
        assertThat(report.completeFor(user).age()).isEqualTo(26);
    }

    @Test
    @DisplayName("account.profile: 프로필이 없거나 하나라도 비어 있으면 아무것도 내주지 않는다")
    void nothingIsHandedOverUnlessAllSixItemsAreThere() {
        assertThat(coach.completeFor(user)).as("프로필 행이 없다").isNull();
        assertThat(report.completeFor(user)).isNull();
        assertThat(coach.completeFor(UUID.randomUUID())).as("없는 사용자").isNull();

        // 1.0.0 이전 회원 — 옛 닉네임만 이름 칸에 있다.
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'옛 닉네임')", user);
        assertThat(coach.completeFor(user)).isNull();
        assertThat(report.completeFor(user)).isNull();

        // 다섯 칸을 채워도 방향이 없으면 미완성이다.
        jdbc.update("""
                UPDATE user_profiles
                SET gender='female',birth_date=DATE '2001-03-14',experience='exam_prep',goal='hobby'
                WHERE user_id=?
                """, user);
        assertThat(coach.completeFor(user)).isNull();

        jdbc.update("INSERT INTO user_profile_directions(user_id,direction) VALUES (?,'media')", user);
        assertThat(coach.completeFor(user)).isNotNull();
        assertThat(report.completeFor(user)).isNotNull();
    }

    @Test
    @DisplayName("account.profile: 게스트는 프로필이 없다")
    void guestHasNoProfile() {
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid)
                VALUES (?,?,'guest','guest-random')
                """, UUID.randomUUID(), user);

        assertThat(coach.completeFor(user)).isNull();
        assertThat(report.completeFor(user)).isNull();
    }

    private void profile(String gender, String birthDate, String experience, String goal, String... directions) {
        jdbc.update("""
                INSERT INTO user_profiles(user_id,name,gender,birth_date,experience,goal)
                VALUES (?,'김배우',?,CAST(? AS date),?,?)
                """, user, gender, birthDate, experience, goal);
        for (String direction : directions) {
            jdbc.update("INSERT INTO user_profile_directions(user_id,direction) VALUES (?,?)", user, direction);
        }
    }
}
