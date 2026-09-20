package com.acttub.actingapi.platform.observability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 텔레메트리로 나가는 모델 입력에서 배우의 이름을 가린다 (apps/api/CONTRACT.md §7-2).
 *
 * <p>코치 대화와 노트의 모델 입력에는 배우가 저장한 프로필이 실린다. 모델에는 그대로 보내지만, 같은 입력을
 * 바깥 수탁사(Langfuse)에 기록할 때는 <b>이름만</b> 가린다 — 탈퇴는 이름을 지체 없이 파기하는데, 거기 남은
 * 기록은 서버가 지울 수 없다. 성별·만 나이·방향·경력·목표는 남긴다: 이름 없이는 사람을 가리키지 못하고,
 * 기록을 읽는 사람이 입력의 맥락을 알 수 있어야 한다.
 *
 * <p>프로필이 실린 호출에만 부른다. 프로필이 없는 호출의 기록은 글자 하나 바뀌지 않는다.
 */
public final class ActorNameRedaction {

    /** 이름이 있던 자리에 싣는다. */
    public static final String MASK = "[redacted]";

    private static final ObjectMapper JSON = new ObjectMapper();

    private ActorNameRedaction() {
    }

    /**
     * JSON 입력의 최상위 {@code actor_profile.name} 을 가린다. 그런 키가 없으면 받은 그대로다.
     *
     * <p>읽지 못하면 <b>입력을 통째로 내보내지 않는다</b> — 프로필이 실린 호출인데 어디에 이름이 있는지 모르는
     * 채로 보낼 수는 없다.
     */
    public static String inJson(String input) {
        JsonNode parsed;
        try {
            parsed = JSON.readTree(input);
        } catch (Exception unreadable) {
            return "[input withheld: the actor profile could not be redacted]";
        }
        if (!(parsed.path("actor_profile") instanceof ObjectNode profile) || !profile.has("name")) {
            return input;
        }
        profile.put("name", MASK);
        return parsed.toString();
    }
}
