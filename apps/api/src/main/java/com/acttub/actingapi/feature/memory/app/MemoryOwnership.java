package com.acttub.actingapi.feature.memory.app;

import java.util.UUID;

/**
 * 배우 기억의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest, ADR-028).
 *
 * <p>기억은 다른 자료와 달리 <b>합치지 않는다.</b> 회원에게 기억이 없으면 게스트의 것을 옮기고, 둘 다 있으면
 * 배우가 고른 쪽만 남긴다 — 칸마다 섞으면 누구의 것도 아닌 기억이 된다. <b>부르는 쪽의 트랜잭션에
 * 참여한다.</b>
 */
public interface MemoryOwnership {

    /** 이 사람에게 기억이 한 칸이라도 있는가. */
    boolean hasMemory(UUID userId);

    /** 이 사람의 기억을 전부 버린다. */
    void discard(UUID userId);

    /** {@code to} 에게 기억이 없을 때만 부른다. */
    void reassign(UUID from, UUID to);
}
