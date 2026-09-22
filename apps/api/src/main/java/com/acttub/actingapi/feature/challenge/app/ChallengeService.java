package com.acttub.actingapi.feature.challenge.app;

import com.acttub.actingapi.platform.web.ApiValidationException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.stereotype.Service;

@Service
public class ChallengeService {
    public record Draft(String line, String work, String character, String sceneNote, int durationDays) { }
    private final ChallengeRepository challenges;
    private final CanonicalJson canonical;
    private final Clock clock;
    public ChallengeService(ChallengeRepository challenges, CanonicalJson canonical, Clock clock) {
        this.challenges = challenges; this.canonical = canonical; this.clock = clock;
    }
    public ChallengeRepository.Creation create(UUID owner, UUID requestId, Draft draft) {
        draft = checked(draft);
        if (!ChallengeRules.duration(draft.durationDays())) throw new ApiException(422, "invalid_duration");
        return challenges.create(owner, requestId, fingerprint(draft), draft, clock.instant());
    }
    public ChallengeRepository.Creation createTeam(UUID requestId, Draft draft, LocalDate featuredOn) {
        draft = checked(draft);
        if (!ChallengeRules.duration(draft.durationDays())) throw new ApiException(422, "invalid_duration");
        return challenges.createTeam(requestId, fingerprint(Arrays.asList(draft, featuredOn == null ? null : featuredOn.toString())),
                draft, featuredOn, clock.instant());
    }

    public ChallengeRepository.Card moderate(UUID id, String moderation) {
        if (!Set.of("visible", "review", "hidden").contains(moderation)) {
            throw ApiValidationException.valueError(
                    List.of("body", "moderation"), "Value error, invalid moderation", moderation);
        }
        var card = challenges.moderate(id, moderation);
        if (card == null) throw new ApiException(404, "challenge_not_found");
        return card;
    }
    public ChallengeRepository.Card find(UUID viewer, UUID id) {
        var card = challenges.find(viewer, id);
        if (card == null) throw new ApiException(404, "challenge_not_found");
        return card;
    }
    public void delete(UUID owner, UUID id) {
        if (!challenges.delete(owner, id, clock.instant())) throw new ApiException(404, "challenge_not_found");
    }
    public ChallengeRepository.Listing list(UUID viewer, String tab, String query, String rawCursor) {
        String normalized = ChallengeRules.normalize(query);
        if (normalized.codePointCount(0, normalized.length()) < 2) normalized = "";
        ChallengeCursor cursor;
        try { cursor = ChallengeCursor.decode(rawCursor, tab, viewer, normalized); }
        catch (IllegalArgumentException | java.time.format.DateTimeParseException invalid) {
            throw ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", rawCursor);
        }
        return challenges.list(viewer, tab, normalized, clock.instant(), cursor);
    }
    private static Draft checked(Draft draft) {
        return new Draft(value(draft.line(), "line", 1, 200), value(draft.work(), "work", 1, 100),
                value(draft.character(), "character", 0, 100), value(draft.sceneNote(), "scene_note", 0, 500), draft.durationDays());
    }

    private static String value(String raw, String field, int min, int max) {
        String normalized = "line".equals(field) ? ChallengeRules.normalize(raw) : ChallengeRules.trim(raw);
        if (!ChallengeRules.length(normalized, min, max)) {
            throw ApiValidationException.valueError(
                    List.of("body", field), "Value error, invalid length", raw);
        }
        return min == 0 && normalized.isEmpty() ? null : normalized;
    }

    private String fingerprint(Object draft) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.bytes(draft))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
