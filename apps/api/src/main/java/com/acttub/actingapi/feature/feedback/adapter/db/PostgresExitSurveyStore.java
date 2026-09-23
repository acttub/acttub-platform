package com.acttub.actingapi.feature.feedback.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.feedback.app.ExitSurveyOwnership;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이탈 설문의 Postgres 구현 — {@code practice_feedback} 와 {@code users.exit_survey_asked_at} (V14).
 *
 * <p>접수는 {@code (user_id, request_id)} 로 멱등하다. 노출 표식의 선점은 한 문장이다
 * ({@code UPDATE … WHERE exit_survey_asked_at IS NULL}) — 두 기기가 동시에 물어도 하나만 이긴다.
 */
@Repository
class PostgresExitSurveyStore implements ExitSurveyStore, ExitSurveyOwnership {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresExitSurveyStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public boolean ownsPractice(UUID userId, UUID practiceId) {
        if (practiceId == null) {
            return true;
        }
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id FROM practices WHERE id=:practiceId AND user_id=:userId
                """, Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)).isEmpty();
    }

    /**
     * {@code INSERT … SELECT FROM users} 인 것은 닫힌 계정에 새 설문이 남지 않게 하려는 것이다 — 없는
     * 사용자와 탈퇴한 계정이 FK 위반이 아니라 <b>0행</b>으로 돌아온다. 재전송은 {@code DO NOTHING} 뒤에
     * 먼저 만든 행을 읽어 같은 id 를 준다.
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
            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM practice_feedback
                    WHERE user_id=:userId AND request_id=:requestId
                    """, Tuple.class)
                    .setParameter("userId", survey.userId())
                    .setParameter("requestId", survey.requestId()));
            // 행이 없으면 넣지 못한 까닭은 재전송이 아니라 닫힌 계정이다.
            return existing.isEmpty() ? null : new Accepted(existing.getFirst().get("id", UUID.class), false);
        });
    }

    @Override
    public boolean asked(UUID userId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id FROM users WHERE id=:userId AND exit_survey_asked_at IS NOT NULL
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
    }

    /** 한 문장으로 선점한다 — 이긴 쪽만 1행을 갱신하고 진 쪽은 0행이다. */
    @Override
    public boolean claimAsk(UUID userId, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE users
                SET exit_survey_asked_at=:now,updated_at=:now
                WHERE id=:userId
                  AND status='active'
                  AND exit_survey_asked_at IS NULL
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .executeUpdate() > 0));
    }

    @Override
    public List<SheetRow> pendingSheetRows(int limit) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,sheet_seq,user_id,practice_id,screen,trigger,body,
                       contact_email,contact_phone,created_at
                FROM practice_feedback
                WHERE sheet_synced_at IS NULL
                ORDER BY created_at,id
                LIMIT :limit
                """, Tuple.class)
                .setParameter("limit", limit)).stream()
                .map(row -> new SheetRow(
                        row.get("id", UUID.class),
                        ((Number) row.get("sheet_seq")).intValue(),
                        row.get("user_id", UUID.class),
                        row.get("practice_id", UUID.class),
                        row.get("screen", String.class),
                        row.get("trigger", String.class),
                        row.get("body", String.class),
                        row.get("contact_email", String.class),
                        row.get("contact_phone", String.class),
                        row.get("created_at", Instant.class)))
                .toList();
    }

    /** 그 사이 순번이 올라갔으면(연락처 파기) 아무것도 쓰지 않는다 — 보낸 것이 이미 낡은 줄이다. */
    @Override
    public void markSheetSynced(UUID id, int seq, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE practice_feedback
                SET sheet_synced_at=:now,updated_at=:now
                WHERE id=:id AND sheet_seq=:seq
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", id)
                .setParameter("seq", seq)
                .executeUpdate());
    }

    @Override
    public int purgeExpiredContacts(Instant acceptedBefore, Instant now) {
        return transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE practice_feedback
                SET contact_email=NULL,contact_phone=NULL,
                    sheet_seq=sheet_seq+1,sheet_synced_at=NULL,updated_at=:now
                WHERE created_at<:cutoff
                  AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("cutoff", acceptedBefore.atOffset(ZoneOffset.UTC))
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
        entityManager.createNativeQuery("""
                UPDATE practice_feedback SET user_id=:to,updated_at=now() WHERE user_id=:from
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
        entityManager.createNativeQuery("""
                UPDATE users member
                SET exit_survey_asked_at=LEAST(
                        COALESCE(member.exit_survey_asked_at, guest.exit_survey_asked_at),
                        COALESCE(guest.exit_survey_asked_at, member.exit_survey_asked_at)),
                    updated_at=now()
                FROM users guest
                WHERE member.id=:to
                  AND guest.id=:from
                  AND guest.exit_survey_asked_at IS NOT NULL
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
    }
}
