package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ReportRepository;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 신고 (challenge.report). 신고할 수 있는 것은 신고자가 지금 볼 수 있는 대상이다. 참여작·댓글은 첫 신고와 숨김이
 * 한 트랜잭션이고, 챌린지는 처리되지 않은 신고가 서로 다른 세 사람이 되는 순간 검토로 올린다. 신고자와 작성자에게
 * 서로의 신원을 보이지 않는다.
 */
@Repository
class PostgresEntryReportRepository implements ReportRepository {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int PAGE = 50;
    private final EntityManager em;
    private final EntryLocks locks;
    private final ChallengeSettlement settlement;

    PostgresEntryReportRepository(EntityManager em, EntryLocks locks, ChallengeSettlement settlement) {
        this.em = em; this.locks = locks; this.settlement = settlement;
    }

    @Override @Transactional
    public Filed file(UUID reporter, UUID requestId, String fingerprint, NewReport report, Instant now) {
        // 사람 행은 대상 작성자와 함께 id 순서로 잠가야 하므로(EntryLocks) 먼저 잠그지 않고 재전송을 본 뒤, 대상을 잠그고
        // 나서 재전송·하루 한도를 다시 본다.
        Filed prior = prior(reporter, requestId, fingerprint, report);
        if (prior != null) return prior;
        UUID id = UUID.randomUUID();
        switch (report.targetType()) {
            case "entry" -> {
                var target = locks.entry(reporter, report.targetId(), now, true, false);
                if ((prior = guarded(reporter, requestId, fingerprint, report, now)) != null) return prior;
                if (reporter.equals(target.author())) throw new ApiException(422, "self_report");
                insert(id, reporter, requestId, fingerprint, report, target.contentVersion(), target.caption(), now);
                em.createNativeQuery("UPDATE challenge_entries SET status='hidden_by_report',updated_at=:now WHERE id=:id AND status='visible'")
                        .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", report.targetId()).executeUpdate();
            }
            case "comment" -> {
                var comment = lockVisibleComment(reporter, report.targetId(), now);
                if ((prior = guarded(reporter, requestId, fingerprint, report, now)) != null) return prior;
                if (reporter.equals(comment.get("user_id", UUID.class))) throw new ApiException(422, "self_report");
                insert(id, reporter, requestId, fingerprint, report, 1, comment.get("body", String.class), now);
                em.createNativeQuery("UPDATE entry_comments SET status='hidden' WHERE id=:id")
                        .setParameter("id", report.targetId()).executeUpdate();
            }
            default -> {
                locks.people(reporter, reporter, false);
                var challenge = NativeTuples.list(em.createNativeQuery("""
                        SELECT host_user_id,line FROM challenges
                        WHERE id=:id AND deleted_at IS NULL AND moderation='visible' AND starts_at<=:now FOR UPDATE
                        """, Tuple.class).setParameter("id", report.targetId()).setParameter("now", now.atOffset(ZoneOffset.UTC)));
                if (challenge.isEmpty()) throw new ApiException(404, "challenge_not_found");
                if ((prior = guarded(reporter, requestId, fingerprint, report, now)) != null) return prior;
                if (reporter.equals(challenge.getFirst().get("host_user_id", UUID.class))) throw new ApiException(422, "self_report");
                insert(id, reporter, requestId, fingerprint, report, 1, challenge.getFirst().get("line", String.class), now);
                long reporters = ((Number) em.createNativeQuery("""
                        SELECT count(DISTINCT reporter_id) FROM entry_reports
                        WHERE target_type='challenge' AND target_id=:id AND status='received'
                        """).setParameter("id", report.targetId()).getSingleResult()).longValue();
                if (reporters >= ChallengeRules.CHALLENGE_REPORT_THRESHOLD) {
                    em.createNativeQuery("UPDATE challenges SET moderation='review' WHERE id=:id")
                            .setParameter("id", report.targetId()).executeUpdate();
                }
            }
        }
        return new Filed(new Receipt(id, "received"), true);
    }

