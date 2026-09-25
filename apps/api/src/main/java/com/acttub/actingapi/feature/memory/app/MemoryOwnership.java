package com.acttub.actingapi.feature.memory.app;

import java.util.UUID;

/**
 * 배우 기억의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest, ADR-028).
 *
 * <p>기억은 다른 자료와 달리 <b>합치지 않는다.</b> 회원에게 기억이 없으면 게스트의 것을 옮기고, 둘 다 있으면
 * 배우가 고른 쪽만 남긴다 — 칸마다 섞으면 누구의 것도 아닌 기억이 된다. <b>부르는 쪽의 트랜잭션에
 * 참여한다.</b>
 *
 * <p>구현은 1.0.0 표({@code actor_memories})와 옛 표({@code actor_memory_entries})를 <b>함께</b> 다룬다 —
 * 이관은 한 트랜잭션이고 옛 자료를 잃지 않아야 한다(02-practice 「1.0.0 스키마 전환」).
 */
public interface MemoryOwnership {

    /** 이 사람에게 기억이 한 칸이라도 있는가. */
    boolean hasMemory(UUID userId);

    /** 이 사람의 기억을 전부 버린다. */
    void discard(UUID userId);

    /** {@code to} 에게 기억이 없을 때만 부른다. */
    void reassign(UUID from, UUID to);

    /**
     * 기억 세대를 하나 올린다 — <b>이관에서 한쪽을 골랐을 때</b> 부른다(practice.memory).
     *
     * <p>그래야 버린 쪽에서 시작된 갱신 작업이 완료 때 세대가 달라 반영되지 않는다. 작업 행은 이관을 따라
     * 회원에게 오지만 그 결과는 이미 지난 기억이다.
     */
    void bumpEpoch(UUID userId);
}
