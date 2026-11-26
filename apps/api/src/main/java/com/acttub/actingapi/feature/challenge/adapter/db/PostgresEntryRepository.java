package com.acttub.actingapi.feature.challenge.adapter.db;

import static com.acttub.actingapi.feature.challenge.adapter.db.Cursors.decode;
import static com.acttub.actingapi.feature.challenge.adapter.db.Cursors.encode;
import static com.acttub.actingapi.feature.challenge.adapter.db.Cursors.invalidCursor;
import static com.acttub.actingapi.feature.challenge.adapter.db.EntryCards.number;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.AiJobKind;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.ChallengeEntryVisibility;
import com.acttub.actingapi.platform.schema.ChallengeModeration;
import com.acttub.actingapi.platform.web.ApiException;
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
    private final EntityManager em;
    private final ChallengeEntryJpaRepository entries;
    private final ChallengeJpaRepository challenges;
    private final NotificationJpaRepository notifications;
    private final EntryAiReportJpaRepository aiReports;
    private final EntryLikeJpaRepository likes;
    private final EntrySaveJpaRepository saves;
    private final EntryCommentJpaRepository comments;
    private final EntryReportJpaRepository reports;
    private final NotificationPushJpaRepository pushes;
    private final EntryViewEventJpaRepository viewEvents;
    private final EntryRankingSnapshotJpaRepository snapshots;
    private final ChallengeSettlement settlement;
    private final EntryCards cards;
    private final EntryLocks locks;
    private final TransactionTemplate transaction;
    private final FailureReporter failures;
    private final VideoObjectCleanup cleanup;
    private final UnseenEntryBoost unseen;
    private final AiJobLedger jobs;
    /** 묶음 푸시 선점은 그 10분 구간(밤이면 다음 09시)이 지나면 쓸모가 없다 — 이틀이면 넉넉하다. */
    private static final java.time.Duration NOTIFICATION_PUSH_CLAIM_RETENTION = java.time.Duration.ofDays(2);

    PostgresEntryRepository(EntityManager em, ChallengeEntryJpaRepository entries, ChallengeJpaRepository challenges,
                            NotificationJpaRepository notifications, EntryAiReportJpaRepository aiReports, EntryLikeJpaRepository likes,
                            EntrySaveJpaRepository saves, EntryCommentJpaRepository comments, EntryReportJpaRepository reports,
                            NotificationPushJpaRepository pushes, EntryViewEventJpaRepository viewEvents,
                            EntryRankingSnapshotJpaRepository snapshots, ChallengeSettlement settlement, EntryCards cards, EntryLocks locks,
                            PlatformTransactionManager transactions, FailureReporter failures, VideoObjectCleanup cleanup,
                            UnseenEntryBoost unseen, AiJobLedger jobs) {
        this.em = em; this.entries = entries; this.challenges = challenges; this.notifications = notifications;
        this.aiReports = aiReports; this.likes = likes; this.saves = saves; this.comments = comments; this.reports = reports;
        this.pushes = pushes; this.viewEvents = viewEvents; this.snapshots = snapshots;
        this.settlement = settlement; this.cards = cards; this.locks = locks; this.failures = failures;
        this.cleanup = cleanup; this.unseen = unseen; this.jobs = jobs;
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
        return entries.findReplay(owner, requestId)
                .map(row -> new Replay(row.requestFingerprint().strip(), cards.mine(owner, row.id()))).orElse(null);
    }

    @Override @Transactional
    public Creation create(UUID owner, UUID challengeId, UUID requestId, String fingerprint, NewEntry entry, Instant now) {
        locks.active(owner);
        // 같은 요청의 재전송 확인이 한도 검사보다 먼저다 — 응답을 잃은 재전송이 두 번째 행이나 429가 되지 않는다.
        Replay replayed = replay(owner, requestId);
        if (replayed != null) {
            if (!fingerprint.equals(replayed.fingerprint())) throw new ApiException(422, "request_fingerprint_mismatch");
            return new Creation(replayed.entry(), false);
        }
        var challenge = challenges.lockWindow(challengeId).orElse(null);
        if (challenge == null || challenge.deletedAt() != null || challenge.moderation() != ChallengeModeration.VISIBLE
                || challenge.startsAt().isAfter(now)) throw new ApiException(404, "challenge_not_found");
        if (!now.isBefore(challenge.endsAt())) throw new ApiException(422, "challenge_closed");
        // 영상 행을 잡는다 — 파기·보관함 삭제와 여기서 줄을 선다.
        var video = NativeTuples.list(em.createNativeQuery(
                "SELECT purged_at FROM videos WHERE id=:id AND user_id=:owner FOR UPDATE", Tuple.class)
                .setParameter("id", entry.videoId()).setParameter("owner", owner));
        if (video.isEmpty()) throw new ApiException(404, "video_not_found");
        if (video.getFirst().get("purged_at", Instant.class) != null) throw new ApiException(422, "video_not_ready");
        if (entries.countLiveWithVideo(challengeId, entry.videoId()) > 0) throw new ApiException(422, "duplicate_entry");
        if (entries.countCreatedSince(owner, ChallengeRules.koreanMidnight(now)) >= ChallengeRules.DAILY_ENTRIES) {
            throw new ApiException(429, "daily_entry_limit");
        }
        UUID id = UUID.randomUUID();
        boolean open = "public".equals(entry.visibility());
        // 공개면 공개 시각과 AI 검사 차례를, 모자이크를 켰으면 만드는 중을 적는다.
        entries.insert(id, challengeId, owner, entry.videoId(), entry.caption(),
                open ? ChallengeEntryVisibility.PUBLIC : ChallengeEntryVisibility.PRIVATE, open ? now : null,
                ChallengeEntryStatus.VISIBLE, requestId, fingerprint, now, entry.faceMosaic(), entry.faceMosaic() ? "pending" : null,
                open ? "pending" : null);
        return new Creation(cards.mine(owner, id), true);
    }

    @Override @Transactional
    public MyEntry update(UUID owner, UUID entryId, String caption, String visibility, Boolean faceMosaic, Instant now) {
        locks.active(owner);
        var entry = lockOwnEntry(owner, entryId, now);
        // 모자이크를 먼저 바꾼다 — 같은 요청의 공개 전환이 바뀐 모자이크 상태로 공개 조건을 탄다.
        if (faceMosaic != null) mosaic(owner, entryId, faceMosaic, now);
        boolean captionChanged = false;
        if (caption != null) {
            String next = caption.isEmpty() ? null : caption;
            if (!java.util.Objects.equals(next, entry.caption())) {
                captionChanged = true;
                entries.changeCaption(entryId, next, now);
            }
        }
        if ("public".equals(visibility) && entry.visibility() != ChallengeEntryVisibility.PUBLIC) {
            var challenge = challenges.findWindow(entry.challengeId()).orElseThrow();
            if (challenge.deletedAt() != null || challenge.moderation() != ChallengeModeration.VISIBLE
                    || !now.isBefore(challenge.endsAt())) throw new ApiException(422, "challenge_closed");
            if (entry.status() == ChallengeEntryStatus.HIDDEN_BY_REPORT) throw new ApiException(422, "entry_hidden");
            var video = NativeTuples.list(em.createNativeQuery(
                    "SELECT purged_at FROM videos WHERE id=:id FOR UPDATE", Tuple.class)
                    .setParameter("id", entry.videoId()));
            if (video.isEmpty() || video.getFirst().get("purged_at", Instant.class) != null) {
                throw new ApiException(422, "video_not_ready");
            }
            entries.publish(entryId, now);
        } else if ("private".equals(visibility)) {
            entries.unpublish(entryId, now);
        }
        // 공개 참여작 AI 검사(SOMA-907): 처음 공개되거나 공개 중 캡션이 바뀌면 다시 검사 차례로 둔다. 영상은 바뀌지 않으므로
        // 한 번 본 참여작을 비공개→공개로 다시 여는 것만으로는 검사하지 않는다.
        entries.queueModeration(entryId, captionChanged);
        return cards.mine(owner, entryId);
    }

    @Override @Transactional
    public void delete(UUID owner, UUID entryId, Instant now) {
        locks.active(owner);
        var found = entries.findOwned(entryId, owner).orElseThrow(() -> new ApiException(404, "entry_not_found"));
        if (found.status() == ChallengeEntryStatus.DELETED) return;
        lockOwnEntry(owner, entryId, now);
        // 반응은 그 참여작의 것만 지운다. 댓글은 본문을 파기하고 표시만 남기며 신고 행은 남기되 사본 본문을 비운다.
        // AI 리포트는 본문·비교 자료를 파기하고 진행 중인 생성을 취소한다. 그 참여작에 관한 알림은 지운다.
        notifications.deleteOfEntry(entryId);
        aiReports.purge(entryId, now);
        jobs.cancel(AiJobKind.CHALLENGE_REPORT.dbValue(), entryId, now);
        likes.removeAllOf(entryId);
        saves.removeAllOf(entryId);
        reports.purgeCopiesOfEntry(entryId);
        comments.purgeAllOf(entryId, now);
        dropMosaic(owner, entryId, now);
        dropShareFrames(owner, entryId, now);
        entries.markDeleted(entryId, now);
    }

    /**
     * 얼굴 모자이크를 켜고 끈다(잠근 본인 참여작). 켜면 새로 만든다 — 이미 만드는 중이거나 준비됐으면 그대로이고, 실패한
     * 것은 시도 횟수를 비워 다시 만든다. 끄면 만든 사본을 정리 장부에 올린다. 상태가 바뀌면 만들어 둔 공유 프레임도 정리한다.
     */
    private void mosaic(UUID owner, UUID entryId, boolean on, Instant now) {
        if (on) {
            if (entries.requestMosaic(entryId, now) > 0) dropShareFrames(owner, entryId, now);
            return;
        }
        dropMosaic(owner, entryId, now);
        if (entries.turnMosaicOff(entryId, now) > 0) dropShareFrames(owner, entryId, now);
    }

    /**
     * 만들어 둔 공유 프레임 영상·미리보기(SOMA-1156)를 정리 장부에 올리고 목록을 비운다. 아직 만드는 중인 것은 붙일 때 원본
     * 고르기가 바뀐 것을 보고 스스로 장부로 간다. @return 장부 id, 지울 것이 없으면 {@code null}
     */
    private UUID dropShareFrames(UUID owner, UUID entryId, Instant now) {
        List<String> keys = NativeTuples.list(em.createNativeQuery("""
                WITH old AS (
                    SELECT id,share_frame_keys AS frame_keys FROM challenge_entries WHERE id=:id AND cardinality(share_frame_keys)>0
                ), cleared AS (
                    UPDATE challenge_entries e SET share_frame_keys=CAST('{}' AS text[]) FROM old WHERE e.id=old.id
                    RETURNING old.frame_keys
                )
                SELECT unnest(frame_keys) AS object_key FROM cleared
                """, Tuple.class).setParameter("id", entryId)).stream().map(row -> row.get("object_key", String.class)).toList();
        return keys.isEmpty() ? null : cleanup.scheduleObjectDelete(owner, keys, now, now);
    }

    @Override @Transactional(readOnly = true)
    public ShareFrameSource shareFrameSource(UUID owner, UUID entryId) { return cards.shareFrameSource(owner, entryId); }

    @Override
    public List<UUID> attachShareFrame(ShareFrameSource source, String key, Instant now) {
        return transaction.execute(tx -> {
            // 모자이크본 붙이기와 같은 순서(사람 → 참여작 → 영상)로 잡는다 — 탈퇴·파기·삭제가 키를 모으기 전에 적었거나,
            // 적지 않고 장부로 보내거나 둘 중 하나다.
            var owner = NativeTuples.list(em.createNativeQuery(
                    "SELECT status FROM users WHERE id=:user FOR UPDATE", Tuple.class).setParameter("user", source.userId()));
            var entry = NativeTuples.list(em.createNativeQuery("""
                    SELECT e.status,e.face_mosaic,e.mosaic_status,e.mosaic_key,v.object_key,v.purged_at
                    FROM challenge_entries e JOIN videos v ON v.id=e.video_id
                    WHERE e.id=:id AND e.user_id=:user
                    FOR UPDATE OF e FOR SHARE OF v
                    """, Tuple.class).setParameter("id", source.entryId()).setParameter("user", source.userId()));
            boolean attachable = !owner.isEmpty() && "active".equals(owner.getFirst().get("status", String.class))
                    && !entry.isEmpty() && !"deleted".equals(entry.getFirst().get("status", String.class))
                    && source.objectKey().equals(entry.getFirst().get("object_key", String.class))
                    && entry.getFirst().get("purged_at", Instant.class) == null
                    && source.sourceKey().equals(currentShareSource(entry.getFirst()));
            if (!attachable) {
                // 지웠거나 모자이크를 바꿨거나 영상·계정이 사라졌다 — 늦게 만든 것을 남기지 않는다.
                return List.of(cleanup.scheduleObjectDelete(source.userId(), List.of(key), now, now));
            }
            entries.appendShareFrameKey(source.entryId(), key);
            return List.of();
        });
    }

    /** 지금 공유 프레임을 씌울 영상 — 본인 재생과 같다(모자이크본이 준비됐으면 그것, 아니면 원본). */
    private static String currentShareSource(Tuple row) {
        String mosaic = row.get("mosaic_key", String.class);
        boolean ready = Boolean.TRUE.equals(row.get("face_mosaic", Boolean.class))
                && "ready".equals(row.get("mosaic_status", String.class)) && mosaic != null;
        return ready ? mosaic : row.get("object_key", String.class);
    }

    /**
     * 만든 모자이크본을 정리 장부에 올리고 참조를 푼다. 켜 둔 채면 실패로 둔다(다른 사람에게 보이지 않는다). 아직 만드는
     * 중인 워커는 붙일 때 이것을 보고 자기 사본을 지운다.
     */
    private void dropMosaic(UUID owner, UUID entryId, Instant now) {
        var key = entries.findMosaicKey(entryId);
        if (key.isEmpty()) return;
        cleanup.scheduleObjectDelete(owner, List.of(key.get()), now, now);
        entries.dropMosaic(entryId, now);
    }

    @Override
    public MosaicJob claimMosaic(int maxAttempts, Instant now) {
        return transaction.execute(tx -> {
            // 상한에 닿은 채 남은 것(시도 도중 프로세스가 죽었다)은 실패로 닫는다 — 영원히 만드는 중으로 남지 않는다.
            entries.failExhaustedMosaics(maxAttempts, now);
            var rows = NativeTuples.list(em.createNativeQuery("""
                    WITH next AS (
                        SELECT e.id FROM challenge_entries e
                        JOIN users u ON u.id=e.user_id
                        JOIN videos v ON v.id=e.video_id
                        WHERE e.mosaic_status='pending' AND e.mosaic_attempts<:max AND e.status<>'deleted'
                          AND u.status='active' AND v.purged_at IS NULL
                        ORDER BY e.created_at,e.id
                        LIMIT 1
                        FOR UPDATE OF e SKIP LOCKED
                    ), claimed AS (
                        UPDATE challenge_entries SET mosaic_attempts=mosaic_attempts+1
                        FROM next WHERE challenge_entries.id=next.id
                        RETURNING challenge_entries.id,challenge_entries.user_id,challenge_entries.video_id,
                                  challenge_entries.mosaic_attempts
                    )
                    SELECT c.id,c.user_id,c.mosaic_attempts,v.object_key FROM claimed c JOIN videos v ON v.id=c.video_id
                    """, Tuple.class).setParameter("max", maxAttempts));
            if (rows.isEmpty()) return null;
            Tuple row = rows.getFirst();
            return new MosaicJob(row.get("id", UUID.class), row.get("user_id", UUID.class), row.get("object_key", String.class),
                    ((Number) row.get("mosaic_attempts")).intValue());
        });
    }

    @Override
    public List<UUID> attachMosaic(MosaicJob job, String mosaicKey, Instant now) {
        return transaction.execute(tx -> {
            // 탈퇴·파기와 같은 순서로 사람 행을 먼저 잡는다 — 탈퇴가 키를 모으기 전에 붙였거나, 붙이지 않거나 둘 중 하나다.
            var owner = NativeTuples.list(em.createNativeQuery(
                    "SELECT status FROM users WHERE id=:user FOR UPDATE", Tuple.class).setParameter("user", job.userId()));
            var entry = entries.lockMosaic(job.entryId(), job.userId());
            UUID videoId = entry.map(ChallengeEntryJpaRepository.MosaicState::videoId).orElse(null);
            // 영상 행도 잡는다 — 파일 파기가 모자이크 키를 모으는 것과 줄을 선다.
            var video = videoId == null ? List.<Tuple>of() : NativeTuples.list(em.createNativeQuery(
                    "SELECT object_key,purged_at FROM videos WHERE id=:id FOR SHARE", Tuple.class).setParameter("id", videoId));
            boolean attachable = !owner.isEmpty() && "active".equals(owner.getFirst().get("status", String.class))
                    && entry.isPresent() && "pending".equals(entry.get().mosaicStatus())
                    && entry.get().status() != ChallengeEntryStatus.DELETED
                    && !video.isEmpty() && job.objectKey().equals(video.getFirst().get("object_key", String.class))
                    && video.getFirst().get("purged_at", Instant.class) == null;
            if (!attachable) {
                // 지웠거나 껐거나 영상·계정이 사라졌다 — 늦게 만든 사본을 남기지 않는다.
                return List.of(cleanup.scheduleObjectDelete(job.userId(), List.of(mosaicKey), now, now));
            }
            entries.attachMosaic(job.entryId(), mosaicKey, now);
            // 이제 공유 프레임은 모자이크본에 씌운다 — 원본에 씌워 둔 것을 정리한다.
            UUID frames = dropShareFrames(job.userId(), job.entryId(), now);
            return frames == null ? List.of() : List.of(frames);
        });
    }

    @Override
    public void failMosaic(MosaicJob job, Instant now) {
        transaction.executeWithoutResult(tx -> entries.failMosaic(job.entryId(), job.attempts(), now));
    }

    @Override
    public void skipMosaic(MosaicJob job, Instant now) {
        transaction.executeWithoutResult(tx -> entries.skipMosaic(job.entryId(), job.attempts(), now));
    }

    @Override @Transactional
    public boolean view(UUID viewer, UUID entryId, UUID eventId, Instant now) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT e.user_id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND ("
                        + "e.user_id=:viewer OR (" + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED + "))",
                Tuple.class).setParameter("id", entryId).setParameter("viewer", viewer));
        if (rows.isEmpty()) throw new ApiException(404, "entry_not_found");
        if (viewer.equals(rows.getFirst().get("user_id", UUID.class))) return false;
        if (viewEvents.insertUnlessSeen(eventId, entryId, viewer, now) == 0) return false;
        entries.countView(entryId);
        return true;
    }

    @Override
    public EntryPage list(UUID viewer, UUID challengeId, String sort, String cursor, UUID fromEntry, Instant now) {
        // 마감이 지났는데 아직 집계 전이면 읽기 전에 집계한다 — 그 사이 변경이 없었으므로 값은 마감 시점 그대로다.
        transaction.executeWithoutResult(tx -> settlement.aggregateIfDue(challengeId, now));
        return transaction.execute(tx -> {
            var challenge = challenges.findListed(challengeId, now).orElseThrow(() -> new ApiException(404, "challenge_not_found"));
            String state = challenge.rankingState() == null ? null : challenge.rankingState().dbValue();
            return "latest".equals(sort) ? latest(viewer, challengeId, cursor, fromEntry, state)
                    : byLikes(viewer, challengeId, cursor, fromEntry, state == null ? "live" : state, state, now);
        });
    }

    @Override @Transactional(readOnly = true)
    public EntryCard find(UUID viewer, UUID entryId) {
        var visible = NativeTuples.list(em.createNativeQuery(
                "SELECT e.id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND " + ChallengeVisibility.PUBLIC_ENTRY
                        + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("id", entryId).setParameter("viewer", viewer));
        boolean own = entries.findLiveOwnedBy(entryId, viewer).isPresent();
        if (visible.isEmpty() && !own) throw new ApiException(404, "entry_not_found");
        return cards.cards(viewer, List.of(entryId), Map.of(), null, true).getFirst();
    }

    @Override @Transactional(readOnly = true)
    public PublicEntry publicEntry(UUID entryId) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT ec.work,ec.line,ec.character " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND "
                        + ChallengeVisibility.PUBLIC_ENTRY, Tuple.class)
                .setParameter("id", entryId));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        return new PublicEntry(row.get("work", String.class), row.get("line", String.class),
                row.get("character", String.class));
    }

    @Override @Transactional(readOnly = true)
    public MyEntries mine(UUID owner, String category, String cursor) {
        Tuple counts = NativeTuples.list(em.createNativeQuery("""
                SELECT count(*) AS all_count,
                       count(*) FILTER (WHERE category='public') AS public_count,
                       count(*) FILTER (WHERE category='private') AS private_count,
                       count(*) FILTER (WHERE category='under_review') AS review_count
                FROM (SELECT %s AS category FROM challenge_entries e JOIN challenges c ON c.id=e.challenge_id
                      WHERE e.user_id=:owner AND e.status<>'deleted') mine
                """.formatted(EntryCards.CATEGORY), Tuple.class).setParameter("owner", owner)).getFirst();
        String[] after = cursor == null || cursor.isBlank() ? null : decode(cursor, "M", 3);
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
            viewEvents.deleteOlderThan(now.minus(ChallengeRules.VIEW_EVENT_RETENTION));
            snapshots.deleteOlderThan(now.minus(ChallengeRules.RANKING_HOLD));
            // 알림은 90일, 묶음 선점은 구간이 지나면 쓸모가 없다. 파기된 AI 리포트의 이력도 90일이다.
            notifications.deleteExpired(now);
            pushes.deleteOlderThan(now.minus(NOTIFICATION_PUSH_CLAIM_RETENTION));
            aiReports.deletePurgedBefore(now.minus(ChallengeRules.REPORT_RETENTION));
            // 처리 완료된 신고는 90일 보관한다(challenge.report).
            reports.deleteReviewedBefore(now.minus(ChallengeRules.REPORT_RETENTION));
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
            String[] parts = decode(cursor, "L", 4);
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
     * 좋아요순: 첫 조회가 전체 순서(공개 조건)와 공동 순위를 굳혀 두고 10분 동안 이어 준다. 진행 중이면 덜 본 새 참여작을
     * 앞쪽 칸에 끼운다({@link UnseenEntryBoost}). 매 쪽에서 개인 노출 조건을
     * 다시 본다. 기준(진행 중 → 집계 중 → 확정)이 바뀌었거나 굳힌 순서가 오래됐으면 410 cursor_expired.
     */
    private EntryPage byLikes(UUID viewer, UUID challengeId, String cursor, UUID fromEntry, String basis, String state, Instant now) {
        UUID snapshot;
        List<UUID> order;
        List<Integer> ranks;
        int offset;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor, "S", 2);
            try { snapshot = UUID.fromString(parts[1]); offset = Integer.parseInt(parts[2]); }
            catch (RuntimeException invalid) { throw invalidCursor(cursor); }
            var held = snapshots.findByIdAndChallengeIdAndViewerId(snapshot, challengeId, viewer);
            if (held.isEmpty() || offset < 0) throw invalidCursor(cursor);
            if (!basis.equals(held.get().getBasis())
                    || !now.isBefore(held.get().getCreatedAt().plus(ChallengeRules.RANKING_HOLD))) {
                throw new ApiException(410, "cursor_expired");
            }
            order = List.of(held.get().getEntryIds());
            ranks = List.of(held.get().getRanks());
        } else {
            var ranked = ranked(challengeId, basis);
            order = ranked.order();
            ranks = ranked.ranks();
            // 진행 중일 때만 아직 덜 본 새 참여작을 앞쪽 칸에 끼운다(맨 앞 얼굴 묶음 뒤부터 센다). 굳힌 순서에 그대로 담기므로
            // 다음 쪽·피드도 같은 순서다.
            if ("live".equals(basis)) {
                var boosted = unseen.apply(viewer, order, ranks, ranked.faces());
                order = boosted.order();
                ranks = boosted.ranks();
            }
            snapshot = UUID.randomUUID();
            snapshots.insert(snapshot, challengeId, viewer, basis, order.toArray(UUID[]::new), ranks.toArray(Integer[]::new), now);
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

    /**
     * 전체 순서와 순위.
     *
     * @param ranks 순서와 같은 길이. 0은 순위 없음
     * @param faces 맨 앞 얼굴 묶음의 길이(진행 중만, 그 밖은 0)
     */
    private record Ranked(List<UUID> order, List<Integer> ranks, int faces) { }

    /**
     * 전체 순서와 순위(0은 순위 없음). 진행 중은 현재 좋아요, 종료 뒤는 저장된 값이다. 진행 중은 얼굴이 보이는 참여작을
     * 먼저 놓되(SOMA-1066) 순위 숫자는 좋아요 기준 전체 순위 그대로다 — 순서만 바뀐다.
     */
    private Ranked ranked(UUID challengeId, String basis) {
        String sql = switch (basis) {
            case "live" -> """
                    SELECT e.id,(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS likes,NULL::integer AS final_rank,
                           e.face_visible IS TRUE AS face
                    %s WHERE e.challenge_id=:challenge AND %s ORDER BY face DESC,likes DESC,e.published_at,e.id
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
        long[] sorted = rows.stream().mapToLong(row -> ((Number) row.get("likes")).longValue()).sorted().toArray();
        long top = sorted.length == 0 ? 0 : sorted[sorted.length - 1];
        var order = new ArrayList<UUID>(rows.size());
        var ranks = new ArrayList<Integer>(rows.size());
        int faces = 0;
        for (Tuple row : rows) {
            long likes = ((Number) row.get("likes")).longValue();
            // 좋아요 기준 공동 순위: 나보다 좋아요가 많은 참여작 수 + 1. 정렬 순서와 무관하다.
            int rank = sorted.length - upperBound(sorted, likes) + 1;
            int shown = switch (basis) {
                case "live" -> top == 0 ? 0 : rank;
                case "pending" -> 0;
                default -> top == 0 || row.get("final_rank") == null ? 0 : ((Number) row.get("final_rank")).intValue();
            };
            if ("live".equals(basis) && faces == order.size() && Boolean.TRUE.equals(row.get("face", Boolean.class))) faces++;
            order.add(row.get("id", UUID.class));
            ranks.add(shown);
        }
        return new Ranked(List.copyOf(order), List.copyOf(ranks), faces);
    }

    /** 오름차순 배열에서 {@code value} 보다 큰 첫 자리. */
    private static int upperBound(long[] sorted, long value) {
        int low = 0, high = sorted.length;
        while (low < high) {
            int mid = (low + high) >>> 1;
            if (sorted[mid] <= value) low = mid + 1; else high = mid;
        }
        return low;
    }

    private java.util.Set<UUID> visibleAmong(UUID viewer, List<UUID> ids) {
        if (ids.isEmpty()) return java.util.Set.of();
        return new java.util.HashSet<>(NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM
                + " WHERE e.id IN (:ids) AND " + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("ids", ids).setParameter("viewer", viewer)).stream().map(row -> row.get("id", UUID.class)).toList());
    }


    // ── 잠금 ─────────────────────────────────────────────────────────────────

    /**
     * 본인의 삭제되지 않은 참여작을 챌린지 → 참여작 순서로 잠근다. 마감이 지난 챌린지면 쓰기 전에 마감 집계를 한다
     * (마감 뒤 첫 변경). 없거나 남의 것이면 404.
     */
    private ChallengeEntryJpaRepository.Own lockOwnEntry(UUID owner, UUID entryId, Instant now) {
        UUID parent = entries.findLiveChallengeOf(entryId, owner).orElseThrow(() -> new ApiException(404, "entry_not_found"));
        settlement.settle(parent, now);
        return entries.lockOwned(entryId, owner).orElseThrow(() -> new ApiException(404, "entry_not_found"));
    }
}
