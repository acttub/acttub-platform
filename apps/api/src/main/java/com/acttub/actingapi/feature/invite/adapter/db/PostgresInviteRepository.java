package com.acttub.actingapi.feature.invite.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountFacts;
import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.billing.app.ProGrants;
import com.acttub.actingapi.feature.coach.app.NotedPractices;
import com.acttub.actingapi.feature.invite.app.InviteRepository;
import com.acttub.actingapi.feature.reading.app.CompletedReadings;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 친구 초대 장부(V104, SOMA-865). 자기 표 둘({@code invite_codes}·{@code invite_redemptions})은 HQL 이 기본이고, PostgreSQL 의미가
 * 필요한 문장(코드 붙이기의 {@code ON CONFLICT … RETURNING}, 넣기의 {@code ON CONFLICT DO NOTHING}, 지급 시각 채우기의
 * {@code UPDATE … RETURNING})만 native 다(CONTRACT §5-2).
 *
 * <p>남의 표는 주인의 Port 로만 닿는다(ADR-040): 계정 행 잠금은 {@link AccountRowLock}, 가입 시각·활성 회원 판정은
 * {@link AccountFacts}, 「센 연습」은 {@link CompletedReadings}·{@link NotedPractices}, Pro 기간은 {@link ProGrants}. Port 들은
 * 트랜잭션을 열지 않으므로 지급 시각 채우기와 Pro 기간 넣기가 이 저장소의 한 트랜잭션에 든다 — 커밋 뒤에 따로 넣다 실패하면
 * 보상이 사라지기 때문이다. 월 상한은 초대한 사람의 계정 행을 잡아야 동시 지급에서도 넘지 않는다.
 */
@Repository
class PostgresInviteRepository implements InviteRepository {
    static final String GRANT_REASON = "friend_invite";

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AccountRowLock accountRows;
    private final AccountFacts accounts;
    private final CompletedReadings readings;
    private final NotedPractices notes;
    private final ProGrants grants;

