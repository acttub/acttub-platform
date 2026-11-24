package com.acttub.actingapi.feature.invite.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.invite.app.InviteRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 친구 초대 장부(V96, SOMA-865). 두 표를 native SQL 로만 읽고 쓴다(엔티티 없음, EntityMappingIT 의 대기 목록).
 *
 * <p>⚠ 다른 feature 의 표를 같은 트랜잭션에서 읽고 쓴다 — {@code users}·{@code user_identities}({@code auth}),
 * {@code reading_sessions}({@code reading}), {@code practices}·{@code coach_conversations}·{@code coach_notes}({@code coach}),
 * {@code billing_pro_grants}({@code billing}). 지급 시각 채우기와 Pro 기간 넣기가 한 트랜잭션이어야 「한 번만, 빠짐없이」가
 * 서고(커밋 뒤에 따로 넣다 실패하면 보상이 사라진다), 월 상한은 초대한 사람의 계정 행을 잡아야 동시 지급에서도 넘지 않는다.
 * 그래서 {@code PostgresPushTokenRepository} 처럼 native SQL 로 묻고 다른 feature 의 Schema Entity 는 import 하지 않는다.
 * Pro 기간 줄의 모양(사유 {@code friend_invite}, 시작~끝)은 billing.subscription 「개정: 결제 출처별 구독」의 grant 다.
 */
@Repository
class PostgresInviteRepository implements InviteRepository {
    static final String GRANT_REASON = "friend_invite";

    /** 활성 회원(게스트 아님). 게스트는 신원이 있고 전부 guest 인 계정이다(AuthenticatedUser.guest 와 같은 판정). */
    private static final String MEMBER = """
            users.status='active'
            AND EXISTS (SELECT 1 FROM user_identities
                        WHERE user_identities.user_id=users.id AND user_identities.provider<>'guest')
            """;

