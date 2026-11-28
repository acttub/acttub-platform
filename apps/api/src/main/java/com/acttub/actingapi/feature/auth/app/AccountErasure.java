package com.acttub.actingapi.feature.auth.app;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 계정을 닫을 때(탈퇴, 만 14세 미만 계정 닫기) 한 기능이 자기 표에서 하는 일.
 *
 * <p>계정 쪽은 표를 모르고 순서만 안다({@link AccountErasureStep}, {@link AccountErasureSequence}). 표를 고치는 것은 그 표의
 * 주인이다. 선언이 {@code auth} 에 있는 것은 {@code auth} 가 다른 기능을 보지 않아서다. 구현하는 기능이 {@code auth.app} 을 보는
 * 한 방향 간선만 생긴다.
 *
 * <p>⚠ <b>구현은 트랜잭션을 열지 않는다.</b> 부르는 쪽의 트랜잭션에 참여한다. 따로 커밋하면 중간에 실패했을 때 「탈퇴는
 * 되돌아갔는데 이 기능의 자료만 지워진」 계정이 남는다({@code AccountErasureStructureTest} 가 지킨다).
 */
public interface AccountErasure {

    /** 이 구현이 맡는 자리들. 자리마다 구현은 하나다. 탈퇴에서 고칠 것이 없는 기능은 비어 있다. */
    Set<AccountErasureStep> steps();

    /**
     * 그 자리에서 이 계정의 자기 몫을 지운다. 다시 온 탈퇴에서도 불리므로 멱등이어야 한다.
     *
     * @return 정리 장부에 올린 일의 id(없으면 빈 목록). 부르는 쪽이 커밋 뒤에 한 번 시도한다
     */
    List<UUID> erase(AccountErasureStep step, ClosingAccount account);

    /**
     * 만 14세 미만 계정 닫기가 계정 행을 지우기 바로 앞에 부른다({@link AccountErasureSequence#closeUnderage}). 이 계정을
     * 가리키지만 외래 키가 없어 계정 행과 함께 지워지지 않는 자기 행을 지운다. 외래 키가 있는 행은 계정 행을 지울 때
     * {@code ON DELETE CASCADE} 로 따라 지워지므로(V104) 할 일이 없다.
     */
    default void eraseWithAccountRow(UUID userId) {
    }
}