    PostgresInviteRepository(EntityManager entityManager, PlatformTransactionManager transactionManager,
            AccountRowLock accountRows, AccountFacts accounts, CompletedReadings readings, NotedPractices notes,
            ProGrants grants) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.accountRows = accountRows;
        this.accounts = accounts;
        this.readings = readings;
        this.notes = notes;
        this.grants = grants;
    }

    @Override
    public Optional<String> findCode(UUID userId) {
        return transaction.execute(tx -> entityManager.createQuery(
                        "select c.code from InviteCodeEntity c where c.userId = :userId", String.class)
                .setParameter("userId", userId)
                .getResultList().stream()
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
        return transaction.execute(tx -> {
            Optional<Instant> signedUpAt = accounts.signedUpAt(userId);
            if (signedUpAt.isEmpty()) {
                return null;
            }
            List<Instant> rewardedAt = entityManager.createQuery(
                            "select r.rewardedAt from InviteRedemptionEntity r where r.inviteeId = :userId", Instant.class)
                    .setParameter("userId", userId)
                    .getResultList();
            boolean redeemed = !rewardedAt.isEmpty();
            boolean rewarded = redeemed && rewardedAt.getFirst() != null;
            return new State(signedUpAt.get(), redeemed, rewarded, grants.count(userId, GRANT_REASON));
        });
    }

    @Override
    public RedeemOutcome redeem(UUID inviteeId, String code, Instant now, Duration window) {
        return transaction.execute(tx -> {
            // 넣는 사람의 계정 행을 잡아 같은 사람의 동시 요청과 탈퇴를 줄 세운다.
            if (!accountRows.lockActive(inviteeId)) {
                return RedeemOutcome.ACCOUNT_INACTIVE;
            }
            boolean redeemed = !entityManager.createQuery(
                            "select r.inviteeId from InviteRedemptionEntity r where r.inviteeId = :invitee", UUID.class)
                    .setParameter("invitee", inviteeId)
                    .getResultList()
                    .isEmpty();
            if (redeemed) {
                return RedeemOutcome.ALREADY_REDEEMED;
            }
            Instant windowStart = now.minus(window);
            boolean inWindow = accounts.signedUpAt(inviteeId).map(at -> at.isAfter(windowStart)).orElse(false);
            if (!inWindow) {
                return RedeemOutcome.WINDOW_CLOSED;
            }
            // 탈퇴·게스트의 코드는 없는 코드와 같다.
            Optional<UUID> inviter = entityManager.createQuery(
                            "select c.userId from InviteCodeEntity c where c.code = :code", UUID.class)
                    .setParameter("code", code)
                    .getResultList().stream()
                    .findFirst()
                    .filter(accounts::activeMember);
            if (inviter.isEmpty()) {
                return RedeemOutcome.CODE_NOT_FOUND;
            }
            UUID inviterId = inviter.get();
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

    /**
     * 「센 연습」은 practice.days 와 같은 정의다: 그 사람의 완료한 리딩 회차, 또는 대화에 노트가 남은 코칭 회차. 코칭 회차의 주인은
     * 묻지 않는다 — 부르는 쪽({@code ConversationClosedListener})이 그 회차의 주인으로 부른다. 두 판정 모두 한번 참이면 계속
     * 참이라, 지급 시각 채우기 앞에서 따로 물어도 결과가 같다.
     */
    @Override
    public Optional<Reward> rewardIfCounted(UUID inviteeId, Practice practice, UUID practiceId, Instant now,
            Instant monthStart, int inviterCap) {
        return transaction.execute(tx -> {
            boolean counted = practice == Practice.READING
                    ? readings.completed(inviteeId, practiceId)
                    : notes.noted(practiceId);
            if (!counted) {
                return Optional.<Reward>empty();
            }
            // 지급 시각을 채운 쪽만 지급한다 — 같은 줄의 동시 갱신은 행 잠금으로 줄 서고, 뒤에 온 쪽은 0행이다.
            List<Tuple> claimed = list(entityManager.createNativeQuery("""
                            WITH claimed AS (
                                UPDATE invite_redemptions
                                SET rewarded_at=CAST(:now AS timestamptz)
                                WHERE invitee_id=:invitee
                                  AND rewarded_at IS NULL
                                RETURNING inviter_id
                            )
                            SELECT inviter_id FROM claimed
                            """, Tuple.class)
                    .setParameter("invitee", inviteeId)
                    .setParameter("now", at(now)));
            if (claimed.isEmpty()) {
                return Optional.<Reward>empty();
            }
            UUID inviterId = claimed.getFirst().get("inviter_id", UUID.class);
            UUID rewardedInviter = inviterId != null && inviterUnderCap(inviterId, monthStart, inviterCap) ? inviterId : null;
            if (rewardedInviter != null) {
                entityManager.createQuery(
                                "update InviteRedemptionEntity r set r.inviterRewarded = true where r.inviteeId = :invitee")
                        .setParameter("invitee", inviteeId)
                        .executeUpdate();
                grants.grantMonth(rewardedInviter, GRANT_REASON, now);
            }
            grants.grantMonth(inviteeId, GRANT_REASON, now);
            return Optional.of(new Reward(inviteeId, rewardedInviter));
        });
    }

    /**
     * 초대한 사람이 지금 받을 수 있는가 — 활성 회원이고 이번 달 받은 보상이 상한보다 적다. 그 사람의 계정 행을 잡아 같은 사람에게
     * 동시에 가는 지급을 줄 세운다(세기와 표시가 한 줄로 선다).
     */
    private boolean inviterUnderCap(UUID inviterId, Instant monthStart, int cap) {
        if (!accountRows.lockActive(inviterId) || !accounts.activeMember(inviterId)) {
            return false;
        }
        long given = entityManager.createQuery("""
                        select count(r) from InviteRedemptionEntity r
                        where r.inviterId = :inviter and r.inviterRewarded = true and r.rewardedAt >= :monthStart
                        """, Long.class)
                .setParameter("inviter", inviterId)
                .setParameter("monthStart", monthStart)
                .getSingleResult();
        return given < cap;
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
