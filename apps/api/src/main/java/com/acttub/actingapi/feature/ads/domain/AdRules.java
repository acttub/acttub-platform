package com.acttub.actingapi.feature.ads.domain;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 광고 값 검사(SOMA-876). 직접 광고는 광고주 이름, http(s) 링크, 붙인 칸마다 그 칸 규격 이미지가 있어야 한다.
 * 자체 광고는 앱 안 경로(/ 로 시작)와 이미지 또는 문구가 있어야 한다.
 */
public final class AdRules {
    public static final Set<String> STATUSES = Set.of("active", "paused", "ended");
    public static final Set<String> AUDIENCES = Set.of("all", "free", "pro");
    public static final int LINK_MAX = 2000;
    public static final int PRIORITY_MAX = 1000;

    private static final Pattern OBJECT_KEY = Pattern.compile(
            "ads/(large_banner|banner|medium_rectangle)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:png|jpg|webp)");

    private AdRules() {
    }

    public record Violation(String field, String message, Object input) {
    }

    /** 이미지 키의 규격 폴더 이름. */
    public static String folder(AdSize size) {
        return size.name().toLowerCase(Locale.ROOT);
    }

    public static boolean isObjectKey(String reference) {
        return reference != null && OBJECT_KEY.matcher(reference).matches();
    }

    /** http(s) 주소인가 — 앱이 그대로 연다. */
    public static boolean validLink(String url) {
        if (url == null || url.length() > LINK_MAX || !url.equals(url.strip())) {
            return false;
        }
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    && uri.getHost() != null && !uri.getHost().isBlank();
        } catch (URISyntaxException invalid) {
            return false;
        }
    }

    public static Optional<Violation> check(AdDraft draft) {
        if (!Ad.DIRECT.equals(draft.kind()) && !Ad.HOUSE.equals(draft.kind())) {
            return violation("kind", "kind must be direct or house", draft.kind());
        }
        if (!STATUSES.contains(draft.status())) {
            return violation("status", "status must be active, paused or ended", draft.status());
        }
        if (!AUDIENCES.contains(draft.audience())) {
            return violation("audience", "audience must be all, free or pro", draft.audience());
        }
        if (draft.priority() < 0 || draft.priority() > PRIORITY_MAX) {
            return violation("priority", "priority must be 0-" + PRIORITY_MAX, draft.priority());
        }
        for (String key : draft.slots()) {
            if (AdSlot.of(key).isEmpty()) {
                return violation("slots", "unknown ad slot", key);
            }
        }
        if (draft.slots().stream().distinct().count() != draft.slots().size()) {
            return violation("slots", "slots must be distinct", draft.slots());
        }
        if (draft.startsAt() != null && draft.endsAt() != null && !draft.endsAt().isAfter(draft.startsAt())) {
            return violation("ends_at", "ends_at must be after starts_at", draft.endsAt());
        }
        Optional<Violation> image = imageViolation(draft);
        if (image.isPresent()) {
            return image;
        }
        return Ad.DIRECT.equals(draft.kind()) ? checkDirect(draft) : checkHouse(draft);
    }

    private static Optional<Violation> checkDirect(AdDraft draft) {
        if (Ad.blank(draft.advertiserName())) {
            return violation("advertiser_name", "advertiser_name must not be blank", draft.advertiserName());
        }
        if (!validLink(draft.linkUrl())) {
            return violation("link_url", "link_url must be an http or https address", draft.linkUrl());
        }
        for (String key : draft.slots()) {
            AdSize size = AdSlot.of(key).orElseThrow().size();
            if (imageOf(draft, size) == null) {
                return violation("image_" + folder(size), "slot " + key + " needs a " + size.width() + "x"
                        + size.height() + " image", null);
            }
        }
        return Optional.empty();
    }

    private static Optional<Violation> checkHouse(AdDraft draft) {
        if (draft.appPath() == null || !draft.appPath().startsWith("/") || draft.appPath().length() > LINK_MAX) {
            return violation("app_path", "app_path must start with /", draft.appPath());
        }
        boolean anyImage = draft.imageLargeBanner() != null || draft.imageBanner() != null
                || draft.imageMediumRectangle() != null;
        if (!anyImage && Ad.blank(draft.headline())) {
            return violation("headline", "house ad needs an image or a headline", draft.headline());
        }
        return Optional.empty();
    }

    private static Optional<Violation> imageViolation(AdDraft draft) {
        for (AdSize size : AdSize.values()) {
            String value = imageOf(draft, size);
            if (value == null) {
                continue;
            }
            boolean ok = value.startsWith("ads/") ? isObjectKey(value) && value.startsWith("ads/" + folder(size) + "/")
                    : validLink(value);
            if (!ok) {
                return violation("image_" + folder(size),
                        "image must be an uploaded " + size.width() + "x" + size.height() + " key or an http(s) address", value);
            }
        }
        return Optional.empty();
    }

    private static String imageOf(AdDraft draft, AdSize size) {
        String value = switch (size) {
            case LARGE_BANNER -> draft.imageLargeBanner();
            case BANNER -> draft.imageBanner();
            case MEDIUM_RECTANGLE -> draft.imageMediumRectangle();
        };
        return Ad.blank(value) ? null : value;
    }

    private static Optional<Violation> violation(String field, String message, Object input) {
        return Optional.of(new Violation(field, message, input));
    }
}
