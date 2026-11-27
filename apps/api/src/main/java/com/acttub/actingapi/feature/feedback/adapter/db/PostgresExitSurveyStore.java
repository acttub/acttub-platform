package com.acttub.actingapi.feature.feedback.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.ExitSurveyAsk;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyOwnership;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore;
import com.acttub.actingapi.feature.practice.app.PracticeOwners;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이탈 설문의 Postgres 구현 — {@code practice_feedback} (V14). 접수만 native 이고 나머지는 JPQL 이다. 노출 표식({@code users.exit_survey_asked_at})은 계정 행의 칸이라
 * {@code auth} 의 {@link ExitSurveyAsk} 가 고친다.
 *
 * <p>접수는 {@code (user_id, request_id)} 로 멱등하다. 노출 표식의 선점은 한 문장이다 — 두 기기가 동시에 물어도 하나만 이긴다.
 */
@Repository
class PostgresExitSurveyStore implements ExitSurveyStore, ExitSurveyOwnership {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ExitSurveyAsk asks;

    private final PracticeOwners practiceOwners;

    PostgresExitSurveyStore(
            EntityManager entityManager, PlatformTransactionManager transactionManager, ExitSurveyAsk asks,
            PracticeOwners practiceOwners) {
        this.practiceOwners = practiceOwners;
        this.asks = asks;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public boolean ownsPractice(UUID userId, UUID practiceId) {
        if (practiceId == null) {
            return true;
        }
        return practiceOwners.owns(userId, practiceId);
    }

    /**
     * {@code INSERT … SELECT FROM users} 인 것은 닫힌 계정에 새 설문이 남지 않게 하려는 것이다 — 없는
     * 사용자와 탈퇴한 계정이 FK 위반이 아니라 <b>0행</b>으로 돌아온다. 재전송은 {@code DO NOTHING} 뒤에
     * 먼저 만든 행을 읽어 같은 id 를 준다.
     *
     * <p>넣는 문장은 native 로 남았다. 한 문장에서 다른 기능(auth)의 {@code users} 를 읽고, 나눠 읽으면 문장이 하나 늘고 확인과
     * 넣기가 다른 스냅숏이 된다(apps/api/CONTRACT.md §5-1·§5-9).
     */
    @Override
    public Accepted submit(NewSurvey survey, Instant now) {
        return transaction.execute(tx -> {
            UUID id = UUID.randomUUID();
            boolean created = !NativeTuples.list(entityManager.createNativeQuery("""
                    WITH inserted AS (
                        INSERT INTO practice_feedback(id,user_id,practice_id,screen,trigger,body,
                                                      contact_email,contact_phone,request_id,
                                                      created_at,updated_at)
                        SELECT :id,u.id,CAST(:practiceId AS uuid),:screen,:trigger,CAST(:body AS text),
                               CAST(:email AS text),CAST(:phone AS text),:requestId,:now,:now
                        FROM users u
                        WHERE u.id=:userId AND u.status='active'
                        ON CONFLICT (user_id,request_id) DO NOTHING
                        RETURNING id
                    )
                    SELECT id FROM inserted
                    """, Tuple.class)
                    .setParameter("id", id)
                    .setParameter("practiceId", survey.practiceId())
                    .setParameter("screen", survey.screen())
                    .setParameter("trigger", survey.trigger())
                    .setParameter("body", survey.body())
                    .setParameter("email", survey.contactEmail())
                    .setParameter("phone", survey.contactPhone())
                    .setParameter("requestId", survey.requestId())
                    .setParameter("userId", survey.userId())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).isEmpty();
            if (created) {
                return new Accepted(id, true);
            }
            List<UUID> existing = entityManager.createQuery("""
                    select f.id from PracticeFeedbackEntity f
                    where f.userId = :userId and f.requestId = :requestId
                    """, UUID.class)
                    .setParameter("userId", survey.userId())
                    .setParameter("requestId", survey.requestId())
                    .getResultList();
            // 행이 없으면 넣지 못한 까닭은 재전송이 아니라 닫힌 계정이다.
            return existing.isEmpty() ? null : new Accepted(existing.getFirst(), false);
        });
    }

    /** 한 문장으로 선점한다 — 이긴 쪽만 1행을 갱신하고 진 쪽은 0행이다. */
    @Override
    public boolean claimAsk(UUID userId, Instant now) {
        return asks.claim(userId, now);
    }

    @Override
    public List<SheetRow> pendingSheetRows(int limit) {
        return entityManager.createQuery("""
                select new com.acttub.actingapi.feature.feedback.app.ExitSurveyStore$SheetRow(
                       f.id, f.sheetSeq, f.userId, f.practiceId, f.screen, f.trigger, f.body,
                       f.contactEmail, f.contactPhone, f.createdAt)
                from PracticeFeedbackEntity f
                where f.sheetSyncedAt is null
                order by f.createdAt, f.id
                """, SheetRow.class)
                .setMaxResults(limit)
                .getResultList();
    }

    /** 그 사이 순번이 올라갔으면(연락처 파기) 아무것도 쓰지 않는다 — 보낸 것이 이미 낡은 줄이다. */
    @Override
    public void markSheetSynced(UUID id, int seq, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createQuery("""
                update PracticeFeedbackEntity f
                set f.sheetSyncedAt = :now, f.updatedAt = :now
                where f.id = :id and f.sheetSeq = :seq
                """)
                .setParameter("now", now)
                .setParameter("id", id)
                .setParameter("seq", seq)
                .executeUpdate());
    }

    @Override
    public int purgeExpiredContacts(Instant acceptedBefore, Instant now) {
        return transaction.execute(tx -> entityManager.createQuery("""
                update PracticeFeedbackEntity f
                set f.contactEmail = null, f.contactPhone = null,
                    f.sheetSeq = f.sheetSeq + 1, f.sheetSyncedAt = null, f.updatedAt = :now
                where f.createdAt < :cutoff
                  and (f.contactEmail is not null or f.contactPhone is not null)
                """)
                .setParameter("now", now)
                .setParameter("cutoff", acceptedBefore)
                .executeUpdate());
    }

    // --- 이관 ---------------------------------------------------------------

    /**
     * 설문 이력 행은 모두 회원으로 옮기고, 게스트·회원 <b>어느 쪽이든 물어봤으면</b> 회원도 물어본 것이다
     * (practice.feedback). 먼저 물어본 시각을 남긴다.
     *
     * <p>트랜잭션을 열지 않는다 — 부르는 쪽(이관)의 것에 참여한다.
     */
    @Override
    public void reassign(UUID from, UUID to) {
        entityManager.createQuery("""
                update PracticeFeedbackEntity f set f.userId = :to, f.updatedAt = instant where f.userId = :from
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
        asks.carryOver(from, to);
    }
}
