package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ReportRepository;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.EntryReportReason;
import com.acttub.actingapi.platform.schema.EntryReportResolution;
import com.acttub.actingapi.platform.schema.EntryReportStatus;
import com.acttub.actingapi.platform.schema.EntryReportTarget;
import com.acttub.actingapi.platform.schema.PgEnum;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 신고 (challenge.report). 신고할 수 있는 것은 신고자가 지금 볼 수 있는 대상이다. 참여작·댓글은 첫 신고와 숨김이
 * 한 트랜잭션이고, 챌린지는 처리되지 않은 신고가 서로 다른 세 사람이 되는 순간 검토로 올린다. 신고자와 작성자에게
 * 서로의 신원을 보이지 않는다.
 */
@Repository
class PostgresEntryReportRepository implements ReportRepository {
    private static final int PAGE = 50;
    private static final EntryReportTarget.JpaConverter TARGETS = new EntryReportTarget.JpaConverter();
    private static final EntryReportReason.JpaConverter REASONS = new EntryReportReason.JpaConverter();
    private static final EntryReportStatus.JpaConverter STATUSES = new EntryReportStatus.JpaConverter();
    private static final EntryReportResolution.JpaConverter RESOLUTIONS = new EntryReportResolution.JpaConverter();
    private final EntryReportJpaRepository reports;
    private final ChallengeEntryJpaRepository entries;
    private final EntryCommentJpaRepository comments;
    private final ChallengeJpaRepository challenges;
    private final EntryLocks locks;
    private final ChallengeSettlement settlement;

    PostgresEntryReportRepository(EntryReportJpaRepository reports, ChallengeEntryJpaRepository entries,
                                  EntryCommentJpaRepository comments, ChallengeJpaRepository challenges, EntryLocks locks,
                                  ChallengeSettlement settlement) {
        this.reports = reports; this.entries = entries; this.comments = comments; this.challenges = challenges;
        this.locks = locks; this.settlement = settlement;
    }

    @Override @Transactional
    public Filed file(UUID reporter, UUID requestId, String fingerprint, NewReport report, Instant now) {
        // 사람 행은 대상 작성자와 함께 id 순서로 잠가야 하므로(EntryLocks) 먼저 잠그지 않고 재전송을 본 뒤, 대상을 잠그고
        // 나서 재전송·하루 한도를 다시 본다.
        EntryReportTarget type = TARGETS.convertToEntityAttribute(report.targetType());
        Filed prior = prior(reporter, requestId, fingerprint, type, report.targetId());
        if (prior != null) return prior;
        UUID id = UUID.randomUUID();
        String text;
        switch (type) {
            case ENTRY -> {
                var target = locks.entry(reporter, report.targetId(), now, true, false);
                if ((prior = guarded(reporter, requestId, fingerprint, type, report.targetId(), now)) != null) return prior;
                if (reporter.equals(target.author())) throw new ApiException(422, "self_report");
                text = target.caption();
                insert(id, reporter, requestId, fingerprint, type, report, target.contentVersion(), text, now);
                if (hidesEntry(report.targetId())) entries.hideByReport(report.targetId(), now);
            }
            case COMMENT -> {
                var comment = lockVisibleComment(reporter, report.targetId());
                if ((prior = guarded(reporter, requestId, fingerprint, type, report.targetId(), now)) != null) return prior;
                if (reporter.equals(comment.userId())) throw new ApiException(422, "self_report");
                text = comment.body();
                insert(id, reporter, requestId, fingerprint, type, report, 1, text, now);
                comments.hide(report.targetId());
            }
            default -> {
                locks.people(reporter, reporter, false);
                var challenge = challenges.lockReportable(report.targetId(), now)
                        .orElseThrow(() -> new ApiException(404, "challenge_not_found"));
                if ((prior = guarded(reporter, requestId, fingerprint, type, report.targetId(), now)) != null) return prior;
                if (reporter.equals(challenge.hostUserId())) throw new ApiException(422, "self_report");
                text = challenge.line();
                insert(id, reporter, requestId, fingerprint, type, report, 1, text, now);
                if (reports.countOpenReporters(type, report.targetId()) >= ChallengeRules.CHALLENGE_REPORT_THRESHOLD) {
                    challenges.sendToReview(report.targetId());
                }
            }
        }
        return new Filed(new Receipt(id, "received"), true, text);
    }

