package com.acttub.actingapi.feature.community.app;

/**
 * 연산이 대상으로 삼은 것이 없다 — 글·댓글·분류·신고 대상·차단 상대 어느 것이든.
 *
 * <p><b>대상별로 나누지 않은 이유</b>: 부르는 쪽에서 뜻이 하나로 정해진다. 글을 쓸 때 없을 수
 * 있는 것은 분류뿐이고, 댓글을 고칠 때 없을 수 있는 것은 그 댓글뿐이다. 그래서 서비스의 각
 * 메서드가 자기 맥락의 오류 코드로 옮긴다.
 *
 * <p>종전에는 저장소의 {@code PostNotFound} 하나를 컨트롤러가 {@code post_not_found}·
 * {@code target_not_found}·{@code user_not_found} 셋으로 갈랐다. 뜻을 정하는 곳이 던지는 곳과
 * 멀어서, 예외 이름을 읽어도 무엇이 없다는 것인지 알 수 없었다.
 */
public class CommunityContentNotFound extends RuntimeException {
}
