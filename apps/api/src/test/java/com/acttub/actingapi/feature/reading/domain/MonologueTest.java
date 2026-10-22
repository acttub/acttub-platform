package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MonologueTest {

    @Test
    @DisplayName("SOMA-597: 문장 끝 부호 뒤 공백에서 끊는다 — 닫는 따옴표는 앞 문장에, 괄호 안은 끊지 않고, 끝 부호가 없으면 그대로 하나")
    void splitsSentences() {
        assertThat(Monologue.sentences("그래서 더 말하기 싫었어. 네가 그걸 아니까. 나도 알아…  그래서 더 아팠어?! 정말."))
                .containsExactly("그래서 더 말하기 싫었어.", "네가 그걸 아니까.", "나도 알아…", "그래서 더 아팠어?!", "정말.");
        assertThat(Monologue.sentences("(웃으며. 천천히) 그래. “괜찮아.” 그 말만 했어."))
                .containsExactly("(웃으며. 천천히) 그래.", "“괜찮아.”", "그 말만 했어.");
        assertThat(Monologue.sentences("끝 부호 없이 이어지는 말")).containsExactly("끝 부호 없이 이어지는 말");
        assertThat(Monologue.sentences("마지막에 공백만 있다. ")).containsExactly("마지막에 공백만 있다. ");
        assertThat(Monologue.sentences("3.5초를 기다렸어.")).containsExactly("3.5초를 기다렸어.");
    }

    @Test
    @DisplayName("SOMA-597: 배역이 하나뿐인 대본은 대사 줄을 문장마다 한 줄로 나누고 줄 번호를 다시 매긴다. 지문·장면은 그대로, 원문에 없는 「화자」만 이름 없음으로 표시한다")
    void splitsAMonologue() {
        ScriptDraft draft = new ScriptDraft("독백", "원문", "paste", List.of("민지"), List.of(
                new ScriptDraft.Line(1, "direction", null, "(옥상 난간.)"),
                new ScriptDraft.Line(2, "dialogue", 0, "그래서 더 말하기 싫었어. 네가 그걸 아니까."),
                new ScriptDraft.Line(3, "dialogue", 0, "나도 내가 얼마나 준비했는지 알아.")));

        ScriptDraft split = Monologue.split(draft);

        assertThat(split.lines()).extracting(line -> line.ordinal() + "|" + line.kind() + "|" + line.characterIndex() + "|" + line.text())
                .containsExactly("1|direction|null|(옥상 난간.)", "2|dialogue|0|그래서 더 말하기 싫었어.", "3|dialogue|0|네가 그걸 아니까.",
                        "4|dialogue|0|나도 내가 얼마나 준비했는지 알아.");
        assertThat(split.unnamedCast()).as("원문에서 읽은 이름").isFalse();
        assertThat(Monologue.split(new ScriptDraft("독백", "그래서 더 말하기 싫었어.", "paste", List.of("화자"), draft.lines())).unnamedCast())
                .as("원문에 없는 임시 이름").isTrue();
        assertThat(Monologue.split(new ScriptDraft("독백", "화자: 그래서 더 말하기 싫었어.", "paste", List.of("화자"), draft.lines())).unnamedCast())
                .as("원문이 「화자」라고 쓴 배역").isFalse();
    }

    @Test
    @DisplayName("SOMA-663: 배역이 둘 이상인 대화 대본은 한 배역의 긴 대사를 나누지 않는다")
    void leavesDialoguesWhole() {
        ScriptDraft draft = new ScriptDraft("대화", "원문", "paste", List.of("이영", "태오"), List.of(
                new ScriptDraft.Line(1, "dialogue", 0, "안녕하세요. 저는 이영입니다. 만나서 반갑습니다."),
                new ScriptDraft.Line(2, "dialogue", 1, "네.")));

        assertThat(Monologue.split(draft)).isSameAs(draft);
    }
}
