package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ScriptRulesTest {

    @Test
    @DisplayName("SOMA-663: 배역 50명 한도는 함께 말하기 이름을 세지 않는다 — 50명 + 함께 말하기 3개는 통과, 51명이면 script_too_long")
    void groupNamesDoNotCountTowardTheLimit() {
        List<String> people = IntStream.rangeClosed(1, ScriptRules.CHARACTERS_MAX).mapToObj(n -> "배역" + n).toList();
        List<String> names = new ArrayList<>(people);
        names.addAll(List.of("모두", "배역1, 배역2", "학생들 일동"));
        assertThat(ScriptRules.check(draft(names))).isNull();

        names.add("배역51");
        assertThat(ScriptRules.check(draft(names))).isEqualTo(ScriptRules.Rejection.TOO_LONG);
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
