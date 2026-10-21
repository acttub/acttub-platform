package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SpeakerGroupsTest {

    @Test
    @DisplayName("SOMA-709 1번: 기존 배역 이름 여럿으로 된 화자는 함께 말하는 줄의 묶음 배역이 되고, 순서·띄어쓰기·구분 부호만 다른 묶음은 하나다")
    void groupsSpeakersMadeOfOtherCharacters() {
        List<String> names = List.of("지해", "연수", "연희", "썸데이", "이암", "지해, 연수, 연희, 썸데이", "이암, 연수", "순이네", "동진네", "순이네,동진네",
                "동진네, 순이네", "다이애나", "댄", "다이애나/댄", "철수", "영희", "철수와 영희", "영희 & 철수", "엄마들, 앰버", "형사1", "형사2", "형사1·형사2");
        List<String> speakers = new ArrayList<>(names);
        speakers.add("순이네,동진네");
        List<ScriptDraft.Line> lines = new ArrayList<>();
        for (String speaker : speakers) {
            lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", names.indexOf(speaker), "대사 " + speaker));
        }
        lines.add(new ScriptDraft.Line(lines.size() + 1, "direction", null, "암전."));

        ScriptDraft grouped = SpeakerGroups.apply(new ScriptDraft("t", "raw", "paste", names, lines));

        assertThat(grouped.characterNames()).containsExactly("지해", "연수", "연희", "썸데이", "이암", "순이네", "동진네", "다이애나", "댄", "철수", "영희",
                "엄마들, 앰버", "형사1", "형사2", "지해, 연수, 연희, 썸데이", "이암, 연수", "순이네,동진네", "다이애나/댄", "철수와 영희", "형사1·형사2");
        assertThat(grouped.characterMembers()).extracting(members -> members.stream().map(grouped.characterNames()::get).toList()).containsExactly(
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                List.of(), List.of("지해", "연수", "연희", "썸데이"), List.of("연수", "이암"), List.of("순이네", "동진네"), List.of("다이애나", "댄"),
                List.of("철수", "영희"), List.of("형사1", "형사2"));
        assertThat(grouped.lines()).extracting(line -> line.characterIndex() == null ? line.text()
                : grouped.characterNames().get(line.characterIndex()) + "|" + line.text())
                .as("줄은 그대로, 순서만 다른 묶음은 대사가 많은 표기로").contains("순이네,동진네|대사 동진네, 순이네", "철수와 영희|대사 영희 & 철수",
                        "엄마들, 앰버|대사 엄마들, 앰버", "암전.");
    }

    @Test
    @DisplayName("SOMA-709 1번: 「모두」「다 같이」「전원」은 대본의 모든 배역이 함께 말하는 줄이다. 묶을 것이 없으면 그대로 둔다")
    void everyoneSpeaksTogether() {
        List<String> names = List.of("윤서", "모두", "태오", "다 같이");
        List<ScriptDraft.Line> lines = List.of(new ScriptDraft.Line(1, "dialogue", 0, "가자."), new ScriptDraft.Line(2, "dialogue", 1, "와!"),
                new ScriptDraft.Line(3, "dialogue", 2, "응."), new ScriptDraft.Line(4, "dialogue", 3, "만세!"));

        ScriptDraft grouped = SpeakerGroups.apply(new ScriptDraft("t", "raw", "paste", names, lines));

        assertThat(grouped.characterNames()).containsExactly("윤서", "태오", "모두");
        assertThat(grouped.characterMembers().get(2)).containsExactly(0, 1);
        assertThat(grouped.lines()).extracting(ScriptDraft.Line::characterIndex).containsExactly(0, 2, 1, 2);

        ScriptDraft plain = new ScriptDraft("t", "raw", "paste", List.of("윤서", "태오"),
                List.of(new ScriptDraft.Line(1, "dialogue", 0, "가자."), new ScriptDraft.Line(2, "dialogue", 1, "응.")));
        assertThat(SpeakerGroups.apply(plain)).isEqualTo(plain);
    }
}
