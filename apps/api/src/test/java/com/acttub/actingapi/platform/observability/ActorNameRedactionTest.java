package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ActorNameRedactionTest {

    @Test
    @DisplayName("account.profile: 텔레메트리용 입력은 최상위 actor_profile 의 이름만 가리고, 같은 글자가 다른 곳에 있어도 건드리지 않는다")
    void onlyTheProfileNameIsMasked() {
        String input = "{\"actor_profile\":{\"name\":\"하늘\",\"gender\":\"여성\",\"age\":25},"
                + "\"conversation\":[{\"text\":\"하늘을 보며 말해요\"}]}";

        assertThat(ActorNameRedaction.inJson(input)).isEqualTo(
                "{\"actor_profile\":{\"name\":\"[redacted]\",\"gender\":\"여성\",\"age\":25},"
                        + "\"conversation\":[{\"text\":\"하늘을 보며 말해요\"}]}");
    }

    @Test
    @DisplayName("account.profile: 프로필이 없는 입력은 글자 하나 바뀌지 않고, 읽지 못한 입력은 통째로 내보내지 않는다")
    void inputsWithoutAProfileAreUntouchedAndUnreadableOnesAreWithheld() {
        String withoutProfile = "{ \"note_data\" : { \"name\" : \"장면 제목\" } }";

        assertThat(ActorNameRedaction.inJson(withoutProfile)).isSameAs(withoutProfile);
        assertThat(ActorNameRedaction.inJson("- 이름: 하늘 (JSON 이 아니다)")).doesNotContain("하늘");
    }
}