    /**
     * 이 신고로 참여작을 숨기는가. AI 검사를 통과한 참여작은 처리되지 않은 사람 신고가 서로 다른
     * {@link ChallengeRules#PASSED_ENTRY_REPORT_THRESHOLD} 명에게서 모여야 숨긴다 — 한 사람의 악의적 신고로 정상 영상이
     * 내려가지 않게. 검사 전·실패·애매 판정은 지금처럼 신고 하나에 숨긴다.
     */
    private boolean hidesEntry(UUID entryId) {
        if (!"passed".equals(entries.findModerationStatus(entryId).orElse(null))) return true;
        return reports.countOpenUserReporters(EntryReportTarget.ENTRY, entryId) >= ChallengeRules.PASSED_ENTRY_REPORT_THRESHOLD;
    }

    /** 같은 요청의 재전송, 또는 같은 사람의 같은 대상 재신고(처리 뒤라도 다시 숨기지 않는다). 없으면 {@code null}. */
    private Filed prior(UUID reporter, UUID requestId, String fingerprint, EntryReportTarget type, UUID targetId) {
        var byRequest = reports.findByRequest(reporter, requestId);
        if (!byRequest.isEmpty()) {
            if (!fingerprint.equals(byRequest.getFirst().requestFingerprint().strip())) {
                throw new ApiException(422, "request_fingerprint_mismatch");
            }
            return new Filed(receipt(byRequest.getFirst()), false);
        }
        var byTarget = reports.findByTarget(type, targetId, reporter);
        return byTarget.isEmpty() ? null : new Filed(receipt(byTarget.getFirst()), false);
    }

    /** 신고자 행을 잠근 뒤: 그 사이 들어온 같은 요청을 먼저 돌려주고, 아니면 하루 한도를 본다. */
    private Filed guarded(UUID reporter, UUID requestId, String fingerprint, EntryReportTarget type, UUID targetId, Instant now) {
        Filed prior = prior(reporter, requestId, fingerprint, type, targetId);
        if (prior != null) return prior;
        if (reports.countSince(reporter, ChallengeRules.koreanMidnight(now)) >= ChallengeRules.DAILY_REPORTS) {
            throw new ApiException(429, "daily_report_limit");
        }
        return null;
    }

    @Override @Transactional(readOnly = true)
    public AdminReportPage list(String status, String cursor) {
        Instant at = null;
        UUID after = null;
        if (cursor != null && !cursor.isBlank()) {
            try {
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|", -1);
                if (parts.length != 3 || !parts[0].equals(status)) throw new IllegalArgumentException();
                at = Instant.parse(parts[1]);
                after = UUID.fromString(parts[2]);
            } catch (RuntimeException invalid) {
                throw ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", cursor);
            }
        }
        EntryReportStatus wanted = STATUSES.convertToEntityAttribute(status);
        var rows = at == null ? reports.adminPage(wanted, Limit.of(PAGE + 1))
                : reports.adminPageAfter(wanted, at, after, Limit.of(PAGE + 1));
        boolean more = rows.size() > PAGE;
        var page = rows.subList(0, Math.min(rows.size(), PAGE)).stream().map(PostgresEntryReportRepository::admin).toList();
        String next = more ? Base64.getUrlEncoder().withoutPadding().encodeToString((status + "|" + page.getLast().createdAt() + "|"
                + page.getLast().id()).getBytes(StandardCharsets.UTF_8)) : null;
        return new AdminReportPage(page, next);
    }

    /**
     * 판정. 대상 행을 잠그고 이 신고를 처리한 뒤, dismissed 는 그 대상에 처리되지 않은 신고가 남지 않았을 때만
     * 운영 숨김을 푼다. 푸는 것은 숨김뿐이라 작성자의 비공개·삭제·탈퇴와 챌린지 종료는 그대로다. kept_hidden 은 숨김
     * (챌린지는 검토)을 유지한다. 참여작·챌린지 판정 뒤에는 기다리던 종료 순위를 확정해 본다.
     */
    @Override @Transactional
    public AdminReport resolve(UUID id, String resolution, String reviewer, String note, Instant now) {
        var found = reports.findTarget(id).orElseThrow(() -> new ApiException(404, "report_not_found"));
        EntryReportTarget type = found.targetType();
        UUID target = found.targetId();
        UUID challenge = switch (type) {
            case ENTRY -> lockEntryTarget(target, now);
            case COMMENT -> { comments.lockRow(target); yield null; }
            case CHALLENGE -> { challenges.lockRow(target); yield target; }
        };
        if (reports.lockStatus(id).orElseThrow() != EntryReportStatus.RECEIVED) throw new ApiException(422, "report_already_reviewed");
        EntryReportResolution decided = RESOLUTIONS.convertToEntityAttribute(resolution);
        reports.review(id, decided, reviewer, note, now);
        long open = reports.countOpen(type, target);
        // kept_hidden 은 지금 상태(참여작·댓글의 숨김, 챌린지의 검토)를 그대로 둔다. 챌린지를 아예 내릴지는 운영이
        // moderation 경로로 따로 정한다. 참여작은 아직 보이는 채 올라온 것(AI 확인 필요·검사 실패, 검사 통과 뒤 신고 하나)도
        // 있으므로 숨김 유지는 숨긴다.
        if (decided == EntryReportResolution.KEPT_HIDDEN && type == EntryReportTarget.ENTRY) entries.hideByReport(target, now);
        if (decided != EntryReportResolution.KEPT_HIDDEN && open == 0) {
            switch (type) {
                // 운영이 풀었으면 사람이 본 것이다 — AI 판정(숨김·확인 필요·실패)은 통과로 바꾼다.
                case ENTRY -> entries.releaseFromReports(target, ChallengeEntryStatus.VISIBLE);
                case COMMENT -> comments.unhide(target);
                case CHALLENGE -> challenges.releaseFromReview(target);
            }
        }
        if (challenge != null) settlement.settle(challenge, now);
        return admin(reports.adminRow(id).orElseThrow());
    }

