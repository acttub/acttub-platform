package com.acttub.actingapi.feature.blog.domain;

import java.util.List;
import java.util.regex.Pattern;

/** 블로그 글(app.blog)의 값 규칙. 값 이름은 DB CHECK 와 API 가 같다(V80). */
public final class BlogRules {
    public static final List<String> CATEGORIES = List.of("practice", "admissions", "audition", "news");
    public static final List<String> APP_CTAS = List.of("coaching", "reading", "challenge", "none");
    public static final List<String> STATUSES = List.of("draft", "published");

    public static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");
    public static final int SLUG_MAX = 80;
    public static final int TITLE_MAX = 120;
    public static final int SUMMARY_MAX = 160;
    public static final int COVER_MAX = 500;
    public static final int BODY_MAX = 100_000;

    /** 한국어 읽기 속도: 공백을 뺀 글자 500자가 1분이다. */
    private static final int CHARS_PER_MINUTE = 500;

    private BlogRules() {
    }

    /** 공백을 뺀 코드 포인트 수를 500 으로 올림한다. 최소 1. */
    public static int readingMinutes(String bodyMarkdown) {
        if (bodyMarkdown == null) {
            return 1;
        }
        long chars = bodyMarkdown.codePoints().filter(cp -> !Character.isWhitespace(cp)).count();
        return (int) Math.max(1, (chars + CHARS_PER_MINUTE - 1) / CHARS_PER_MINUTE);
    }

    /** 첫 틀린 칸의 이름과 이유. 모두 맞으면 {@code null}. */
    public static Violation firstViolation(BlogDraft draft) {
        if (draft.slug() == null || draft.slug().length() > SLUG_MAX || !SLUG.matcher(draft.slug()).matches()) {
            return new Violation("slug", "slug must match ^[a-z0-9]+(-[a-z0-9]+)*$ and be at most 80 characters");
        }
        if (isBlank(draft.title()) || draft.title().codePointCount(0, draft.title().length()) > TITLE_MAX) {
            return new Violation("title", "title must be 1 to 120 characters");
        }
        if (isBlank(draft.summary()) || draft.summary().codePointCount(0, draft.summary().length()) > SUMMARY_MAX) {
            return new Violation("summary", "summary must be 1 to 160 characters");
        }
        if (draft.category() == null || !CATEGORIES.contains(draft.category())) {
            return new Violation("category", "category must be one of " + CATEGORIES);
        }
        if (draft.coverImageUrl() != null && !validCover(draft.coverImageUrl())) {
            return new Violation("cover_image_url", "cover_image_url must be an https URL or a path starting with /");
        }
        if (isBlank(draft.bodyMarkdown()) || draft.bodyMarkdown().length() > BODY_MAX) {
            return new Violation("body_markdown", "body_markdown must be 1 to 100000 characters");
        }
        if (draft.appCta() == null || !APP_CTAS.contains(draft.appCta())) {
            return new Violation("app_cta", "app_cta must be one of " + APP_CTAS);
        }
        if (draft.status() == null || !STATUSES.contains(draft.status())) {
            return new Violation("status", "status must be one of " + STATUSES);
        }
        return null;
    }

    private static boolean validCover(String url) {
        return url.length() <= COVER_MAX
                && ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://"))
                && url.chars().noneMatch(Character::isWhitespace);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    public record Violation(String field, String message) {
    }
}
