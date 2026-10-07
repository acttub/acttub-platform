package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 공지 포스터 표(V29, app.poster)가 지금 홍보를 첫 포스터로 싣고, 값 규칙을 DB 에서도 지키는지 본다.
 * 무료 기간은 V35 에서 10월 31일(KST)까지로 줄였다.
 */
class PosterSchemaMigrationTest {

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void migrate() {
        String url = PostgresContainerSupport.createDatabase("poster_v29");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(dataSource(url));
    }

    @Test
    @DisplayName("app.poster: 고품질 목소리 출시 홍보가 ko·en 두 줄의 첫 포스터로 들어가고 10월 31일에 끝난다")
    void theCloudVoiceLaunchPromotionIsSeeded() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT locale,revision,active,priority,starts_at IS NULL AS open_start,
                       to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
                       array_to_string(platforms,',') AS platforms,min_app_version,frequency,audience,dismissible,
                       badge,title,body,image,audio,cta_label,cta_action,cta_target
                FROM app_posters WHERE slug='cloud-voice-launch' ORDER BY locale
                """);
        assertThat(rows).hasSize(2);
        for (Map<String, Object> row : rows) {
            assertThat(row).containsEntry("revision", 1).containsEntry("active", true).containsEntry("priority", 10)
                    .containsEntry("open_start", true).containsEntry("ends_at", "2026-10-31T15:00:00")
                    .containsEntry("platforms", "ios,android").containsEntry("frequency", "daily")
                    .containsEntry("audience", "cloud_voice_off").containsEntry("dismissible", true)
                    .containsEntry("image", "asset:mascot-reading").containsEntry("audio", "asset:cloud-voice-sample")
                    .containsEntry("cta_action", "cloud_voice_enable");
            assertThat(row.get("min_app_version")).isNull();
            assertThat(row.get("cta_target")).isNull();
        }
        Map<String, Object> en = rows.get(0);
        assertThat(en).containsEntry("locale", "en")
                .containsEntry("badge", "Launch offer · Free until Oct 31")
                .containsEntry("title", "Your scene partner\nreads like a real actor")
                .containsEntry("body", "Hear scene-partner lines in a more natural AI voice during script reading. "
                        + "Free through October.")
                .containsEntry("cta_label", "Turn on for free");
        Map<String, Object> ko = rows.get(1);
        assertThat(ko).containsEntry("locale", "ko")
                .containsEntry("badge", "출시 기념 · 10월 31일까지 무료")
                .containsEntry("title", "상대역이\n진짜 배우처럼 읽어 줘요")
                .containsEntry("body", "대본 리딩 상대 대사를 더 자연스러운 AI 목소리로. 10월 말까지 무료예요.")
                .containsEntry("cta_label", "무료로 켜기");
    }

    @Test
    @DisplayName("app.poster: 기본값은 꺼짐·매일·모두·두 플랫폼·버튼 없음·revision 1 이다")
    void defaultsAreOffDailyEveryoneBothPlatformsAndNoButton() {
        jdbc.update("INSERT INTO app_posters(slug,title) VALUES ('defaults','제목')");
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT revision,active,priority,array_to_string(platforms,',') AS platforms,locale,frequency,audience,
                       dismissible,cta_action,created_at IS NOT NULL AS created,updated_at IS NOT NULL AS updated
                FROM app_posters WHERE slug='defaults'
                """);
        assertThat(row).containsEntry("revision", 1).containsEntry("active", false).containsEntry("priority", 0)
                .containsEntry("platforms", "ios,android").containsEntry("frequency", "daily")
                .containsEntry("audience", "all").containsEntry("dismissible", true)
                .containsEntry("cta_action", "none").containsEntry("created", true).containsEntry("updated", true);
        assertThat(row.get("locale")).isNull();
    }

    @Test
    @DisplayName("app.poster: 값 목록·버튼 대상·판 형식·자산 형식·(slug, 언어) 유일을 DB 가 지킨다")
    void theTableEnforcesItsRules() {
        List<String> rejected = List.of(
                "INSERT INTO app_posters(slug,title,platforms) VALUES ('p1','t','{ios,web}')",
                "INSERT INTO app_posters(slug,title,platforms) VALUES ('p2','t','{}')",
                "INSERT INTO app_posters(slug,title,frequency) VALUES ('p3','t','weekly')",
                "INSERT INTO app_posters(slug,title,audience) VALUES ('p4','t','members')",
                "INSERT INTO app_posters(slug,title,cta_action) VALUES ('p5','t','open')",
                "INSERT INTO app_posters(slug,title,cta_action) VALUES ('p6','t','url')",
                "INSERT INTO app_posters(slug,title,cta_action,cta_target) VALUES ('p7','t','url','http://acttub.com')",
                "INSERT INTO app_posters(slug,title,cta_action,cta_target) VALUES ('p8','t','route','reading')",
                "INSERT INTO app_posters(slug,title,min_app_version) VALUES ('p9','t','0.1.x')",
                "INSERT INTO app_posters(slug,title,image) VALUES ('p10','t','https://example.com/a.png')",
                "INSERT INTO app_posters(slug,title,locale) VALUES ('p11','t','korean')",
                "INSERT INTO app_posters(slug,title,starts_at,ends_at) VALUES ('p12','t',now(),now())");
        for (String sql : rejected) {
            assertThatThrownBy(() -> jdbc.update(sql)).as(sql).isInstanceOf(DataIntegrityViolationException.class);
        }

        jdbc.update("INSERT INTO app_posters(slug,title,cta_action,cta_target,image,min_app_version) "
                + "VALUES ('ok','t','url','https://acttub.com','posters/00000000-0000-4000-8000-000000000001.png','0.1.10')");
        jdbc.update("INSERT INTO app_posters(slug,title) VALUES ('same','모든 언어')");
        jdbc.update("INSERT INTO app_posters(slug,title,locale) VALUES ('same','한국어','ko')");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO app_posters(slug,title) VALUES ('same','또')"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO app_posters(slug,title,locale) VALUES ('same','또','ko')"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
