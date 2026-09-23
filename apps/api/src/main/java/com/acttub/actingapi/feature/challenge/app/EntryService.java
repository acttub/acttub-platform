package com.acttub.actingapi.feature.challenge.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryCard;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryPage;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntries;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntry;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.NewEntry;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.stereotype.Service;

/**
 * 참여·수정·삭제·조회수와 참여작 목록 (challenge.entry, challenge.browse). 영상의 실제 길이는 저장소를 읽어 재므로
 * 잠금 트랜잭션보다 먼저 확인하고, 트랜잭션 안에서는 영상 행을 다시 잠가 그 사이의 파기를 본다.
 */
@Service
public class EntryService {
    private static final Set<String> VISIBILITIES = Set.of("public", "private");
    private final EntryRepository entries;
    private final EntryMedia media;
    private final CanonicalJson canonical;
    private final Clock clock;

    public EntryService(EntryRepository entries, EntryMedia media, CanonicalJson canonical, Clock clock) {
        this.entries = entries; this.media = media; this.canonical = canonical; this.clock = clock;
    }

    public EntryRepository.Creation create(UUID owner, UUID challengeId, UUID requestId, UUID videoId,
                                           String rawCaption, String visibility) {
        String caption = caption(rawCaption);
        visibility(visibility, true);
        String fingerprint = fingerprint(Arrays.asList(challengeId.toString(), videoId.toString(), caption, visibility));
        var replay = entries.replay(owner, requestId);
        if (replay != null) {
            if (!fingerprint.equals(replay.fingerprint())) throw new ApiException(422, "request_fingerprint_mismatch");
            return new EntryRepository.Creation(replay.entry(), false);
        }
        var video = entries.video(owner, videoId);
        if (video == null) {
            if (entries.pendingUpload(owner, videoId)) throw new ApiException(422, "video_not_ready");
            throw new ApiException(404, "video_not_found");
        }
        if (video.purged()) throw new ApiException(422, "video_not_ready");
        if (video.declaredDurationMs() > ChallengeRules.ENTRY_VIDEO_MAX_MS
                || media.durationMs(video.objectKey()) > ChallengeRules.ENTRY_VIDEO_MAX_MS) {
            throw new ApiException(422, "video_too_long");
        }
        return entries.create(owner, challengeId, requestId, fingerprint,
                new NewEntry(videoId, caption, visibility), clock.instant());
    }

    public MyEntry update(UUID owner, UUID entryId, String rawCaption, String visibility) {
        String caption = rawCaption == null ? null : caption(rawCaption);
        if (visibility != null) visibility(visibility, false);
        return entries.update(owner, entryId, rawCaption == null ? null : caption == null ? "" : caption, visibility,
                clock.instant());
    }

    public void delete(UUID owner, UUID entryId) { entries.delete(owner, entryId, clock.instant()); }

    public void view(UUID viewer, UUID entryId, UUID eventId) { entries.view(viewer, entryId, eventId, clock.instant()); }

    public EntryPage list(UUID viewer, UUID challengeId, String sort, String cursor, UUID fromEntry) {
        if (!Set.of("likes", "latest").contains(sort)) {
            throw ApiValidationException.valueError(List.of("query", "sort"), "Value error, invalid sort", sort);
        }
        return entries.list(viewer, challengeId, sort, cursor, fromEntry, clock.instant());
    }

    public EntryCard find(UUID viewer, UUID entryId) { return entries.find(viewer, entryId, clock.instant()); }

    public MyEntries mine(UUID owner, String category, String cursor) {
        if (category != null && !Set.of("public", "private", "under_review").contains(category)) {
            throw ApiValidationException.valueError(List.of("query", "visibility"), "Value error, invalid visibility", category);
        }
        return entries.mine(owner, category, cursor, clock.instant());
    }

    /** 앞뒤 공백만 뗀다. 비면 캡션 없음이고 길이는 코드 포인트로 센다. */
    private static String caption(String raw) {
        String trimmed = ChallengeRules.trim(raw);
        if (!ChallengeRules.length(trimmed, 0, ChallengeRules.CAPTION_MAX)) {
            throw ApiValidationException.valueError(List.of("body", "caption"), "Value error, invalid length", raw);
        }
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static void visibility(String value, boolean required) {
        if (value == null && !required) return;
        if (value == null || !VISIBILITIES.contains(value)) {
            throw ApiValidationException.valueError(List.of("body", "visibility"), "Value error, invalid visibility", value);
        }
    }

    private String fingerprint(Object body) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.bytes(body))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
