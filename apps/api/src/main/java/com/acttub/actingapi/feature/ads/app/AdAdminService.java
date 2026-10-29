package com.acttub.actingapi.feature.ads.app;

import java.math.BigInteger;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.UnaryOperator;

import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdRules;
import com.acttub.actingapi.feature.ads.domain.AdSize;
import com.acttub.actingapi.feature.ads.domain.AdStats;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;

/** 광고 운영(SOMA-876) — 등록·수정·이미지 올릴 자리·날짜별 통계. 지우기는 없다: 끄는 것은 status 다. */
public final class AdAdminService {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    public static final int IMAGE_UPLOAD_TTL_SECONDS = 600;
    public static final long MAX_IMAGE_BYTES = 2L * 1024 * 1024;
    public static final int DEFAULT_STATS_DAYS = 30;
    public static final int MAX_STATS_DAYS = 366;
    private static final Map<String, String> IMAGE_SUFFIXES = Map.of(
            "image/png", ".png", "image/jpeg", ".jpg", "image/webp", ".webp");

    private final AdRepository ads;
    private final AdImages images;
    private final Clock clock;

    public AdAdminService(AdRepository ads, AdImages images, Clock clock) {
        this.ads = ads;
        this.images = images;
        this.clock = clock;
    }

    public List<AdStats.Stored> all() {
        return ads.all();
    }

    public AdStats.Stored create(AdDraft draft) {
        requireValid(draft);
        return ads.insert(draft, clock.instant());
    }

    public AdStats.Stored update(UUID id, UnaryOperator<AdDraft> change) {
        AdStats.Stored current = ads.findStored(id).orElseThrow(AdAdminService::notFound);
        AdDraft next = change.apply(current.draft());
        requireValid(next);
        return ads.update(id, next, clock.instant()).orElseThrow(AdAdminService::notFound);
    }

    /** from·to 가 비면 오늘(한국)까지 30일. 양 끝 포함, 최대 366일. */
    public AdStats.Period stats(UUID id, LocalDate from, LocalDate to) {
        ads.findStored(id).orElseThrow(AdAdminService::notFound);
        LocalDate end = to != null ? to : LocalDate.ofInstant(clock.instant(), SEOUL);
        LocalDate start = from != null ? from : end.minusDays(DEFAULT_STATS_DAYS - 1L);
        if (start.isAfter(end)) {
            throw ApiValidationException.valueError(List.<Object>of("query", "from"),
                    "Value error, from must not be after to", start.toString());
        }
        if (start.plusDays(MAX_STATS_DAYS).isBefore(end)) {
            throw ApiValidationException.valueError(List.<Object>of("query", "from"),
                    "Value error, range must be at most " + MAX_STATS_DAYS + " days", start.toString());
        }
        Map<LocalDate, AdStats.Day> byDay = new TreeMap<>();
        ads.dailyEvents(id, start, end).forEach(day -> byDay.put(day.day(), day));
        List<AdStats.Day> days = new ArrayList<>();
        long impressions = 0;
        long clicks = 0;
        for (LocalDate day = start; !day.isAfter(end); day = day.plusDays(1)) {
            AdStats.Day found = byDay.getOrDefault(day, new AdStats.Day(day, 0, 0));
            days.add(found);
            impressions += found.impressions();
            clicks += found.clicks();
        }
        return new AdStats.Period(start, end, days, impressions, clicks);
    }

    /** 운영자가 규격별 이미지를 올릴 자리. 올린 뒤 받은 키를 광고의 그 규격 image 칸에 넣는다. */
    public ImageUpload beginImageUpload(AdSize size, int width, int height, String contentType, BigInteger sizeBytes) {
        if (!fitsSize(size, width, height)) {
            throw ApiValidationException.valueError(List.<Object>of("body", "width"),
                    "Value error, image must be " + size.width() + "x" + size.height() + " (or a 2x-4x multiple)",
                    width + "x" + height);
        }
        String suffix = contentType == null ? null : IMAGE_SUFFIXES.get(contentType);
        if (suffix == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(MAX_IMAGE_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        String key = "ads/" + AdRules.folder(size) + "/" + UUID.randomUUID() + suffix;
        String uploadUrl = images.presignUpload(key, contentType, sizeBytes.longValueExact(), IMAGE_UPLOAD_TTL_SECONDS);
        return new ImageUpload(key, uploadUrl, IMAGE_UPLOAD_TTL_SECONDS);
    }

    /** 규격 그대로이거나 같은 비율의 1~4배. 올리는 쪽이 읽어 알린 크기를 믿는다(서명 업로드라 서버는 파일을 보지 못한다). */
    static boolean fitsSize(AdSize size, int width, int height) {
        for (int scale = 1; scale <= 4; scale++) {
            if (width == size.width() * scale && height == size.height() * scale) {
                return true;
            }
        }
        return false;
    }

    /** 운영 화면 미리보기용 주소. */
    public String viewUrl(String reference) {
        return images.urlFor(reference);
    }

    public record ImageUpload(String key, String uploadUrl, int expiresIn) {
    }

    private static void requireValid(AdDraft draft) {
        AdRules.check(draft).ifPresent(violation -> {
            throw ApiValidationException.valueError(
                    List.<Object>of("body", violation.field()), "Value error, " + violation.message(), violation.input());
        });
    }

    private static ApiException notFound() {
        return new ApiException(404, "ad_not_found");
    }
}
