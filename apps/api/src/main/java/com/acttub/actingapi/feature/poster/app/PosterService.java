package com.acttub.actingapi.feature.poster.app;

import java.math.BigInteger;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.UnaryOperator;

import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
import com.acttub.actingapi.feature.poster.domain.PosterRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;

/**
 * 앱 첫 화면 공지 포스터(app.poster). 앱에는 지금 보일 수 있는 것을 고르고, 운영자에게는 만들기·고치기·이미지
 * 올릴 자리를 준다. 지우기는 없다 — 끄는 것은 {@code active=false} 다.
 */
public final class PosterService {

    /** 앱이 받는 이미지 주소의 수명. */
    public static final int IMAGE_VIEW_TTL_SECONDS = 3600;

    /** 운영자가 이미지를 올릴 자리의 수명. */
    public static final int IMAGE_UPLOAD_TTL_SECONDS = 600;

    public static final long MAX_IMAGE_BYTES = 10L * 1024 * 1024;

    private static final Map<String, String> IMAGE_SUFFIXES = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/webp", ".webp");

    private final PosterRepository posters;
    private final PosterImages images;
    private final Clock clock;

    public PosterService(PosterRepository posters, PosterImages images, Clock clock) {
        this.posters = posters;
        this.images = images;
        this.clock = clock;
    }

    /** 앱이 지금 띄울 수 있는 포스터. 질의 값은 받는 자리에서 이미 검사했다. */
    public List<AppPoster> forApp(String platform, String locale, String appVersion) {
        return PosterRules.forApp(posters.live(platform, locale, clock.instant()), appVersion).stream()
                .map(this::toApp)
                .toList();
    }

    public List<Poster> all() {
        return posters.all();
    }

    public Poster create(PosterDraft draft) {
        requireValid(draft);
        return posters.insert(draft, clock.instant()).orElseThrow(PosterService::duplicate);
    }

    /** 지금 값에 {@code change} 를 얹은 결과로 바꾼다. 보낸 칸만 바뀌는 것은 {@code change} 가 정한다. */
    public Poster update(UUID id, UnaryOperator<PosterDraft> change, boolean bumpRevision) {
        Poster current = posters.find(id).orElseThrow(() -> new ApiException(404, "poster_not_found"));
        PosterDraft next = change.apply(current.draft());
        requireValid(next);
        return posters.update(id, next, bumpRevision, clock.instant()).orElseThrow(PosterService::duplicate);
    }

    /** 운영자가 이미지를 올릴 자리. 올린 뒤 받은 키를 포스터의 {@code image} 에 넣는다. */
    public ImageUpload beginImageUpload(String contentType, BigInteger sizeBytes) {
        String suffix = contentType == null ? null : IMAGE_SUFFIXES.get(contentType);
        if (suffix == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(MAX_IMAGE_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        String key = "posters/" + UUID.randomUUID() + suffix;
        String uploadUrl = images.presignUpload(key, contentType, sizeBytes.longValueExact(), IMAGE_UPLOAD_TTL_SECONDS);
        return new ImageUpload(key, uploadUrl, IMAGE_UPLOAD_TTL_SECONDS);
    }

    public record ImageUpload(String key, String uploadUrl, int expiresIn) {
    }

    private AppPoster toApp(Poster poster) {
        PosterDraft draft = poster.draft();
        String imageUrl = PosterRules.isObjectKey(draft.image())
                ? images.viewUrl(draft.image(), IMAGE_VIEW_TTL_SECONDS)
                : null;
        return new AppPoster(draft.slug(), poster.revision(), draft.frequency(), draft.audience(),
                draft.dismissible(), draft.badge(), draft.title(), draft.body(), imageUrl,
                PosterRules.assetName(draft.image()), PosterRules.assetName(draft.audio()), draft.ctaLabel(),
                draft.ctaAction(), draft.ctaTarget());
    }

    private static void requireValid(PosterDraft draft) {
        PosterRules.check(draft).ifPresent(violation -> {
            throw ApiValidationException.valueError(
                    List.of("body", violation.field()), violation.message(), violation.input());
        });
    }

    private static ApiException duplicate() {
        return new ApiException(422, "duplicate_poster");
    }
}
