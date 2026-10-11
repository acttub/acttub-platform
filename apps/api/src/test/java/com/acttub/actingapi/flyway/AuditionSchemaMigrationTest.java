package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 오디션 공고 표(V36, app.audition)의 값 CHECK 가 domain 의 {@link AuditionRules} 목록과 같은 선을 긋는지 본다 —
 * Java enum 이 없어 {@code ValueCheckCatalogIT} 의 표 밖이기 때문이다.
 */
class AuditionSchemaMigrationTest {

    private static final Pattern LITERAL = Pattern.compile("'((?:[^']|'')*)'::text");

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void migrate() {
        String url = PostgresContainerSupport.createDatabase("audition_v36");
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(dataSource(url));
    }

    @Test
    @DisplayName("출처·분야 CHECK 는 AuditionRules 의 SOURCES·CATEGORIES 와 같은 값 목록이다")
    void valueChecksMatchTheDomainLists() {
        assertThat(checkValues("ck_audition_postings_source")).containsExactlyElementsOf(AuditionRules.SOURCES.keySet());
        assertThat(checkValues("ck_audition_postings_category")).containsExactlyElementsOf(AuditionRules.CATEGORIES);
    }

    @Test
    @DisplayName("(source, source_ref) 는 한 행이고, 모르는 출처·분야는 DB 가 거부한다")
    void uniquenessAndChecksHold() {
        String insert = """
                INSERT INTO audition_postings(source,source_ref,title,category,posted_on,source_url,first_seen_at,
                                              last_seen_at)
                VALUES (?,?,'t',?,'2026-10-08','https://example.com',now(),now())""";
        jdbc.update(insert, "otr", "1", "theater");
        assertThatThrownBy(() -> jdbc.update(insert, "otr", "1", "theater"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "filmmakers", "2", "theater"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "otr", "3", "dance"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static Set<String> checkValues(String constraint) {
        String definition = jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?", String.class, constraint);
        Set<String> values = new LinkedHashSet<>();
        Matcher m = LITERAL.matcher(definition);
        while (m.find()) {
            values.add(m.group(1));
        }
        return values;
    }
}
