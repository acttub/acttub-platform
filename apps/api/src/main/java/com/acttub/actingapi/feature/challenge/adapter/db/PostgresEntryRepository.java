package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 참여작 (challenge.entry, challenge.browse). 공개 집계·순위는 공개 조건, 목록·피드·조회수는 개인 노출 조건
 * ({@link ChallengeVisibility})이다. 본인 기록(P03)은 예외 조회다. 수는 저장하지 않고 다시 센다.
 */
@Repository
class PostgresEntryRepository implements EntryRepository {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    /** 카드 한 장에 필요한 것. 영상·챌린지가 사라진 행(삭제된 참여작)도 본인 조회를 위해 LEFT JOIN 한다. */
    private final EntityManager em;
    private final ChallengeSettlement settlement;
    private final EntryCards cards;
    private final TransactionTemplate transaction;
    private final FailureReporter failures;
    /** 묶음 푸시 선점은 그 10분 구간(밤이면 다음 09시)이 지나면 쓸모가 없다 — 이틀이면 넉넉하다. */
    private static final java.time.Duration NOTIFICATION_PUSH_CLAIM_RETENTION = java.time.Duration.ofDays(2);

    PostgresEntryRepository(EntityManager em, ChallengeSettlement settlement, EntryCards cards,
                            PlatformTransactionManager transactions, FailureReporter failures) {
        this.em = em; this.settlement = settlement; this.cards = cards; this.failures = failures;
        this.transaction = new TransactionTemplate(transactions);
    }

