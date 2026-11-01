package com.acttub.actingapi.feature.blog.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class BlogRulesTest {

    private static BlogDraft draft(String slug, String title, String cover) {
        return new BlogDraft(slug, title, "요약", "practice", cover, "본문", "none", "draft", null);
    }

    @Test
    @DisplayName("읽는 시간은 공백을 뺀 500자당 1분이고 최소 1분이다")
    void readingMinutes() {
        assertThat(BlogRules.readingMinutes("짧은 글")).isEqualTo(1);
        assertThat(BlogRules.readingMinutes("가".repeat(500))).isEqualTo(1);
        assertThat(BlogRules.readingMinutes("가".repeat(501))).isEqualTo(2);
        assertThat(BlogRules.readingMinutes("가 \n".repeat(1000))).isEqualTo(2);
    }

    @Test
    @DisplayName("slug 는 소문자·숫자·하이픈 조합만 받는다")
    void slugShape() {
        for (String ok : new String[] {"a", "voice-warmup-3", "2026-audition"}) {
            assertThat(BlogRules.firstViolation(draft(ok, "제목", null))).as(ok).isNull();
        }
        for (String bad : new String[] {"", "Upper", "-lead", "trail-", "double--dash", "한글", "a_b", "a".repeat(81)}) {
            assertThat(BlogRules.firstViolation(draft(bad, "제목", null))).as(bad).isNotNull();
            assertThat(BlogRules.firstViolation(draft(bad, "제목", null)).field()).isEqualTo("slug");
        }
    }

    @Test
    @DisplayName("제목 120자·요약 160자·표지 주소 모양을 본다")
    void lengthsAndCover() {
        assertThat(BlogRules.firstViolation(draft("a", "가".repeat(120), null))).isNull();
        assertThat(BlogRules.firstViolation(draft("a", "가".repeat(121), null)).field()).isEqualTo("title");
        assertThat(BlogRules.firstViolation(draft("a", "제목", "/v2/blog/images/x.png"))).isNull();
        assertThat(BlogRules.firstViolation(draft("a", "제목", "https://acttub.com/a.png"))).isNull();
        assertThat(BlogRules.firstViolation(draft("a", "제목", "http://acttub.com/a.png")).field()).isEqualTo("cover_image_url");
        assertThat(BlogRules.firstViolation(draft("a", "제목", "//evil.example/a.png")).field()).isEqualTo("cover_image_url");
        var longSummary = new BlogDraft("a", "제목", "가".repeat(161), "news", null, "본문", "none", "draft", null);
        assertThat(BlogRules.firstViolation(longSummary).field()).isEqualTo("summary");
    }

    @Test
    @DisplayName("분류·앱 연결·상태는 정해진 값만 받는다")
    void enums() {
        assertThat(BlogRules.firstViolation(new BlogDraft("a", "t", "s", "other", null, "b", "none", "draft", null)).field())
                .isEqualTo("category");
        assertThat(BlogRules.firstViolation(new BlogDraft("a", "t", "s", "news", null, "b", "web", "draft", null)).field())
                .isEqualTo("app_cta");
        assertThat(BlogRules.firstViolation(new BlogDraft("a", "t", "s", "news", null, "b", "none", "archived", null)).field())
                .isEqualTo("status");
    }
}
