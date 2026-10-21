package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ScriptRulesTest {

    @Test
    @DisplayName("SOMA-709: 배역 수 한도는 없다 — 배역 120명도 통과")
    void noCharacterLimit() {
        List<String> names = new ArrayList<>(IntStream.rangeClosed(1, 120).mapToObj(n -> "배역" + n).toList());
        assertThat(ScriptRules.check(draft(names))).isNull();
    }

    @Test
    @DisplayName("SOMA-663: 함께 말하기 이름 — 이은 배역과 모두·다 같이·전원·일동·합창·코러스는 낱말일 때만")
    void groupName() {
        assertThat(List.of("모두", "다같이", "다 같이", "전원", "학생 일동", "모두(합창)", "코러스", "ALL", "A, B", "나봉/오봉", "철수·영희", "Tom & Jerry"))
                .allMatch(ScriptRules::isGroupName);
        assertThat(List.of("전원주", "모두리", "일동이", "합창단장", "철수", "Allen", "할머니")).noneMatch(ScriptRules::isGroupName);
    }

    private static ScriptDraft draft(List<String> names) {
        return new ScriptDraft("제목", "원문", "paste", names, List.of());
    }
}
