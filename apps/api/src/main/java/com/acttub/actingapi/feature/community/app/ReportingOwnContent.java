package com.acttub.actingapi.feature.community.app;

/**
 * 자기가 쓴 글·댓글을 신고했다.
 *
 * <p>{@link NotAuthor} 와 뜻이 반대다 — 저쪽은 "내 것이 아니라서" 막고 이쪽은 "내 것이라서"
 * 막는다. 종전에 둘이 같은 예외를 쓰고 있어서 400 과 403 이 한 이름에서 갈렸다.
 *
 * <p>대상의 작성자를 서비스가 따로 조회해 판정하지 않는 이유는 그러면 조회와 삽입이 다른
 * 트랜잭션에 놓이기 때문이다.
 */
public class ReportingOwnContent extends RuntimeException {
}
