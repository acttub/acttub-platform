package com.acttub.actingapi.feature.transfer.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.profile.app.StaleTransferCodes;
import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository;
import com.acttub.actingapi.platform.security.TransferredGuests;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresTransferCodeRepository implements TransferCodeRepository, TransferredGuests, StaleTransferCodes {
    private final GuestTransferCodeJpaRepository codes;
    private final TransactionTemplate transaction;

    PostgresTransferCodeRepository(GuestTransferCodeJpaRepository codes, PlatformTransactionManager transactionManager) {
        this.codes = codes;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 유일성은 DB 가 지킨다 — 쓰지 않은 코드는 게스트마다 하나, 숫자(해시)마다 하나다(V10 의 부분 유니크
     * 인덱스 둘). 겹쳐 온 발급은 뒤의 INSERT 가 앞의 커밋을 기다렸다가 {@code ON CONFLICT DO NOTHING} 의
     * 0행으로 끝나고, 서비스가 다시 뽑으면서 앞의 코드를 지운다. 조회 후 쓰기로는 이 경합을 막지 못한다 —
     * 지울 행이 없으면 잠글 행도 없다 (apps/api/CONTRACT.md §5-2).
     *
     * <p>잠금은 코드 행만 잡는다. {@code users} 행을 잡으면 옮기기(코드 행 → 게스트 행)와 순서가 엇갈려
     * 교착한다.
     */
    @Override
    public boolean issue(UUID guestId, String codeHash, Instant now, Instant expiresAt) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            // 새로 받으면 이전 코드는 무효다. 다른 게스트의 같은 숫자는 시한이 지났을 때만 비킨다 — 살아 있는 것과
            // 겹치면 아래 INSERT 가 0행이다.
            codes.deleteReplaceable(guestId, codeHash, now);
            if (codes.insertUnlessTaken(UUID.randomUUID(), guestId, codeHash, now, expiresAt) == 0) {
                // 아무것도 적지 않는다 — 앞의 코드를 지운 것도 되돌린다.
                status.setRollbackOnly();
                return false;
            }
            return true;
        }));
    }

    /**
     * {@code FOR UPDATE} 로 잡는다 — 같은 코드를 든 두 요청 가운데 뒤의 것은 앞의 것이 끝날 때까지
     * 기다렸다가 "이미 쓴 코드"를 본다. 쓰지 않은 같은 숫자는 DB 가 하나로 지킨다(V10).
     */
    @Override
    public LiveCode lockLive(String codeHash, Instant now) {
        List<LiveCode> live = codes.lockLive(codeHash, now);
        return live.size() == 1 ? live.getFirst() : null;
    }

    @Override
    public void markUsed(UUID codeId, Instant now) {
        codes.markUsed(codeId, now);
    }

    /**
     * 옮겨진 게스트의 표식은 <b>쓰인 이관 코드</b>다. 옮기기는 게스트의 신원 행을 지우므로 신원으로는 알 수
     * 없고, 코드 행은 그 게스트의 것으로 남는다. 요청 주체의 판정({@code platform/security})과 갱신이 묻는다.
     */
    @Override
    public boolean transferredGuest(UUID userId) {
        return codes.existsByUserIdAndUsedAtIsNotNull(userId);
    }

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        return transaction.execute(status -> work.get());
    }

    @Override
    public int deleteStale(Instant before) {
        return transaction.execute(status -> codes.deleteStale(before));
    }
}
