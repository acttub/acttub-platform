package com.acttub.actingapi.feature.challenge.adapter.db;

import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.schema.ChallengeModeration;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository;
import com.acttub.actingapi.feature.challenge.app.ChallengeCursor;
import com.acttub.actingapi.feature.challenge.app.ChallengeService.Draft;
import com.acttub.actingapi.feature.challenge.schema.ChallengeEntity;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ChallengeOrigin;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class PostgresChallengeRepository implements ChallengeRepository {
    private final EntityManager em;
    private final PostgresChallengeBrowse browse;
    private final ChallengeSettlement settlement;
    PostgresChallengeRepository(EntityManager em, PostgresChallengeBrowse browse, ChallengeSettlement settlement) {
        this.em = em; this.browse = browse; this.settlement = settlement;
    }

    @Override @Transactional
    public Creation create(UUID owner, UUID requestId, String fingerprint, Draft draft, Instant now) {
        lockActive(owner);
        var previous = em.createQuery("SELECT c FROM ChallengeEntity c WHERE c.hostUserId=:owner AND c.requestId=:request",
                ChallengeEntity.class).setParameter("owner", owner).setParameter("request", requestId).getResultList();
        if (!previous.isEmpty()) {
            var existing = previous.getFirst();
            if (!fingerprint.equals(existing.getRequestFingerprint())) throw new ApiException(422, "request_fingerprint_mismatch");
            return new Creation(card(existing, owner), false);
        }
        long duplicates = em.createQuery("SELECT count(c) FROM ChallengeEntity c WHERE c.hostUserId=:owner "
                + "AND c.line=:line AND c.deletedAt IS NULL AND c.endsAt>:now", Long.class)
                .setParameter("owner", owner).setParameter("line", draft.line()).setParameter("now", now).getSingleResult();
        if (duplicates > 0) throw new ApiException(422, "duplicate_challenge");
        Instant midnight = now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate()
                .atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();
        long count = em.createQuery("SELECT count(c) FROM ChallengeEntity c WHERE c.hostUserId=:owner AND c.startsAt>=:since", Long.class)
                .setParameter("owner", owner).setParameter("since", midnight).getSingleResult();
        if (count >= ChallengeRules.DAILY_CREATIONS) {
            throw new ApiException(429, "daily_challenge_limit");
        }
        var challenge = new ChallengeEntity(UUID.randomUUID(), draft.line(), draft.work(), draft.character(),
                draft.sceneNote(), draft.durationDays(), ChallengeOrigin.MEMBER, owner, requestId, fingerprint,
                null, now, now.plus(draft.durationDays(), ChronoUnit.DAYS));
        em.persist(challenge);
        em.flush();
        return new Creation(card(challenge, owner), true);
    }

    @Override @Transactional(readOnly = true)
    public Card find(UUID viewer, UUID id) {
        return browse.visibleCard(id, viewer);
    }

    @Override @Transactional
    public Creation createTeam(UUID requestId, String fingerprint, Draft draft, LocalDate featuredOn, Instant now) {
        // 주최자 없는 운영 개설도 요청 ID·선정일 검사를 한 트랜잭션에서 직렬화한다.
        em.createNativeQuery("SELECT 1 FROM pg_advisory_xact_lock(hashtext('challenge_team_create'))").getSingleResult();
        var previous = em.createQuery("SELECT c FROM ChallengeEntity c WHERE c.origin=:origin AND c.requestId=:request", ChallengeEntity.class)
                .setParameter("origin", ChallengeOrigin.TEAM).setParameter("request", requestId).getResultList();
        if (!previous.isEmpty()) {
            var existing = previous.getFirst();
            if (!fingerprint.equals(existing.getRequestFingerprint())) throw new ApiException(422, "request_fingerprint_mismatch");
            return new Creation(card(existing, null), false);
        }
        if (featuredOn != null && em.createQuery("SELECT count(c) FROM ChallengeEntity c WHERE c.featuredOn=:day", Long.class)
                .setParameter("day", featuredOn).getSingleResult() > 0) throw new ApiException(422, "featured_date_conflict");
        var c = new ChallengeEntity(UUID.randomUUID(), draft.line(), draft.work(), draft.character(), draft.sceneNote(),
                draft.durationDays(), ChallengeOrigin.TEAM, null, requestId, fingerprint, featuredOn, now,
                now.plus(draft.durationDays(), ChronoUnit.DAYS));
        em.persist(c);
        em.flush();
        return new Creation(card(c, null), true);
    }

    @Override @Transactional
    public Card moderate(UUID id, String moderation, Instant now) {
        var c = em.find(ChallengeEntity.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (c == null || c.getDeletedAt() != null) return null;
        c.moderate(ChallengeModeration.valueOf(moderation.toUpperCase(Locale.ROOT)));
        em.flush();
        // review 가 끝나면 마감 집계를 기다리던 순위를 확정할 수 있다(challenge.browse 종료 랭킹).
        settlement.settle(id, now);
        return card(c, null);
    }

    @Override @Transactional
    public boolean delete(UUID owner, UUID id, Instant now) {
        lockActive(owner);
        var c = em.find(ChallengeEntity.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (c == null || !owner.equals(c.getHostUserId())) return false;
        if (c.getDeletedAt() != null) return true;
        if (c.getModeration() != ChallengeModeration.VISIBLE) return false;
        long entries = em.createQuery("SELECT count(e) FROM ChallengeEntryEntity e WHERE e.challengeId=:id", Long.class)
                .setParameter("id", id).getSingleResult();
        if (entries > 0) throw new ApiException(422, "challenge_has_entries");
        c.delete(now);
        return true;
    }

    private void lockActive(UUID owner) {
        var owners = NativeTuples.list(em.createNativeQuery("SELECT status FROM users WHERE id=:owner FOR UPDATE", Tuple.class)
                .setParameter("owner", owner));
        if (owners.isEmpty() || !"active".equals(owners.getFirst().get("status", String.class))) {
            throw new ApiException(403, "account_deactivated");
        }
    }

    @Override @Transactional(readOnly = true)
    public Listing list(UUID viewer, String tab, String query, Instant now, ChallengeCursor cursor) {
        return browse.list(viewer, tab, query, now, cursor);
    }

    private Card card(ChallengeEntity c, UUID viewer) {
        em.flush();
        return browse.card(c.getId(), viewer);
    }
}