    /** 같은 요청의 재전송, 또는 같은 사람의 같은 대상 재신고(처리 뒤라도 다시 숨기지 않는다). 없으면 {@code null}. */
    private Filed prior(UUID reporter, UUID requestId, String fingerprint, NewReport report) {
        var byRequest = NativeTuples.list(em.createNativeQuery(
                "SELECT id,status,request_fingerprint FROM entry_reports WHERE reporter_id=:reporter AND request_id=:request", Tuple.class)
                .setParameter("reporter", reporter).setParameter("request", requestId));
        if (!byRequest.isEmpty()) {
            if (!fingerprint.equals(byRequest.getFirst().get("request_fingerprint", String.class).strip())) {
                throw new ApiException(422, "request_fingerprint_mismatch");
            }
            return new Filed(receipt(byRequest.getFirst()), false);
        }
        var byTarget = NativeTuples.list(em.createNativeQuery("""
                SELECT id,status FROM entry_reports WHERE target_type=:type AND target_id=:target AND reporter_id=:reporter
                """, Tuple.class).setParameter("type", report.targetType()).setParameter("target", report.targetId())
                .setParameter("reporter", reporter));
        return byTarget.isEmpty() ? null : new Filed(receipt(byTarget.getFirst()), false);
    }

    /** 신고자 행을 잠근 뒤: 그 사이 들어온 같은 요청을 먼저 돌려주고, 아니면 하루 한도를 본다. */
    private Filed guarded(UUID reporter, UUID requestId, String fingerprint, NewReport report, Instant now) {
        Filed prior = prior(reporter, requestId, fingerprint, report);
        if (prior != null) return prior;
        Instant midnight = now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toInstant();
        long today = ((Number) em.createNativeQuery("SELECT count(*) FROM entry_reports WHERE reporter_id=:reporter AND created_at>=:since")
                .setParameter("reporter", reporter).setParameter("since", midnight.atOffset(ZoneOffset.UTC)).getSingleResult()).longValue();
        if (today >= ChallengeRules.DAILY_REPORTS) throw new ApiException(429, "daily_report_limit");
        return null;
    }

    @Override @Transactional(readOnly = true)
    public AdminReportPage list(String status, String cursor, Instant now) {
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
        var query = em.createNativeQuery(ADMIN + " WHERE r.status=:status" + (at == null ? "" : " AND (r.created_at,r.id)>(:at,:after)")
                + " ORDER BY r.created_at,r.id", Tuple.class).setParameter("status", status).setMaxResults(PAGE + 1);
        if (at != null) query.setParameter("at", at.atOffset(ZoneOffset.UTC)).setParameter("after", after);
        var rows = NativeTuples.list(query);
        boolean more = rows.size() > PAGE;
        var reports = rows.subList(0, Math.min(rows.size(), PAGE)).stream().map(PostgresEntryReportRepository::admin).toList();
        String next = more ? Base64.getUrlEncoder().withoutPadding().encodeToString((status + "|" + reports.getLast().createdAt() + "|"
                + reports.getLast().id()).getBytes(StandardCharsets.UTF_8)) : null;
        return new AdminReportPage(reports, next);
    }

