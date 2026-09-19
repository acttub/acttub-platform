package com.acttub.actingapi.feature.transfer.app;

import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 이관 코드의 저장소({@code guest_transfer_codes}). 코드는 해시로만 저장한다.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018).
 */
public interface TransferCodeRepository {

    /**
     * 이 게스트의 새 코드를 적는다. 게스트마다 살아 있는 코드는 하나다 — 앞의 쓰지 않은 코드는 지운다.
     *
     * @return 같은 해시의 살아 있는 코드가 다른 게스트에게 있거나, 같은 게스트의 겹쳐 온 발급에 졌으면
     *         {@code false}(아무것도 적지 않는다) — 부르는 쪽이 다시 뽑는다. 여섯 자리라 겹칠 수 있고, 겹친
     *         채로 두면 코드를 넣은 회원이 누구의 자료를 받을지 알 수 없다
     */
    boolean issue(UUID guestId, String codeHash, Instant now, Instant expiresAt);

    /**
     * 이 해시의 살아 있는 코드(만료 전, 쓰지 않음)를 잠그고 그 코드의 게스트를 돌려준다. 없으면 {@code null}.
     * <b>{@link #inTransaction} 안에서 부른다</b> — 잠금이 옮기기가 끝날 때까지 가야 같은 코드가 두 번
     * 쓰이지 않는다.
     */
    LiveCode lockLive(String codeHash, Instant now);

    /** 코드를 쓴 것으로 적는다. 이 행이 그 게스트가 옮겨졌다는 표식으로 남는다. */
    void markUsed(UUID codeId, Instant now);

    /** 옮기기 전체를 한 트랜잭션으로 묶는다. 안에서 예외가 나면 어느 행도 바뀌지 않는다. */
    <T> T inTransaction(Supplier<T> work);

    record LiveCode(UUID id, UUID guestId) {
    }
}