    /** practice.days 와 같은 「센 연습」 정의. */
    private static final String READING_COUNTED = """
            EXISTS (SELECT 1 FROM reading_sessions s
                    WHERE s.id=:practiceId AND s.user_id=:invitee AND s.status='completed')
            """;
    private static final String COACHING_COUNTED = """
            EXISTS (SELECT 1 FROM practices p
                    JOIN coach_conversations c ON c.practice_id=p.id
                    JOIN coach_notes n ON n.conversation_id=c.id
                    WHERE p.id=:practiceId AND p.user_id=:invitee)
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresInviteRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Optional<String> findCode(UUID userId) {
        return transaction.execute(tx -> list(entityManager.createNativeQuery(
                        "SELECT code FROM invite_codes WHERE user_id=:userId", Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("code", String.class))
                .findFirst());
    }

    /**
     * 넣은 줄이 있으면 그 코드, 없으면 이미 있던 내 코드다. 같은 문장의 두 번째 SELECT 는 넣은 줄을 보지 못하므로(같은 스냅샷)
     * 둘 중 하나만 나온다. 둘 다 없으면 다른 사람이 쓰는 코드와 겹친 것이다.
     */
    @Override
    public Optional<String> attachCode(UUID userId, String code) {
        return transaction.execute(tx -> list(entityManager.createNativeQuery("""
                        WITH attached AS (
                            INSERT INTO invite_codes(user_id,code)
                            VALUES (:userId,:code)
                            ON CONFLICT DO NOTHING
                            RETURNING code
                        )
                        SELECT code FROM attached
                        UNION ALL
                        SELECT code FROM invite_codes WHERE user_id=:userId
                        """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("code", code)).stream()
                .map(row -> row.get("code", String.class))
                .findFirst());
    }

    @Override
    public State state(UUID userId) {
        return transaction.execute(tx -> list(entityManager.createNativeQuery("""
                        SELECT users.created_at AS signed_up_at,
                               r.invitee_id IS NOT NULL AS redeemed,
                               COALESCE(r.rewarded_at IS NOT NULL, false) AS rewarded,
                               (SELECT count(*) FROM billing_pro_grants g
                                WHERE g.user_id=users.id AND g.reason=:reason) AS reward_count
                        FROM users
                        LEFT JOIN invite_redemptions r ON r.invitee_id=users.id
                        WHERE users.id=:userId
                        """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("reason", GRANT_REASON)).stream()
                .map(row -> new State(
                        instant(row.get("signed_up_at")),
                        Boolean.TRUE.equals(row.get("redeemed", Boolean.class)),
                        Boolean.TRUE.equals(row.get("rewarded", Boolean.class)),
                        ((Number) row.get("reward_count")).intValue()))
                .findFirst()
                .orElse(null));
    }

    @Override
    public RedeemOutcome redeem(UUID inviteeId, String code, Instant now, Duration window) {
        return transaction.execute(tx -> {
            // 넣는 사람의 계정 행을 잡아 같은 사람의 동시 요청과 탈퇴를 줄 세운다.
            List<Tuple> me = list(entityManager.createNativeQuery("""
                            SELECT users.created_at > CAST(:windowStart AS timestamptz) AS in_window
                            FROM users
                            WHERE users.id=:invitee AND users.status='active'
                            FOR UPDATE
                            """, Tuple.class)
                    .setParameter("invitee", inviteeId)
                    .setParameter("windowStart", at(now.minus(window))));
            if (me.isEmpty()) {
                return RedeemOutcome.ACCOUNT_INACTIVE;
            }
            boolean redeemed = !list(entityManager.createNativeQuery(
                            "SELECT invitee_id FROM invite_redemptions WHERE invitee_id=:invitee", Tuple.class)
                    .setParameter("invitee", inviteeId)).isEmpty();
            if (redeemed) {
                return RedeemOutcome.ALREADY_REDEEMED;
            }
            if (!Boolean.TRUE.equals(me.getFirst().get("in_window", Boolean.class))) {
                return RedeemOutcome.WINDOW_CLOSED;
            }
            List<Tuple> inviter = list(entityManager.createNativeQuery("""
                            SELECT c.user_id
                            FROM invite_codes c
                            JOIN users ON users.id=c.user_id
                            WHERE c.code=:code AND
                            """ + MEMBER, Tuple.class)
                    .setParameter("code", code));
            if (inviter.isEmpty()) {
                return RedeemOutcome.CODE_NOT_FOUND;
            }
            UUID inviterId = inviter.getFirst().get("user_id", UUID.class);
            if (inviterId.equals(inviteeId)) {
                return RedeemOutcome.OWN_CODE;
            }
            entityManager.createNativeQuery("""
                            INSERT INTO invite_redemptions(invitee_id,inviter_id,code,created_at)
                            VALUES (:invitee,:inviter,:code,CAST(:now AS timestamptz))
                            ON CONFLICT (invitee_id) DO NOTHING
                            """)
                    .setParameter("invitee", inviteeId)
                    .setParameter("inviter", inviterId)
                    .setParameter("code", code)
                    .setParameter("now", at(now))
                    .executeUpdate();
            return RedeemOutcome.REDEEMED;
        });
    }

    @Override
    public Optional<Reward> rewardIfCounted(UUID inviteeId, Practice practice, UUID practiceId, Instant now,
            Instant monthStart, int inviterCap) {
        String counted = practice == Practice.READING ? READING_COUNTED : COACHING_COUNTED;
        return transaction.execute(tx -> {
            // 지급 시각을 채운 쪽만 지급한다 — 같은 줄의 동시 갱신은 행 잠금으로 줄 서고, 뒤에 온 쪽은 0행이다.
            List<Tuple> claimed = list(entityManager.createNativeQuery("""
                            WITH claimed AS (
                                UPDATE invite_redemptions
                                SET rewarded_at=CAST(:now AS timestamptz)
                                WHERE invitee_id=:invitee
                                  AND rewarded_at IS NULL
                                  AND """ + counted + """
                                RETURNING inviter_id
                            )
                            SELECT inviter_id FROM claimed
                            """, Tuple.class)
                    .setParameter("invitee", inviteeId)
                    .setParameter("practiceId", practiceId)
                    .setParameter("now", at(now)));
            if (claimed.isEmpty()) {
                return Optional.<Reward>empty();
            }
            UUID inviterId = claimed.getFirst().get("inviter_id", UUID.class);
            UUID rewardedInviter = inviterId != null && inviterUnderCap(inviterId, monthStart, inviterCap) ? inviterId : null;
            if (rewardedInviter != null) {
                entityManager.createNativeQuery(
                                "UPDATE invite_redemptions SET inviter_rewarded=true WHERE invitee_id=:invitee")
                        .setParameter("invitee", inviteeId)
                        .executeUpdate();
                grant(rewardedInviter, now);
            }
            grant(inviteeId, now);
            return Optional.of(new Reward(inviteeId, rewardedInviter));
        });
    }

    /**
     * 초대한 사람이 지금 받을 수 있는가 — 활성 회원이고 이번 달 받은 보상이 상한보다 적다. 그 사람의 계정 행을 잡아 같은 사람에게
     * 동시에 가는 지급을 줄 세운다(세기와 표시가 한 줄로 선다).
     */
    private boolean inviterUnderCap(UUID inviterId, Instant monthStart, int cap) {
        boolean member = !list(entityManager.createNativeQuery("""
                        SELECT users.id
                        FROM users
                        WHERE users.id=:inviter AND
                        """ + MEMBER + """
                        FOR UPDATE OF users
                        """, Tuple.class)
                .setParameter("inviter", inviterId)).isEmpty();
        if (!member) {
            return false;
        }
        Number given = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM invite_redemptions
                        WHERE inviter_id=:inviter
                          AND inviter_rewarded
                          AND rewarded_at>=CAST(:monthStart AS timestamptz)
                        """)
                .setParameter("inviter", inviterId)
                .setParameter("monthStart", at(monthStart))
                .getSingleResult();
        return given.longValue() < cap;
    }

    /**
     * Pro 1개월 기간을 한 줄 넣는다. 이미 받은 기간(다른 초대 보상·운영 지급)이 남아 있으면 그 끝에 잇는다 — 겹쳐서 사라지지 않게.
     * 결제 구독(billing_subscriptions)은 보지도 건드리지도 않는다.
     */
    private void grant(UUID userId, Instant now) {
        entityManager.createNativeQuery("""
                        INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason)
                        SELECT CAST(:id AS uuid), CAST(:userId AS uuid), base.starts_at, base.starts_at + interval '1 month',
                               CAST(:reason AS text)
                        FROM (SELECT GREATEST(CAST(:now AS timestamptz),
                                              COALESCE((SELECT max(ends_at) FROM billing_pro_grants WHERE user_id=:userId),
                                                       CAST(:now AS timestamptz))) AS starts_at) AS base
                        """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("reason", GRANT_REASON)
                .setParameter("now", at(now))
                .executeUpdate();
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof Instant direct) {
            return direct;
        }
        return ((java.sql.Timestamp) value).toInstant();
    }
}