    private void insert(UUID id, UUID reporter, UUID requestId, String fingerprint, EntryReportTarget type, NewReport report,
                        int version, String text, Instant now) {
        reports.insert(id, type, report.targetId(), reporter, "user", REASONS.convertToEntityAttribute(report.reason()), report.note(),
                EntryReportStatus.RECEIVED, version, text, requestId, fingerprint, now);
    }

    /** 신고자에게 보이는 댓글(부모 참여작 노출 + 댓글 노출)을 잠근다. 본인 숨김 댓글은 이미 숨겨져 신고할 것이 없다. */
    private EntryCommentJpaRepository.Reported lockVisibleComment(UUID reporter, UUID commentId) {
        var found = comments.findParent(commentId).orElseThrow(() -> new ApiException(404, "comment_not_found"));
        locks.people(reporter, found.userId(), false);
        var locked = comments.lockVisibleTo(commentId, reporter);
        if (locked.isEmpty() || !locks.visible(reporter, found.entryId(), false)) throw new ApiException(404, "comment_not_found");
        return locked.get();
    }

    /** 참여작 판정은 챌린지 → 참여작 순서로 잠근다(마감 집계가 먼저다). */
    private UUID lockEntryTarget(UUID entryId, Instant now) {
        var parent = entries.findChallengeId(entryId);
        if (parent.isEmpty()) return null;
        settlement.settle(parent.get(), now);
        entries.lockRow(entryId);
        return parent.get();
    }

    private static Receipt receipt(EntryReportJpaRepository.Prior row) { return new Receipt(row.id(), row.status().dbValue()); }

    /** 운영 화면의 한 건. 대상의 지금 버전·글·상태는 대상 종류에 맞는 표에서 온다. 대상 행이 없으면 지운 것으로 본다. */
    private static AdminReport admin(EntryReportJpaRepository.AdminRow row) {
        var report = row.report();
        Integer currentVersion = switch (report.getTargetType()) {
            case ENTRY -> row.entryVersion();
            case COMMENT -> row.commentId() == null ? null : 1;
            case CHALLENGE -> row.challengeId() == null ? null : 1;
        };
        String currentText = switch (report.getTargetType()) {
            case ENTRY -> row.entryCaption();
            case COMMENT -> row.commentBody();
            case CHALLENGE -> row.challengeLine();
        };
        PgEnum state = switch (report.getTargetType()) {
            case ENTRY -> row.entryStatus() == ChallengeEntryStatus.VISIBLE ? row.entryVisibility() : row.entryStatus();
            case COMMENT -> row.commentDeletedAt() != null ? null : row.commentStatus();
            case CHALLENGE -> row.challengeDeletedAt() != null ? null : row.challengeModeration();
        };
        Instant created = report.getCreatedAt();
        return new AdminReport(report.getId(), report.getTargetType().dbValue(), report.getTargetId(), report.getReason().dbValue(),
                report.getNote(), report.getStatus().dbValue(), report.getResolution() == null ? null : report.getResolution().dbValue(),
                report.getReviewedBy(), report.getReviewedAt(), report.getResolutionNote(), report.getTargetVersion(), currentVersion,
                report.getTargetText(), currentText, state == null ? "deleted" : state.dbValue(), row.openReports(), created,
                created.plus(Duration.ofHours(24)), created.plus(Duration.ofHours(72)));
    }
}