    @Override @Transactional(readOnly = true)
    public OwnVideo video(UUID owner, UUID videoId) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT id,object_key,duration_ms,purged_at FROM videos WHERE id=:id AND user_id=:owner", Tuple.class)
                .setParameter("id", videoId).setParameter("owner", owner));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        return new OwnVideo(videoId, row.get("object_key", String.class), row.get("duration_ms", Integer.class),
                row.get("purged_at", Instant.class) != null);
    }

    @Override @Transactional(readOnly = true)
    public boolean pendingUpload(UUID owner, UUID id) {
        return !NativeTuples.list(em.createNativeQuery(
                "SELECT 1 AS pending FROM upload_intents WHERE id=:id AND user_id=:owner AND video_id IS NULL", Tuple.class)
                .setParameter("id", id).setParameter("owner", owner)).isEmpty();
    }

    @Override @Transactional(readOnly = true)
    public Replay replay(UUID owner, UUID requestId) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT id,request_fingerprint FROM challenge_entries WHERE user_id=:owner AND request_id=:request", Tuple.class)
                .setParameter("owner", owner).setParameter("request", requestId));
        if (rows.isEmpty()) return null;
        return new Replay(rows.getFirst().get("request_fingerprint", String.class).strip(),
                cards.mine(owner, rows.getFirst().get("id", UUID.class)));
    }

    @Override @Transactional
    public Creation create(UUID owner, UUID challengeId, UUID requestId, String fingerprint, NewEntry entry, Instant now) {
        lockActive(owner);
        // 같은 요청의 재전송 확인이 한도 검사보다 먼저다 — 응답을 잃은 재전송이 두 번째 행이나 429가 되지 않는다.
        Replay replayed = replay(owner, requestId);
        if (replayed != null) {
            if (!fingerprint.equals(replayed.fingerprint())) throw new ApiException(422, "request_fingerprint_mismatch");
            return new Creation(replayed.entry(), false);
        }
        Tuple challenge = lockChallenge(challengeId);
        if (challenge == null || challenge.get("deleted_at") != null
                || !"visible".equals(challenge.get("moderation", String.class))
                || challenge.get("starts_at", Instant.class).isAfter(now)) throw new ApiException(404, "challenge_not_found");
        if (!now.isBefore(challenge.get("ends_at", Instant.class))) throw new ApiException(422, "challenge_closed");
        // 영상 행을 잡는다 — 파기·보관함 삭제와 여기서 줄을 선다.
        var video = NativeTuples.list(em.createNativeQuery(
                "SELECT purged_at FROM videos WHERE id=:id AND user_id=:owner FOR UPDATE", Tuple.class)
                .setParameter("id", entry.videoId()).setParameter("owner", owner));
        if (video.isEmpty()) throw new ApiException(404, "video_not_found");
        if (video.getFirst().get("purged_at", Instant.class) != null) throw new ApiException(422, "video_not_ready");
        long duplicates = ((Number) em.createNativeQuery("""
                SELECT count(*) FROM challenge_entries WHERE challenge_id=:challenge AND video_id=:video AND status<>'deleted'
                """).setParameter("challenge", challengeId).setParameter("video", entry.videoId()).getSingleResult()).longValue();
        if (duplicates > 0) throw new ApiException(422, "duplicate_entry");
        Instant midnight = now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toInstant();
        long today = ((Number) em.createNativeQuery(
                "SELECT count(*) FROM challenge_entries WHERE user_id=:owner AND created_at>=:since")
                .setParameter("owner", owner).setParameter("since", midnight.atOffset(ZoneOffset.UTC)).getSingleResult()).longValue();
        if (today >= ChallengeRules.DAILY_ENTRIES) throw new ApiException(429, "daily_entry_limit");
        UUID id = UUID.randomUUID();
        boolean open = "public".equals(entry.visibility());
        em.createNativeQuery("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,caption,visibility,published_at,status,
                    request_id,request_fingerprint,created_at,updated_at)
                VALUES (:id,:challenge,:owner,:video,:caption,:visibility,CASE WHEN :open THEN CAST(:now AS timestamptz) END,'visible',:request,:fingerprint,:now,:now)
                """).setParameter("id", id).setParameter("challenge", challengeId).setParameter("owner", owner)
                .setParameter("video", entry.videoId()).setParameter("caption", entry.caption())
                .setParameter("visibility", entry.visibility())
                .setParameter("open", open)
                .setParameter("request", requestId).setParameter("fingerprint", fingerprint)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        return new Creation(cards.mine(owner, id), true);
    }

    @Override @Transactional
    public MyEntry update(UUID owner, UUID entryId, String caption, String visibility, Instant now) {
        lockActive(owner);
        Tuple entry = lockOwnEntry(owner, entryId, now);
        if (caption != null) {
            String next = caption.isEmpty() ? null : caption;
            if (!java.util.Objects.equals(next, entry.get("caption", String.class))) {
                em.createNativeQuery("""
                        UPDATE challenge_entries SET caption=:caption,content_version=content_version+1,updated_at=:now WHERE id=:id
                        """).setParameter("caption", next).setParameter("now", now.atOffset(ZoneOffset.UTC))
                        .setParameter("id", entryId).executeUpdate();
            }
        }
        if ("public".equals(visibility) && !"public".equals(entry.get("visibility", String.class))) {
            Tuple challenge = challengeRow(entry.get("challenge_id", UUID.class));
            if (challenge.get("deleted_at") != null || !"visible".equals(challenge.get("moderation", String.class))
                    || !now.isBefore(challenge.get("ends_at", Instant.class))) throw new ApiException(422, "challenge_closed");
            if ("hidden_by_report".equals(entry.get("status", String.class))) throw new ApiException(422, "entry_hidden");
            var video = NativeTuples.list(em.createNativeQuery(
                    "SELECT purged_at FROM videos WHERE id=:id FOR UPDATE", Tuple.class)
                    .setParameter("id", entry.get("video_id", UUID.class)));
            if (video.isEmpty() || video.getFirst().get("purged_at", Instant.class) != null) {
                throw new ApiException(422, "video_not_ready");
            }
            em.createNativeQuery("""
                    UPDATE challenge_entries SET visibility='public',published_at=coalesce(published_at,:now),updated_at=:now
                    WHERE id=:id
                    """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        } else if ("private".equals(visibility)) {
            em.createNativeQuery("UPDATE challenge_entries SET visibility='private',updated_at=:now WHERE id=:id")
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        }
        return cards.mine(owner, entryId);
    }

    @Override @Transactional
    public void delete(UUID owner, UUID entryId, Instant now) {
        lockActive(owner);
        var found = NativeTuples.list(em.createNativeQuery(
                "SELECT challenge_id,status FROM challenge_entries WHERE id=:id AND user_id=:owner", Tuple.class)
                .setParameter("id", entryId).setParameter("owner", owner));
        if (found.isEmpty()) throw new ApiException(404, "entry_not_found");
        if ("deleted".equals(found.getFirst().get("status", String.class))) return;
        lockOwnEntry(owner, entryId, now);
        // 반응은 그 참여작의 것만 지운다. 댓글은 본문을 파기하고 표시만 남기며 신고 행은 남기되 사본 본문을 비운다.
        // AI 리포트는 본문·비교 자료를 파기하고 진행 중인 생성을 취소한다. 그 참여작에 관한 알림은 지운다.
        em.createNativeQuery("DELETE FROM notifications WHERE entry_id=:id").setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("UPDATE entry_ai_reports SET result=NULL,purged_at=:now WHERE entry_id=:id")
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("""
                UPDATE ai_jobs SET status='failed',failure_reason='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=:now
                WHERE kind='challenge_report' AND target_id=:id AND status IN ('pending','running')
                """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("DELETE FROM entry_likes WHERE entry_id=:id").setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("DELETE FROM entry_saves WHERE entry_id=:id").setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("""
                UPDATE entry_reports SET target_text=NULL
                WHERE (target_type='entry' AND target_id=:id)
                   OR (target_type='comment' AND target_id IN (SELECT id FROM entry_comments WHERE entry_id=:id))
                """).setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("UPDATE entry_comments SET body=NULL,deleted_at=coalesce(deleted_at,:now) WHERE entry_id=:id")
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
        em.createNativeQuery("""
                UPDATE challenge_entries SET status='deleted',caption=NULL,video_id=NULL,deleted_at=:now,updated_at=:now
                WHERE id=:id
                """).setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", entryId).executeUpdate();
    }

    @Override @Transactional
    public boolean view(UUID viewer, UUID entryId, UUID eventId, Instant now) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT e.user_id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND ("
                        + "e.user_id=:viewer OR (" + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED + "))",
                Tuple.class).setParameter("id", entryId).setParameter("viewer", viewer));
        if (rows.isEmpty()) throw new ApiException(404, "entry_not_found");
        if (viewer.equals(rows.getFirst().get("user_id", UUID.class))) return false;
        int inserted = em.createNativeQuery("""
                INSERT INTO entry_view_events(event_id,entry_id,user_id,created_at) VALUES (:event,:entry,:viewer,:now)
                ON CONFLICT (event_id) DO NOTHING
                """).setParameter("event", eventId).setParameter("entry", entryId).setParameter("viewer", viewer)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        if (inserted == 0) return false;
        em.createNativeQuery("UPDATE challenge_entries SET view_count=view_count+1 WHERE id=:id")
                .setParameter("id", entryId).executeUpdate();
        return true;
    }

    @Override
    public EntryPage list(UUID viewer, UUID challengeId, String sort, String cursor, UUID fromEntry, Instant now) {
        // 마감이 지났는데 아직 집계 전이면 읽기 전에 집계한다 — 그 사이 변경이 없었으므로 값은 마감 시점 그대로다.
        transaction.executeWithoutResult(tx -> settlement.aggregateIfDue(challengeId, now));
        return transaction.execute(tx -> {
            var challenge = NativeTuples.list(em.createNativeQuery("""
                    SELECT ranking_state,ends_at FROM challenges
                    WHERE id=:id AND deleted_at IS NULL AND moderation='visible' AND starts_at<=:now
                    """, Tuple.class).setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)));
            if (challenge.isEmpty()) throw new ApiException(404, "challenge_not_found");
            String state = challenge.getFirst().get("ranking_state", String.class);
            return "latest".equals(sort) ? latest(viewer, challengeId, cursor, fromEntry, state)
                    : byLikes(viewer, challengeId, cursor, fromEntry, state == null ? "live" : state, state, now);
        });
    }

    @Override @Transactional(readOnly = true)
    public EntryCard find(UUID viewer, UUID entryId, Instant now) {
        var visible = NativeTuples.list(em.createNativeQuery(
                "SELECT e.id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND " + ChallengeVisibility.PUBLIC_ENTRY
                        + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("id", entryId).setParameter("viewer", viewer));
        var own = NativeTuples.list(em.createNativeQuery(
                "SELECT id FROM challenge_entries WHERE id=:id AND user_id=:viewer AND status<>'deleted'", Tuple.class)
                .setParameter("id", entryId).setParameter("viewer", viewer));
        if (visible.isEmpty() && own.isEmpty()) throw new ApiException(404, "entry_not_found");
        return cards.cards(viewer, List.of(entryId), Map.of(), null, true).getFirst();
    }

    @Override @Transactional(readOnly = true)
    public MyEntries mine(UUID owner, String category, String cursor, Instant now) {
        Tuple counts = NativeTuples.list(em.createNativeQuery("""
                SELECT count(*) AS all_count,
                       count(*) FILTER (WHERE category='public') AS public_count,
                       count(*) FILTER (WHERE category='private') AS private_count,
                       count(*) FILTER (WHERE category='under_review') AS review_count
                FROM (SELECT %s AS category FROM challenge_entries e JOIN challenges c ON c.id=e.challenge_id
                      WHERE e.user_id=:owner AND e.status<>'deleted') mine
                """.formatted(EntryCards.CATEGORY), Tuple.class).setParameter("owner", owner)).getFirst();
        String[] after = cursor == null || cursor.isBlank() ? null : decode(cursor, "M", 3, "cursor");
        if (after != null && !after[1].equals(owner.toString())) throw invalidCursor(cursor);
        var query = em.createNativeQuery("""
                SELECT e.id FROM challenge_entries e JOIN challenges c ON c.id=e.challenge_id
                WHERE e.user_id=:owner AND e.status<>'deleted' AND (:category='' OR %s=:category)
                """.formatted(EntryCards.CATEGORY) + (after == null ? "" : " AND (e.created_at,e.id)<(:at,:after) ")
                + " ORDER BY e.created_at DESC,e.id DESC", Tuple.class)
                .setParameter("owner", owner).setParameter("category", category == null ? "" : category)
                .setMaxResults(ChallengeRules.ENTRY_PAGE + 1);
        if (after != null) {
            try {
                query.setParameter("at", Instant.parse(after[2]).atOffset(ZoneOffset.UTC)).setParameter("after", UUID.fromString(after[3]));
            } catch (RuntimeException invalid) { throw invalidCursor(cursor); }
        }
        List<UUID> ids = NativeTuples.list(query).stream().map(row -> row.get("id", UUID.class)).toList();
        boolean more = ids.size() > ChallengeRules.ENTRY_PAGE;
        List<MyEntry> entries = ids.subList(0, Math.min(ids.size(), ChallengeRules.ENTRY_PAGE)).stream()
                .map(id -> cards.mine(owner, id)).toList();
        String next = more ? encode("M", owner.toString(), entries.getLast().createdAt().toString(),
                entries.getLast().id().toString()) : null;
        return new MyEntries(new Counts(number(counts, "all_count"), number(counts, "public_count"),
                number(counts, "private_count"), number(counts, "review_count")), entries, next);
    }

    @Override
    public int settle(Instant now) {
        List<UUID> waiting = transaction.execute(tx -> settlement.waiting(now));
        int settled = 0;
        // 챌린지마다 따로 커밋하고, 하나가 실패해도 나머지와 보관 기간 정리는 돈다.
        for (UUID id : waiting) {
            try {
                transaction.executeWithoutResult(tx -> settlement.settle(id, now));
                settled++;
            } catch (RuntimeException failure) {
                failures.report(failure, new FailureContext("PostgresEntryRepository.settle", id));
            }
        }
        transaction.executeWithoutResult(tx -> {
            em.createNativeQuery("DELETE FROM entry_view_events WHERE created_at<:before")
                    .setParameter("before", now.minus(ChallengeRules.VIEW_EVENT_RETENTION).atOffset(ZoneOffset.UTC)).executeUpdate();
            em.createNativeQuery("DELETE FROM entry_ranking_snapshots WHERE created_at<:before")
                    .setParameter("before", now.minus(ChallengeRules.RANKING_HOLD).atOffset(ZoneOffset.UTC)).executeUpdate();
            // 알림은 90일, 묶음 선점은 구간이 지나면 쓸모가 없다. 파기된 AI 리포트의 이력도 90일이다.
            em.createNativeQuery("DELETE FROM notifications WHERE expires_at<=:now")
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
            em.createNativeQuery("DELETE FROM notification_pushes WHERE created_at<:before")
                    .setParameter("before", now.minus(NOTIFICATION_PUSH_CLAIM_RETENTION).atOffset(ZoneOffset.UTC)).executeUpdate();
            em.createNativeQuery("DELETE FROM entry_ai_reports WHERE purged_at<:before")
                    .setParameter("before", now.minus(ChallengeRules.REPORT_RETENTION).atOffset(ZoneOffset.UTC)).executeUpdate();
            // 처리 완료된 신고는 90일 보관한다(challenge.report).
            em.createNativeQuery("DELETE FROM entry_reports WHERE status='reviewed' AND reviewed_at<:before")
                    .setParameter("before", now.minus(ChallengeRules.REPORT_RETENTION).atOffset(ZoneOffset.UTC)).executeUpdate();
        });
        return settled;
    }

    // ── 목록 ─────────────────────────────────────────────────────────────────

    /** 최신순: 공개 시각 역순, 순위 숫자 없음, 가장 최근 하나에 NEW. */
    private EntryPage latest(UUID viewer, UUID challengeId, String cursor, UUID fromEntry, String state) {
        String visible = ChallengeVisibility.ENTRY_FROM + " WHERE e.challenge_id=:challenge AND "
                + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED;
        Instant at = null;
        UUID after = null;
        boolean inclusive = false;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor, "L", 4, "cursor");
            if (!parts[1].equals(challengeId.toString()) || !parts[2].equals(viewer.toString())) throw invalidCursor(cursor);
            try { at = Instant.parse(parts[3]); after = UUID.fromString(parts[4]); }
            catch (RuntimeException invalid) { throw invalidCursor(cursor); }
        } else if (fromEntry != null) {
            var start = NativeTuples.list(em.createNativeQuery("SELECT e.published_at " + visible + " AND e.id=:from", Tuple.class)
                    .setParameter("challenge", challengeId).setParameter("viewer", viewer).setParameter("from", fromEntry));
            if (start.isEmpty()) throw new ApiException(404, "entry_not_found");
            at = start.getFirst().get("published_at", Instant.class);
            after = fromEntry;
            inclusive = true;
        }
        var query = em.createNativeQuery("SELECT e.id " + visible
                + (at == null ? "" : inclusive ? " AND (e.published_at,e.id)<=(:at,:after)" : " AND (e.published_at,e.id)<(:at,:after)")
                + " ORDER BY e.published_at DESC,e.id DESC", Tuple.class)
                .setParameter("challenge", challengeId).setParameter("viewer", viewer).setMaxResults(ChallengeRules.ENTRY_PAGE + 1);
        if (at != null) query.setParameter("at", at.atOffset(ZoneOffset.UTC)).setParameter("after", after);
        List<UUID> ids = NativeTuples.list(query).stream().map(row -> row.get("id", UUID.class)).toList();
        var newest = NativeTuples.list(em.createNativeQuery("SELECT e.id " + visible + " ORDER BY e.published_at DESC,e.id DESC",
                Tuple.class).setParameter("challenge", challengeId).setParameter("viewer", viewer).setMaxResults(1));
        UUID newestId = newest.isEmpty() ? null : newest.getFirst().get("id", UUID.class);
        boolean more = ids.size() > ChallengeRules.ENTRY_PAGE;
        var page = cards.cards(viewer, ids.subList(0, Math.min(ids.size(), ChallengeRules.ENTRY_PAGE)), Map.of(), newestId, false);
        String next = more ? encode("L", challengeId.toString(), viewer.toString(),
                page.getLast().publishedAt().toString(), page.getLast().id().toString()) : null;
        return new EntryPage(page, next, state);
    }

    /**
     * 좋아요순: 첫 조회가 전체 순서(공개 조건)와 공동 순위를 굳혀 두고 10분 동안 이어 준다. 매 쪽에서 개인 노출 조건을
     * 다시 본다. 기준(진행 중 → 집계 중 → 확정)이 바뀌었거나 굳힌 순서가 오래됐으면 410 cursor_expired.
     */
    private EntryPage byLikes(UUID viewer, UUID challengeId, String cursor, UUID fromEntry, String basis, String state, Instant now) {
        UUID snapshot;
        List<UUID> order;
        List<Integer> ranks;
        int offset;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor, "S", 2, "cursor");
            try { snapshot = UUID.fromString(parts[1]); offset = Integer.parseInt(parts[2]); }
            catch (RuntimeException invalid) { throw invalidCursor(cursor); }
            var held = NativeTuples.list(em.createNativeQuery("""
                    SELECT basis,created_at,array_to_string(entry_ids,',') AS entry_ids,array_to_string(ranks,',') AS ranks
                    FROM entry_ranking_snapshots
                    WHERE id=:id AND challenge_id=:challenge AND viewer_id=:viewer
                    """, Tuple.class).setParameter("id", snapshot).setParameter("challenge", challengeId).setParameter("viewer", viewer));
            if (held.isEmpty() || offset < 0) throw invalidCursor(cursor);
            Tuple row = held.getFirst();
            if (!basis.equals(row.get("basis", String.class))
                    || !now.isBefore(row.get("created_at", Instant.class).plus(ChallengeRules.RANKING_HOLD))) {
                throw new ApiException(410, "cursor_expired");
            }
            order = split(row.get("entry_ids", String.class)).stream().map(UUID::fromString).toList();
            ranks = split(row.get("ranks", String.class)).stream().map(Integer::valueOf).toList();
        } else {
            var ranked = ranked(challengeId, basis);
            order = ranked.keySet().stream().toList();
            ranks = ranked.values().stream().toList();
            snapshot = UUID.randomUUID();
            em.createNativeQuery("""
                    INSERT INTO entry_ranking_snapshots(id,challenge_id,viewer_id,basis,entry_ids,ranks,created_at)
                    VALUES (:id,:challenge,:viewer,:basis,CAST(:entries AS uuid[]),CAST(:ranks AS integer[]),:now)
                    """).setParameter("id", snapshot).setParameter("challenge", challengeId).setParameter("viewer", viewer)
                    .setParameter("basis", basis).setParameter("entries", "{" + String.join(",", order.stream().map(UUID::toString).toList()) + "}")
                    .setParameter("ranks", "{" + String.join(",", ranks.stream().map(String::valueOf).toList()) + "}").setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            offset = 0;
            if (fromEntry != null) {
                offset = order.indexOf(fromEntry);
                if (offset < 0 || visibleAmong(viewer, List.of(fromEntry)).isEmpty()) throw new ApiException(404, "entry_not_found");
            }
        }
        var picked = new ArrayList<UUID>();
        var rankOf = new HashMap<UUID, Integer>();
        int position = offset;
        Integer nextOffset = null;
        while (position < order.size() && nextOffset == null) {
            var window = order.subList(position, Math.min(order.size(), position + 100));
            var visible = visibleAmong(viewer, window);
            for (int i = 0; i < window.size(); i++) {
                UUID id = window.get(i);
                if (!visible.contains(id)) continue;
                if (picked.size() == ChallengeRules.ENTRY_PAGE) { nextOffset = position + i; break; }
                picked.add(id);
                int rank = ranks.get(position + i);
                if (rank > 0) rankOf.put(id, rank);
            }
            position += window.size();
        }
        var page = cards.cards(viewer, picked, rankOf, null, false);
        return new EntryPage(page, nextOffset == null ? null : encode("S", snapshot.toString(), Integer.toString(nextOffset)), state);
    }

    /** 전체 순서와 순위(0은 순위 없음). 진행 중은 현재 좋아요, 종료 뒤는 저장된 값이다. */
    private java.util.LinkedHashMap<UUID, Integer> ranked(UUID challengeId, String basis) {
        String sql = switch (basis) {
            case "live" -> """
                    SELECT e.id,(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS likes,NULL::integer AS final_rank
                    %s WHERE e.challenge_id=:challenge AND %s ORDER BY likes DESC,e.published_at,e.id
                    """;
            case "pending" -> """
                    SELECT e.id,coalesce(e.final_like_count,0) AS likes,NULL::integer AS final_rank
                    %s WHERE e.challenge_id=:challenge AND %s ORDER BY likes DESC,e.published_at,e.id
                    """;
            default -> """
                    SELECT e.id,coalesce(e.final_like_count,0) AS likes,e.final_rank
                    %s WHERE e.challenge_id=:challenge AND %s ORDER BY e.final_rank NULLS LAST,likes DESC,e.published_at,e.id
                    """;
        };
        var rows = NativeTuples.list(em.createNativeQuery(sql.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY),
                Tuple.class).setParameter("challenge", challengeId));
        long top = rows.stream().mapToLong(row -> ((Number) row.get("likes")).longValue()).max().orElse(0);
        var result = new java.util.LinkedHashMap<UUID, Integer>();
        long previous = -1;
        int rank = 0;
        for (int i = 0; i < rows.size(); i++) {
            Tuple row = rows.get(i);
            long likes = ((Number) row.get("likes")).longValue();
            if (likes != previous) { rank = i + 1; previous = likes; }
            int shown = switch (basis) {
                case "live" -> top == 0 ? 0 : rank;
                case "pending" -> 0;
                default -> top == 0 || row.get("final_rank") == null ? 0 : ((Number) row.get("final_rank")).intValue();
            };
            result.put(row.get("id", UUID.class), shown);
        }
        return result;
    }

    private java.util.Set<UUID> visibleAmong(UUID viewer, List<UUID> ids) {
        if (ids.isEmpty()) return java.util.Set.of();
        return new java.util.HashSet<>(NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM
                + " WHERE e.id IN (:ids) AND " + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("ids", ids).setParameter("viewer", viewer)).stream().map(row -> row.get("id", UUID.class)).toList());
    }


    // ── 잠금 ─────────────────────────────────────────────────────────────────

    private void lockActive(UUID owner) {
        var owners = NativeTuples.list(em.createNativeQuery("SELECT status FROM users WHERE id=:owner FOR UPDATE", Tuple.class)
                .setParameter("owner", owner));
        if (owners.isEmpty() || !"active".equals(owners.getFirst().get("status", String.class))) {
            throw new ApiException(403, "account_deactivated");
        }
    }

    private Tuple lockChallenge(UUID id) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT id,moderation,deleted_at,starts_at,ends_at FROM challenges WHERE id=:id FOR UPDATE", Tuple.class)
                .setParameter("id", id));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Tuple challengeRow(UUID id) {
        return NativeTuples.list(em.createNativeQuery(
                "SELECT moderation,deleted_at,ends_at FROM challenges WHERE id=:id", Tuple.class).setParameter("id", id)).getFirst();
    }

    /**
     * 본인의 삭제되지 않은 참여작을 챌린지 → 참여작 순서로 잠근다. 마감이 지난 챌린지면 쓰기 전에 마감 집계를 한다
     * (마감 뒤 첫 변경). 없거나 남의 것이면 404.
     */
    private Tuple lockOwnEntry(UUID owner, UUID entryId, Instant now) {
        var parent = NativeTuples.list(em.createNativeQuery(
                "SELECT challenge_id FROM challenge_entries WHERE id=:id AND user_id=:owner AND status<>'deleted'", Tuple.class)
                .setParameter("id", entryId).setParameter("owner", owner));
        if (parent.isEmpty()) throw new ApiException(404, "entry_not_found");
        settlement.settle(parent.getFirst().get("challenge_id", UUID.class), now);
        var rows = NativeTuples.list(em.createNativeQuery("""
                SELECT challenge_id,video_id,caption,visibility,status FROM challenge_entries
                WHERE id=:id AND user_id=:owner AND status<>'deleted' FOR UPDATE
                """, Tuple.class).setParameter("id", entryId).setParameter("owner", owner));
        if (rows.isEmpty()) throw new ApiException(404, "entry_not_found");
        return rows.getFirst();
    }

    // ── 커서 ─────────────────────────────────────────────────────────────────

    private static String encode(String kind, String... parts) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (kind + "|" + String.join("|", parts)).getBytes(StandardCharsets.UTF_8));
    }

    private static String[] decode(String raw, String kind, int size, String field) {
        try {
            if (raw.length() > 512) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != size + 1 || !parts[0].equals(kind)) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException invalid) {
            throw invalidCursor(raw);
        }
    }

    private static ApiValidationException invalidCursor(String raw) {
        return ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", raw);
    }

    private static long number(Tuple row, String column) { return ((Number) row.get(column)).longValue(); }

    private static List<String> split(String joined) {
        return joined == null || joined.isEmpty() ? List.of() : List.of(joined.split(","));
    }
}
