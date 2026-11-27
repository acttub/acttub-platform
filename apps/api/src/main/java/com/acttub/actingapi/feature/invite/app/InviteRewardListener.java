package com.acttub.actingapi.feature.invite.app;

import java.util.UUID;

/**
 * 초대 보상(Pro 1개월)이 지급된 직후 불리는 포트(SOMA-865). 지금은 {@code push} 가 이것을 구현해 받은 사람에게 알린다.
 *
 * <p>알림은 지급에 영향을 주면 안 된다. {@link InviteService} 가 지급이 커밋된 <b>뒤에</b> 부르고, 던져진 예외는 보고만 한다.
 */
public interface InviteRewardListener {

    /** @param asInviter 초대한 사람으로 받았으면 true, 초대받은 사람(첫 연습을 끝낸 사람)이면 false */
    void onInviteRewarded(UUID userId, boolean asInviter);
}
