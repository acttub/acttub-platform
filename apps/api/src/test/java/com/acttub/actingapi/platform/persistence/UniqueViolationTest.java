package com.acttub.actingapi.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;

class UniqueViolationTest {

    @Test
    @DisplayName("원인 사슬 안의 23505 를 그 제약 이름으로만 알아본다")
    void matchesOnlyTheNamedUniqueConstraint() {
        DataIntegrityViolationException slug = wrapped("23505", "uq_blog_posts_slug");

        assertThat(UniqueViolation.of(slug, "uq_blog_posts_slug")).isTrue();
        assertThat(UniqueViolation.of(slug, "uq_app_posters_slug_locale")).isFalse();
        assertThat(UniqueViolation.of(wrapped("23503", "uq_blog_posts_slug"), "uq_blog_posts_slug"))
                .as("외래 키 위반은 같은 이름이어도 아니다").isFalse();
        assertThat(UniqueViolation.of(new DataIntegrityViolationException("no cause"), "uq_blog_posts_slug")).isFalse();
    }

    private static DataIntegrityViolationException wrapped(String sqlState, String constraint) {
        PSQLException postgres = new PSQLException(
                new ServerErrorMessage("SERROR\0C" + sqlState + "\0Mviolation\0n" + constraint + "\0"));
        return new DataIntegrityViolationException("wrapped", new RuntimeException(postgres));
    }
}
