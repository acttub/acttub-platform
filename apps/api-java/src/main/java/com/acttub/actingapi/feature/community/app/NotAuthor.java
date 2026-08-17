package com.acttub.actingapi.feature.community.app;

/**
 * 고치거나 지우려는 글·댓글이 자기 것이 아니다.
 *
 * <p>있음과 소유권을 <b>같은 트랜잭션 안에서</b> 가려야 한다. 행을 먼저 읽어 와 서비스에서
 * 비교하면 그 사이에 상태가 바뀔 수 있고, 잠금 순서도 흐트러진다.
 */
public class NotAuthor extends RuntimeException {
}
