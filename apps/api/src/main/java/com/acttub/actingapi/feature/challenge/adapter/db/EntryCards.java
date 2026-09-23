package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryCard;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntry;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.Parent;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/**
 * 참여작 카드 조립. 누가 무엇을 볼 수 있는지는 부르는 쪽이 정하고 여기서는 이미 고른 id 의 모양만 만든다. 좋아요 수는
 * 연결 행을 다시 세고(CONTRACT §7), 댓글 수는 보는 사람에게 보이는 댓글만 센다. 사진·소개는 싣지 않는다.
 */
@Component
class EntryCards {
    private static final String CARD = """
            SELECT e.id,e.challenge_id,e.user_id,coalesce(ep.name,'배우') AS author_name,e.caption,e.content_version,
                   (SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS like_count,
                   (SELECT count(*) FROM entry_comments cm WHERE cm.entry_id=e.id AND cm.status='visible'
                      AND cm.deleted_at IS NULL AND %s) AS comment_count,
                   e.view_count,e.final_like_count,e.final_rank,e.published_at,e.visibility,e.status,e.created_at,
                   v.object_key,v.purged_at,
                   EXISTS(SELECT 1 FROM entry_likes l WHERE l.entry_id=e.id AND l.user_id=:viewer) AS liked,
                   EXISTS(SELECT 1 FROM entry_saves s WHERE s.entry_id=e.id AND s.user_id=:viewer) AS saved,
                   c.line,c.work,c.character,c.ends_at,c.moderation,c.ranking_state
            FROM challenge_entries e
            JOIN challenges c ON c.id=e.challenge_id
            LEFT JOIN videos v ON v.id=e.video_id
            LEFT JOIN user_profiles ep ON ep.user_id=e.user_id
            """.formatted(ChallengeVisibility.unblocked("cm.user_id"));
    /** P03 분류 — 확인 중(신고 숨김 또는 부모 review·hidden) → 비공개 → 공개. */
    static final String CATEGORY = """
            CASE WHEN e.status='hidden_by_report' OR c.moderation<>'visible' THEN 'under_review'
                 WHEN e.visibility='private' THEN 'private' ELSE 'public' END
            """;
    private final EntityManager em;
    private final EntryMedia media;
    EntryCards(EntityManager em, EntryMedia media) { this.em = em; this.media = media; }

    /**
     * @param ranks  목록이 굳힌 순위(없으면 순위 없음)
     * @param stored 순위를 저장된 확정 값으로 채운다(단건 조회)
     */
    List<EntryCard> cards(UUID viewer, List<UUID> ids, Map<UUID, Integer> ranks, UUID newest, boolean stored) {
        if (ids.isEmpty()) return List.of();
        var rows = new HashMap<UUID, Tuple>();
        NativeTuples.list(em.createNativeQuery(CARD + " WHERE e.id IN (:ids)", Tuple.class)
                .setParameter("ids", ids).setParameter("viewer", viewer)).forEach(row -> rows.put(row.get("id", UUID.class), row));
        return ids.stream().map(rows::get).map(row -> {
            UUID id = row.get("id", UUID.class);
            Integer rank = stored ? finalRank(row) : ranks.get(id);
            return new EntryCard(id, row.get("challenge_id", UUID.class), author(row), row.get("caption", String.class),
                    number(row, "like_count"), number(row, "comment_count"), number(row, "view_count"), rank,
                    finalLikes(row), row.get("published_at", Instant.class), playback(row),
                    row.get("liked", Boolean.class), row.get("saved", Boolean.class),
                    viewer.equals(row.get("user_id", UUID.class)), id.equals(newest));
        }).toList();
    }

    /** 본인 참여작 하나(삭제된 것 포함 — 삭제된 요청의 재전송 응답). */
    MyEntry mine(UUID owner, UUID id) {
        Tuple row = NativeTuples.list(em.createNativeQuery(CARD.replace("SELECT e.id,", "SELECT " + CATEGORY + " AS category,e.id,")
                + " WHERE e.id=:id AND e.user_id=:viewer", Tuple.class).setParameter("id", id).setParameter("viewer", owner)).getFirst();
        return new MyEntry(id, row.get("challenge_id", UUID.class), author(row), row.get("caption", String.class),
                ((Number) row.get("content_version")).intValue(), number(row, "like_count"), number(row, "comment_count"),
                number(row, "view_count"), finalRank(row), finalLikes(row), row.get("published_at", Instant.class), playback(row),
                row.get("liked", Boolean.class), row.get("saved", Boolean.class), true,
                row.get("visibility", String.class), row.get("status", String.class), row.get("category", String.class),
                !"visible".equals(row.get("moderation", String.class)),
                new Parent(row.get("challenge_id", UUID.class), row.get("line", String.class), row.get("work", String.class),
                        row.get("character", String.class), row.get("ends_at", Instant.class)),
                row.get("created_at", Instant.class));
    }

    private static Participant author(Tuple row) {
        return new Participant(row.get("user_id", UUID.class), row.get("author_name", String.class));
    }

    /** 확정된 순위만. 집계 중이거나 순위 밖이면 null. */
    private static Integer finalRank(Tuple row) {
        if (!"final".equals(row.get("ranking_state", String.class)) || row.get("final_rank") == null) return null;
        return ((Number) row.get("final_rank")).intValue();
    }

    private static Long finalLikes(Tuple row) {
        return row.get("final_like_count") == null ? null : ((Number) row.get("final_like_count")).longValue();
    }

    private String playback(Tuple row) {
        String key = row.get("object_key", String.class);
        return key == null || row.get("purged_at", Instant.class) != null ? null : media.playbackUrl(key);
    }

    static long number(Tuple row, String column) { return ((Number) row.get(column)).longValue(); }
}
