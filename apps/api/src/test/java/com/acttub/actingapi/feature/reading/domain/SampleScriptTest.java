package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 앱 {@code tests/reading-parse.test.mjs} 의 「예시 대본에서 제목·배역·대사를 인식한다」·「배역별 대사 수를 센다」와 같은 기대값. */
class SampleScriptTest {

    @Test
    @DisplayName("SOMA-593 7-2 0번: 줄바꿈·앞뒤 공백만 다른 예시 대본은 예시이고, 한 글자 고치면 예시가 아니다")
    void matchesByNormalizedText() {
        assertThat(SampleScript.matches("  " + SampleScript.TEXT.replace("\n", "\r\n") + "\n\n")).isTrue();
        assertThat(SampleScript.matches(SampleScript.TEXT.replace("고마워.", "고마워!"))).isFalse();
    }

    @Test
    @DisplayName("예시 대본: 제목 「옥상, 밤」, 배역 윤서·태오, 17줄, 첫 줄은 지문, 대사 수 8·7")
    void draftMatchesTheAppParserExpectations() {
        ScriptDraft draft = SampleScript.draft(null, SampleScript.TEXT, "sample");
        assertThat(draft.title()).isEqualTo("옥상, 밤");
        assertThat(draft.characterNames()).containsExactly("윤서", "태오");
        assertThat(draft.lines()).hasSize(17);
        assertThat(draft.lines().get(0).kind()).isEqualTo("direction");
        assertThat(draft.lines().get(1)).isEqualTo(new ScriptDraft.Line(2, "dialogue", 0, "여기 있을 줄 알았어."));
        assertThat(draft.lines().stream().filter(line -> Integer.valueOf(0).equals(line.characterIndex())).count()).isEqualTo(8);
        assertThat(draft.lines().stream().filter(line -> Integer.valueOf(1).equals(line.characterIndex())).count()).isEqualTo(7);
        assertThat(ScriptRules.check(draft)).isNull();
        assertThat(SampleScript.draft("내 제목", SampleScript.TEXT, "paste").title()).isEqualTo("내 제목");
    }
}
