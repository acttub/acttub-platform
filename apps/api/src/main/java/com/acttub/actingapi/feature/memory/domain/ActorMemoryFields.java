package com.acttub.actingapi.feature.memory.domain;

import java.util.List;

import com.acttub.actingapi.platform.schema.MemoryField;

/**
 * 배우 기억(유저.md)의 칸 (practice.memory, SOMA-603).
 *
 * <p><b>성별·나이는 여기 없다</b> — 프로필로 옮겼다(account.profile). {@link #NAMES} 순서가 화면이 읽는 순서이고
 * {@code ck_actor_memories_field} 가 최종 방어선이다.
 *
 * <ul>
 *   <li>말투({@code tone})는 코치만 쓴다 — 배우 화면(API 읽기)에 보이지 않고 배우가 쓰지도 않는다.</li>
 *   <li>옛 화법 두 칸은 더는 채우지 않지만, 스토어에 나간 앱이 그 칸을 보여 주므로 읽기·쓰기는 남긴다.</li>
 * </ul>
 */
public final class ActorMemoryFields {

    public static final List<String> NAMES =
            known("goal", "blockage", "wants", "habits", "avoid", "tone", "speech_self", "speech_actual");

    /** 배우가 화면에서 읽고 고치는 칸. */
    public static final List<String> ACTOR_VISIBLE =
            known("goal", "blockage", "wants", "habits", "avoid", "speech_self", "speech_actual");

    /** 기억 갱신(모델)이 쓰는 칸. 다시 말하지 않을 것은 회차가 끝날 때 코드가 덧붙이고, 옛 화법 두 칸은 더 쓰지 않는다. */
    public static final List<String> EXTRACTED = known("goal", "blockage", "wants", "habits", "tone");

    /**
     * DB 값 목록({@link MemoryField}, {@code ck_actor_memories_field})에 있는 칸만 남긴다. 새 칸의 마이그레이션이 아직 없는
     * 배포에서도 같은 코드가 돈다 — 그때는 새 칸을 읽지도 쓰지도 않는다.
     */
    private static List<String> known(String... names) {
        return java.util.Arrays.stream(names)
                .filter(name -> java.util.Arrays.stream(MemoryField.values()).anyMatch(f -> f.dbValue().equals(name)))
                .toList();
    }

    private ActorMemoryFields() {
    }

    public static boolean contains(String field) {
        return NAMES.contains(field);
    }

    public static boolean actorVisible(String field) {
        return ACTOR_VISIBLE.contains(field);
    }
}
