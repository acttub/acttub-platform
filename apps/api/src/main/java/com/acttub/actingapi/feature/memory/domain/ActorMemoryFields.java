package com.acttub.actingapi.feature.memory.domain;

import java.util.List;

/**
 * 1.0.0 배우 기억의 칸 넷 (practice.memory).
 *
 * <p><b>성별·나이는 여기 없다</b> — 프로필로 옮겼다(account.profile). 이 순서가 화면이 읽는 순서이고
 * {@code ck_actor_memories_field} 가 최종 방어선이다.
 */
public final class ActorMemoryFields {

    public static final List<String> NAMES =
            List.of("goal", "blockage", "speech_self", "speech_actual");

    private ActorMemoryFields() {
    }

    public static boolean contains(String field) {
        return NAMES.contains(field);
    }
}
