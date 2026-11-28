package com.acttub.actingapi.feature.auth.app;

import java.util.UUID;

/**
 * 계정 행({@code users})의 잠금 (docs/specs/common.md 「탈퇴와 겹친 쓰기」, ADR-040).
 *
 * <p>회원 자료를 쓰는 트랜잭션은 첫 문장으로 탈퇴·게스트 이전이 잡는 것과 <b>같은 계정 행</b>을 잡는다. 그러면 둘이 줄을 선다:
 * 쓰기가 먼저면 탈퇴가 그 뒤에 파기하고, 탈퇴가 먼저면 쓰기가 활성이 아님을 보고 그만둔다. 같은 사람의 겹친 요청(한도 세기,
 * 총량 세기)을 줄 세울 때도 이 행을 잡는다.
 *
 * <p>계정 행은 {@code auth} 의 것이라 다른 기능은 이 Port 로 잠근다. <b>부르는 쪽의 트랜잭션 안에서</b> 불러야 한다 — 잠금은 그
 * 트랜잭션이 끝날 때 풀린다. 트랜잭션 밖에서 부르면 거절한다.
 */
public interface AccountRowLock {

    /**
     * 계정 행을 잠그고 활성인지 본다. 탈퇴한 계정의 행도 잠근다.
     *
     * @return 계정이 있고 활성이면 참
     */
    boolean lockActive(UUID userId);

    /**
     * 계정 행을 잠그기만 한다. 활성인지는 묻지 않는다(같은 사람의 겹친 요청을 줄 세울 때, 상대의 행을 쓰기로 잡을 때).
     *
     * @return 계정이 있으면 참
     */
    boolean lockRow(UUID userId);

    /**
     * 계정 행을 읽기로 잠근다({@code FOR SHARE}). 그 행을 쓰기로 잡는 쪽(탈퇴, 그 사람의 쓰기)은 이 트랜잭션이 끝날 때까지 기다리고,
     * 읽기끼리는 함께 쥔다. 행동하는 사람이 아니라 상대의 행을 잡을 때 쓴다 — 활성인지는 묻지 않는다.
     *
     * @return 계정이 있으면 참
     */
    boolean lockShared(UUID userId);
}
