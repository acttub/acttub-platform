package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Card;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Listing;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.acttub.actingapi.feature.challenge.app.ChallengeCursor;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/** 현재 공개 집계와 보는 사람에게 보이는 참여자 이름을 함께 조립한다. 수를 저장해 두지 않는다. */
@Repository
class PostgresChallengeBrowse {
    private static final int PAGE_SIZE = 20;
    private static final String SELECT = """
            SELECT c.*,hp.name AS host_name,stats.entry_count,stats.like_sum
            FROM challenges c
            LEFT JOIN users hu ON hu.id=c.host_user_id
            LEFT JOIN user_profiles hp ON hp.user_id=hu.id AND hu.status='active'
            LEFT JOIN LATERAL (
              SELECT count(*) AS entry_count,
                     coalesce(sum((SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id)),0) AS like_sum
              %s WHERE e.challenge_id=c.id AND %s
            ) stats ON true
            """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY);
    private static final String VISIBLE = "c.deleted_at IS NULL AND c.moderation='visible' AND c.starts_at<=:now ";
    private final EntityManager em;
    PostgresChallengeBrowse(EntityManager em) { this.em = em; }

    Card card(UUID id, UUID viewer) {
        var rows = NativeTuples.list(em.createNativeQuery(SELECT + " WHERE c.id=:id", Tuple.class).setParameter("id", id));
        return rows.isEmpty() ? null : cards(rows, viewer).getFirst();
    }

    Card visibleCard(UUID id, UUID viewer) {
        var rows = NativeTuples.list(em.createNativeQuery(SELECT
                + " WHERE c.id=:id AND c.deleted_at IS NULL AND c.moderation='visible'", Tuple.class).setParameter("id", id));
        return rows.isEmpty() ? null : cards(rows, viewer).getFirst();
    }

    Listing list(UUID viewer, String tab, String search, Instant now, ChallengeCursor cursor) {
        List<Tuple> featured = List.of();
        if (search.isEmpty() && ("popular".equals(tab) || "latest".equals(tab))) {
            featured = NativeTuples.list(em.createNativeQuery(SELECT + " WHERE " + VISIBLE
                    + "AND c.ends_at>:now AND (c.featured_on IS NULL OR c.featured_on<=:today) "
                    + "ORDER BY c.featured_on DESC NULLS LAST,stats.entry_count DESC,c.starts_at DESC,c.id DESC", Tuple.class)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("today", now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate()).setMaxResults(1));
        }
        String period = switch (tab) {
            case "ended" -> "AND c.ends_at<=:now ";
            case "mine" -> "AND EXISTS(SELECT 1 FROM challenge_entries mine WHERE mine.challenge_id=c.id "
                    + "AND mine.user_id=:viewer AND mine.status<>'deleted') ";
            default -> "AND c.ends_at>:now ";
        };
        String order = switch (tab) {
            case "popular" -> "stats.like_sum DESC,stats.entry_count DESC,c.starts_at DESC,c.id DESC";
            case "ended" -> "c.ends_at DESC,c.id DESC";
            default -> "c.starts_at DESC,c.id DESC";
        };
        String searchWhere = """
                AND (:query='' OR strpos(lower(c.line),:query)>0 OR strpos(lower(c.work),:query)>0
                  OR EXISTS(SELECT 1 %s WHERE e.challenge_id=c.id AND %s AND %s
                            AND strpos(lower(ep.name),:query)>0))
                """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY, ChallengeVisibility.UNBLOCKED);
        String boundary = cursor == null ? "" : switch (tab) {
            case "popular" -> " AND (stats.like_sum,stats.entry_count,c.starts_at,c.id)<(:likes,:entries,:at,:id) ";
            case "ended" -> " AND (c.ends_at,c.id)<(:at,:id) ";
            default -> " AND (c.starts_at,c.id)<(:at,:id) ";
        };
        var statement = em.createNativeQuery(SELECT + " WHERE " + VISIBLE + period + searchWhere + boundary
                + (featured.isEmpty() ? "" : " AND c.id<>:featured ") + " ORDER BY " + order, Tuple.class)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("viewer", viewer)
                .setParameter("query", search.toLowerCase(Locale.ROOT)).setMaxResults(PAGE_SIZE + 1);
        if (cursor != null) {
            statement.setParameter("at", cursor.at().atOffset(ZoneOffset.UTC)).setParameter("id", cursor.id());
            if ("popular".equals(tab)) statement.setParameter("likes", cursor.likes()).setParameter("entries", cursor.entries());
        }
        if (!featured.isEmpty()) statement.setParameter("featured", featured.getFirst().get("id", UUID.class));
        List<Tuple> page = NativeTuples.list(statement);
        boolean more = page.size() > PAGE_SIZE;
        var rows = new ArrayList<>(featured);
        rows.addAll(page.subList(0, Math.min(PAGE_SIZE, page.size())));
        var result = cards(rows, viewer);
        return new Listing(featured.isEmpty() ? null : result.getFirst(),
                featured.isEmpty() ? result : result.subList(1, result.size()),
                more ? ChallengeCursor.after(tab, viewer, search, result.getLast()) : null);
    }

    private List<Card> cards(List<Tuple> rows, UUID viewer) {
        if (rows.isEmpty()) return List.of();
        var people = new HashMap<UUID, List<Participant>>();
        var counts = new HashMap<UUID, Long>();
        var ids = rows.stream().map(row -> row.get("id", UUID.class)).toList();
        String participants = """
                SELECT challenge_id,user_id,actor_name,actor_count FROM (
                  SELECT e.challenge_id,e.user_id,coalesce(ep.name,'배우') AS actor_name,
                         count(*) OVER(PARTITION BY e.challenge_id) AS actor_count,
                         row_number() OVER(PARTITION BY e.challenge_id ORDER BY max(e.published_at) DESC,e.user_id) AS position
                  %s WHERE e.challenge_id IN (:ids) AND %s AND %s
                  GROUP BY e.challenge_id,e.user_id,ep.name
                ) people WHERE position<=3 ORDER BY challenge_id,position
                """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY, ChallengeVisibility.UNBLOCKED);
        NativeTuples.list(em.createNativeQuery(participants, Tuple.class).setParameter("ids", ids).setParameter("viewer", viewer))
                .forEach(row -> {
                    UUID id = row.get("challenge_id", UUID.class);
                    people.computeIfAbsent(id, ignored -> new ArrayList<>()).add(
                            new Participant(row.get("user_id", UUID.class), row.get("actor_name", String.class)));
                    counts.put(id, ((Number) row.get("actor_count")).longValue());
                });
        return rows.stream().map(row -> {
            UUID id = row.get("id", UUID.class);
            var participantsForCard = List.copyOf(people.getOrDefault(id, List.of()));
            return new Card(id, row.get("line", String.class), row.get("work", String.class), row.get("character", String.class),
                    row.get("scene_note", String.class), row.get("origin", String.class), row.get("host_name", String.class),
                    viewer != null && viewer.equals(row.get("host_user_id", UUID.class)),
                    row.get("starts_at", Instant.class), row.get("ends_at", Instant.class),
                    row.get("featured_on") == null ? null : row.get("featured_on").toString(), row.get("moderation", String.class),
                    ((Number) row.get("entry_count")).longValue(), ((Number) row.get("like_sum")).longValue(),
                    participantsForCard, Math.max(0, counts.getOrDefault(id, 0L) - participantsForCard.size()),
                    row.get("ranking_state", String.class));
        }).toList();
    }
}