    /**
     * 판정. 대상 행을 잠그고 이 신고를 처리한 뒤, restored·dismissed 는 그 대상에 처리되지 않은 신고가 남지 않았을 때만
     * 운영 숨김을 푼다. 푸는 것은 숨김뿐이라 작성자의 비공개·삭제·탈퇴와 챌린지 종료는 그대로다. kept_hidden 은 숨김
     * (챌린지는 검토)을 유지한다. 참여작·챌린지 판정 뒤에는 기다리던 종료 순위를 확정해 본다.
     */
    @Override @Transactional
    public AdminReport resolve(UUID id, String resolution, String reviewer, String note, Instant now) {
        var found = NativeTuples.list(em.createNativeQuery("SELECT target_type,target_id,status FROM entry_reports WHERE id=:id", Tuple.class)
                .setParameter("id", id));
        if (found.isEmpty()) throw new ApiException(404, "report_not_found");
        String type = found.getFirst().get("target_type", String.class);
        UUID target = found.getFirst().get("target_id", UUID.class);
        UUID challenge = switch (type) {
            case "entry" -> lockEntryTarget(target, now);
            case "comment" -> { lockRow("entry_comments", target); yield null; }
            default -> { lockRow("challenges", target); yield target; }
        };
        var report = NativeTuples.list(em.createNativeQuery("SELECT status FROM entry_reports WHERE id=:id FOR UPDATE", Tuple.class)
                .setParameter("id", id)).getFirst();
        if (!"received".equals(report.get("status", String.class))) throw new ApiException(422, "report_already_reviewed");
        em.createNativeQuery("""
                UPDATE entry_reports SET status='reviewed',resolution=:resolution,reviewed_by=:reviewer,reviewed_at=:now,
                    resolution_note=:note WHERE id=:id
                """).setParameter("resolution", resolution).setParameter("reviewer", reviewer)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("note", note).setParameter("id", id).executeUpdate();
        long open = ((Number) em.createNativeQuery(
                "SELECT count(*) FROM entry_reports WHERE target_type=:type AND target_id=:target AND status='received'")
                .setParameter("type", type).setParameter("target", target).getSingleResult()).longValue();
        // kept_hidden 은 지금 상태(참여작·댓글의 숨김, 챌린지의 검토)를 그대로 둔다. 챌린지를 아예 내릴지는 운영이
        // moderation 경로로 따로 정한다.
        if (!"kept_hidden".equals(resolution) && open == 0) {
            String release = switch (type) {
                case "entry" -> "UPDATE challenge_entries SET status='visible' WHERE id=:id AND status='hidden_by_report'";
                case "comment" -> "UPDATE entry_comments SET status='visible' WHERE id=:id AND status='hidden'";
                default -> "UPDATE challenges SET moderation='visible' WHERE id=:id AND moderation='review'";
            };
            em.createNativeQuery(release).setParameter("id", target).executeUpdate();
        }
        if (challenge != null) settlement.settle(challenge, now);
        return admin(NativeTuples.list(em.createNativeQuery(ADMIN + " WHERE r.id=:id", Tuple.class).setParameter("id", id)).getFirst());
    }

