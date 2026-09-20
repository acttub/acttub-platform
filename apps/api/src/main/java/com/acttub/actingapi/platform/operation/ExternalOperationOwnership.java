package com.acttub.actingapi.platform.operation;

import java.util.UUID;

import com.acttub.actingapi.platform.ledger.OperationOwnership;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;

/**
 * {@code external_operations.user_id} 만 바꾼다. 상태 전이와 lease 는 그대로다(CONTRACT.md §5-7).
 * {@code (user_id, request_id)} 유니크는 요청 ID 가 난수라 부딪히지 않는다 — 부딪히면 이관이 통째로
 * 되돌려진다.
 *
 * <p>트랜잭션을 열지 않는다. 이 패키지의 다른 자리들은 {@code REQUIRES_NEW} 로 제 트랜잭션을 갖는데, 여기서
 * 그렇게 하면 이관과 따로 커밋된다. 부르는 쪽에 트랜잭션이 없으면 {@code executeUpdate} 가 거절한다.
 */
@Component
class ExternalOperationOwnership implements OperationOwnership {
    private final EntityManager entityManager;

    ExternalOperationOwnership(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void reassign(UUID from, UUID to) {
        entityManager.createNativeQuery("""
                UPDATE external_operations
                SET user_id = :to
                WHERE user_id = :from
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
    }
}
