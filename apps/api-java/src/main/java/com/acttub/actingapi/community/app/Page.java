package com.acttub.actingapi.community.app;

import java.util.List;

/**
 * 한 번에 실어 보낼 만큼과, 그다음을 이어 달라고 할 때 쓸 표.
 *
 * <p>{@code nextCursor} 가 {@code null} 이면 더 없다는 뜻이다. 커서의 속은 저장소만 알고
 * (keyset 페이징이라 정렬 키가 들어 있다), 이 층과 바깥은 문자열로만 다룬다.
 */
public record Page<T>(List<T> items, String nextCursor) {
}