    private void insert(UUID id, UUID reporter, UUID requestId, String fingerprint, NewReport report, int version, String text,
                        Instant now) {
        em.createNativeQuery("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,note,status,target_version,target_text,
                    request_id,request_fingerprint,created_at)
                VALUES (:id,:type,:target,:reporter,:reason,:note,'received',:version,:text,:request,:fingerprint,:now)
                """).setParameter("id", id).setParameter("type", report.targetType()).setParameter("target", report.targetId())
                .setParameter("reporter", reporter).setParameter("reason", report.reason()).setParameter("note", report.note())
                .setParameter("version", version).setParameter("text", text).setParameter("request", requestId)
                .setParameter("fingerprint", fingerprint).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
    }

    /** 신고자에게 보이는 댓글(부모 참여작 노출 + 댓글 노출)을 잠근다. 본인 숨김 댓글은 이미 숨겨져 신고할 것이 없다. */
    private Tuple lockVisibleComment(UUID reporter, UUID commentId, Instant now) {
        var found = NativeTuples.list(em.createNativeQuery("SELECT entry_id,user_id FROM entry_comments WHERE id=:id", Tuple.class)
                .setParameter("id", commentId));
        if (found.isEmpty()) throw new ApiException(404, "comment_not_found");
        locks.people(reporter, found.getFirst().get("user_id", UUID.class), false);
        var rows = NativeTuples.list(em.createNativeQuery("""
                SELECT cm.user_id,cm.body FROM entry_comments cm
                WHERE cm.id=:id AND cm.status='visible' AND %s FOR UPDATE
                """.formatted(ChallengeVisibility.VISIBLE_COMMENT), Tuple.class).setParameter("id", commentId).setParameter("viewer", reporter));
        if (rows.isEmpty() || !locks.visible(reporter, found.getFirst().get("entry_id", UUID.class), false)) {
            throw new ApiException(404, "comment_not_found");
        }
        return rows.getFirst();
    }

    /** 참여작 판정은 챌린지 → 참여작 순서로 잠근다(마감 집계가 먼저다). */
    private UUID lockEntryTarget(UUID entryId, Instant now) {
        var parent = NativeTuples.list(em.createNativeQuery("SELECT challenge_id FROM challenge_entries WHERE id=:id", Tuple.class)
                .setParameter("id", entryId));
        if (parent.isEmpty()) return null;
        UUID challenge = parent.getFirst().get("challenge_id", UUID.class);
        settlement.settle(challenge, now);
        lockRow("challenge_entries", entryId);
        return challenge;
    }

    private void lockRow(String table, UUID id) {
        NativeTuples.list(em.createNativeQuery("SELECT id FROM " + table + " WHERE id=:id FOR UPDATE", Tuple.class).setParameter("id", id));
    }

    private static Receipt receipt(Tuple row) { return new Receipt(row.get("id", UUID.class), row.get("status", String.class)); }

    private static final String ADMIN = """
            SELECT r.*,
                   CASE r.target_type WHEN 'entry' THEN te.content_version WHEN 'comment' THEN CASE WHEN tc.id IS NULL THEN NULL ELSE 1 END
                        ELSE CASE WHEN tch.id IS NULL THEN NULL ELSE 1 END END AS current_version,
                   CASE r.target_type WHEN 'entry' THEN te.caption WHEN 'comment' THEN tc.body ELSE tch.line END AS current_text,
                   CASE r.target_type
                        WHEN 'entry' THEN CASE WHEN te.status='visible' THEN te.visibility ELSE te.status END
                        WHEN 'comment' THEN CASE WHEN tc.deleted_at IS NOT NULL THEN 'deleted' ELSE tc.status END
                        ELSE CASE WHEN tch.deleted_at IS NOT NULL THEN 'deleted' ELSE tch.moderation END END AS target_state,
                   (SELECT count(*) FROM entry_reports o WHERE o.target_type=r.target_type AND o.target_id=r.target_id
                      AND o.status='received') AS open_reports
            FROM entry_reports r
            LEFT JOIN challenge_entries te ON r.target_type='entry' AND te.id=r.target_id
            LEFT JOIN entry_comments tc ON r.target_type='comment' AND tc.id=r.target_id
            LEFT JOIN challenges tch ON r.target_type='challenge' AND tch.id=r.target_id
            """;

    private static AdminReport admin(Tuple row) {
        Instant created = row.get("created_at", Instant.class);
        return new AdminReport(row.get("id", UUID.class), row.get("target_type", String.class), row.get("target_id", UUID.class),
                row.get("reason", String.class), row.get("note", String.class), row.get("status", String.class),
                row.get("resolution", String.class), row.get("reviewed_by", String.class), row.get("reviewed_at", Instant.class),
                row.get("resolution_note", String.class), ((Number) row.get("target_version")).intValue(),
                row.get("current_version") == null ? null : ((Number) row.get("current_version")).intValue(),
                row.get("target_text", String.class), row.get("current_text", String.class),
                row.get("target_state") == null ? "deleted" : row.get("target_state", String.class),
                ((Number) row.get("open_reports")).longValue(), created, created.plus(Duration.ofHours(24)), created.plus(Duration.ofHours(72)));
    }
}
