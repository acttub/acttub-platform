package com.acttub.actingapi.feature.challenge.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.BlockList;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Blocked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.CommentCreation;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.CommentPage;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Liked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Saved;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.SavedEntries;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReport;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReportPage;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.Filed;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.NewReport;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.stereotype.Service;

/** 좋아요·저장·댓글·차단·신고 (challenge.react, challenge.block, challenge.report). 모양 검사와 요청 지문은 여기서 한다. */
@Service
public class ReactionService {
    private static final Set<String> TARGETS = Set.of("entry", "comment", "challenge");
    private static final Set<String> REASONS = Set.of("copyright", "inappropriate", "spam", "duplicate", "other");
    private static final Set<String> RESOLUTIONS = Set.of("restored", "kept_hidden", "dismissed");
    private final ReactionRepository reactions;
    private final ReportRepository reports;
    private final CanonicalJson canonical;
    private final Clock clock;

    public ReactionService(ReactionRepository reactions, ReportRepository reports, CanonicalJson canonical, Clock clock) {
        this.reactions = reactions; this.reports = reports; this.canonical = canonical; this.clock = clock;
    }

    public Liked like(UUID viewer, UUID entryId, boolean on) { return reactions.like(viewer, entryId, on, clock.instant()); }

    public Saved save(UUID viewer, UUID entryId, boolean on) { return reactions.save(viewer, entryId, on, clock.instant()); }

    public SavedEntries saved(UUID viewer, String cursor) { return reactions.saved(viewer, cursor); }

    public CommentPage comments(UUID viewer, UUID entryId, String cursor) { return reactions.comments(viewer, entryId, cursor); }

    public CommentCreation comment(UUID viewer, UUID entryId, UUID requestId, String rawBody) {
        String body = ChallengeRules.trim(rawBody);
        if (!ChallengeRules.length(body, 1, ChallengeRules.COMMENT_MAX)) {
            throw ApiValidationException.valueError(List.of("body", "body"), "Value error, invalid length", rawBody);
        }
        return reactions.comment(viewer, entryId, requestId, fingerprint(Arrays.asList(entryId.toString(), body)), body,
                clock.instant());
    }

    public void deleteComment(UUID viewer, UUID commentId) { reactions.deleteComment(viewer, commentId, clock.instant()); }

    public Blocked block(UUID viewer, UUID target, boolean on) { return reactions.block(viewer, target, on, clock.instant()); }

    public BlockList blocks(UUID viewer) { return reactions.blocks(viewer); }

    public Filed report(UUID reporter, UUID requestId, String targetType, UUID targetId, String reason, String rawNote) {
        if (!TARGETS.contains(targetType)) {
            throw ApiValidationException.valueError(List.of("body", "target_type"), "Value error, invalid target_type", targetType);
        }
        if (!REASONS.contains(reason)) {
            throw ApiValidationException.valueError(List.of("body", "reason"), "Value error, invalid reason", reason);
        }
        String note = rawNote == null ? "" : ChallengeRules.trim(rawNote);
        if (!ChallengeRules.length(note, 0, ChallengeRules.REPORT_NOTE_MAX)) {
            throw ApiValidationException.valueError(List.of("body", "note"), "Value error, invalid length", rawNote);
        }
        String kept = note.isEmpty() ? null : note;
        return reports.file(reporter, requestId, fingerprint(Arrays.asList(targetType, targetId.toString(), reason, kept)),
                new NewReport(targetType, targetId, reason, kept), clock.instant());
    }

    public AdminReportPage adminReports(String status, String cursor) {
        if (!Set.of("received", "reviewed").contains(status)) {
            throw ApiValidationException.valueError(List.of("query", "status"), "Value error, invalid status", status);
        }
        return reports.list(status, cursor, clock.instant());
    }

    public AdminReport resolve(UUID id, String resolution, String reviewer, String rawNote) {
        if (!RESOLUTIONS.contains(resolution)) {
            throw ApiValidationException.valueError(List.of("body", "resolution"), "Value error, invalid resolution", resolution);
        }
        String who = ChallengeRules.trim(reviewer);
        if (!ChallengeRules.length(who, 1, 100)) {
            throw ApiValidationException.valueError(List.of("body", "reviewer"), "Value error, invalid length", reviewer);
        }
        String note = rawNote == null ? null : ChallengeRules.trim(rawNote);
        return reports.resolve(id, resolution, who, note == null || note.isEmpty() ? null : note, clock.instant());
    }

    private String fingerprint(Object body) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.bytes(body))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
