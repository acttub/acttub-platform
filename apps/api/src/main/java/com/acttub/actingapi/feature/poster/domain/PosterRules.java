package com.acttub.actingapi.feature.poster.domain;

import java.math.BigInteger;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 공지 포스터의 규칙(app.poster). 값 검사는 V29 의 CHECK 와 같은 선을 긋는다 — DB 가 마지막 그물이고, 여기서
 * 먼저 걸러 운영자에게 어느 칸이 틀렸는지 422 로 알린다.
 */
public final class PosterRules {

    /** 앱 한 번에 내주는 최대 장수. */
    public static final int MAX_FOR_APP = 5;

    public static final Set<String> PLATFORMS = Set.of("ios", "android");
    public static final List<String> DEFAULT_PLATFORMS = List.of("ios", "android");
    public static final Set<String> FREQUENCIES = Set.of("daily", "once");
    public static final Set<String> AUDIENCES = Set.of("all", "cloud_voice_off");
    public static final Set<String> CTA_ACTIONS = Set.of("none", "cloud_voice_enable", "route", "url");

    private static final Pattern SLUG = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    private static final Pattern LOCALE = Pattern.compile("[a-z]{2}");
    private static final Pattern VERSION = Pattern.compile("[0-9]+(?:\\.[0-9]+)*");
    private static final Pattern ASSET = Pattern.compile("asset:[a-z0-9-]+");
    private static final Pattern OBJECT_KEY = Pattern.compile(
            "posters/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:png|jpg|webp)");

    private PosterRules() {
    }

    /** 어긴 칸 하나. {@code field} 는 API 의 칸 이름이다. */
    public record Violation(String field, String message, Object input) {
    }

    public static boolean validVersion(String value) {
        return value != null && VERSION.matcher(value).matches();
    }

    public static boolean validLocale(String value) {
        return value != null && LOCALE.matcher(value).matches();
    }

    /** 점으로 나눈 정수끼리 견준다 — {@code 0.1.10 > 0.1.9}. 모자란 자리는 0 이다. 둘 다 {@link #validVersion} 이어야 한다. */
    public static int compareVersions(String left, String right) {
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        for (int index = 0; index < Math.max(a.length, b.length); index++) {
            BigInteger x = index < a.length ? new BigInteger(a[index]) : BigInteger.ZERO;
            BigInteger y = index < b.length ? new BigInteger(b[index]) : BigInteger.ZERO;
            int compared = x.compareTo(y);
            if (compared != 0) {
                return compared;
            }
        }
        return 0;
    }

    /** 최소 판이 없으면 누구나, 있으면 판을 밝힌 그 판 이상의 앱만. */
    public static boolean fitsVersion(String minAppVersion, String appVersion) {
        if (minAppVersion == null) {
            return true;
        }
        return validVersion(appVersion) && compareVersions(appVersion, minAppVersion) >= 0;
    }

    /** {@code asset:<이름>} 의 이름. 자산 표기가 아니면 {@code null}. */
    public static String assetName(String reference) {
        return reference != null && ASSET.matcher(reference).matches() ? reference.substring("asset:".length()) : null;
    }

    /** 운영자가 올린 이미지의 스토리지 객체 키인가. */
    public static boolean isObjectKey(String reference) {
        return reference != null && OBJECT_KEY.matcher(reference).matches();
    }

    /** 이미 기간·플랫폼·언어로 거르고 우선순위대로 늘어선 후보에서 판이 맞는 것만 앞에서 {@link #MAX_FOR_APP} 장. */
    public static List<Poster> forApp(List<Poster> ordered, String appVersion) {
        return ordered.stream()
                .filter(poster -> fitsVersion(poster.draft().minAppVersion(), appVersion))
                .limit(MAX_FOR_APP)
                .toList();
    }

    /** 처음 어긴 칸. 없으면 비어 있다. */
    public static Optional<Violation> check(PosterDraft draft) {
        if (draft.slug() == null || !SLUG.matcher(draft.slug()).matches()) {
            return violation("slug", "slug must be 1-64 lowercase letters, digits or hyphens", draft.slug());
        }
        if (draft.title() == null || draft.title().isBlank()) {
            return violation("title", "title must not be blank", draft.title());
        }
        if (draft.platforms() == null || draft.platforms().isEmpty()
                || !PLATFORMS.containsAll(draft.platforms())
                || new HashSet<>(draft.platforms()).size() != draft.platforms().size()) {
            return violation("platforms", "platforms must be distinct values of ios, android", draft.platforms());
        }
        if (draft.locale() != null && !validLocale(draft.locale())) {
            return violation("locale", "locale must be a two-letter language code", draft.locale());
        }
        if (draft.minAppVersion() != null && !validVersion(draft.minAppVersion())) {
            return violation("min_app_version", "min_app_version must be dot-separated numbers", draft.minAppVersion());
        }
        if (draft.startsAt() != null && draft.endsAt() != null && !draft.startsAt().isBefore(draft.endsAt())) {
            return violation("ends_at", "ends_at must be after starts_at", draft.endsAt().toString());
        }
        if (draft.frequency() == null || !FREQUENCIES.contains(draft.frequency())) {
            return violation("frequency", "frequency must be daily or once", draft.frequency());
        }
        if (draft.audience() == null || !AUDIENCES.contains(draft.audience())) {
            return violation("audience", "audience must be all or cloud_voice_off", draft.audience());
        }
        if (draft.image() != null && assetName(draft.image()) == null && !isObjectKey(draft.image())) {
            return violation("image", "image must be asset:<name> or posters/<uuid>.<png|jpg|webp>", draft.image());
        }
        if (draft.audio() != null && assetName(draft.audio()) == null && !isObjectKey(draft.audio())) {
            return violation("audio", "audio must be asset:<name> or posters/<uuid>.<ext>", draft.audio());
        }
        if (draft.ctaAction() == null || !CTA_ACTIONS.contains(draft.ctaAction())) {
            return violation("cta_action", "cta_action must be none, cloud_voice_enable, route or url",
                    draft.ctaAction());
        }
        if ("route".equals(draft.ctaAction())
                && (draft.ctaTarget() == null || !draft.ctaTarget().startsWith("/"))) {
            return violation("cta_target", "route cta_target must start with /", draft.ctaTarget());
        }
        if ("url".equals(draft.ctaAction())
                && (draft.ctaTarget() == null || !draft.ctaTarget().startsWith("https://"))) {
            return violation("cta_target", "url cta_target must start with https://", draft.ctaTarget());
        }
        return Optional.empty();
    }

    private static Optional<Violation> violation(String field, String message, Object input) {
        return Optional.of(new Violation(field, "Value error, " + message, input));
    }
}
