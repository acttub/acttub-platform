package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LineSpacingTest {

    private static final List<NumberedLine> SENT = List.of(
            new NumberedLine(2, "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?"),
            new NumberedLine(4, "( 암 전 )"),
            new NumberedLine(5, "윤 서\t여 기 있 을 줄 알 았 어 ."));

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 한글 덩이가 넷 이상이고 80% 이상이 한 글자면 띄어진 줄, 둘 이상 모두 한 글자면 짧게 띄어진 줄")
    void judgesSpacedLines() {
        assertThat(LineSpacing.spaced("[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?")).isTrue();
        assertThat(LineSpacing.spaced("네 쪽 세 번 내 쪽 세 번")).isTrue();
        assertThat(LineSpacing.spaced("가 나 다 라 마바")).as("다섯 중 넷이 한 글자 — 80%").isTrue();
        assertThat(LineSpacing.spaced("가 나 다 마바 사아")).as("다섯 중 셋").isFalse();

        assertThat(LineSpacing.spaced("( 암 전 )")).isFalse();
        assertThat(LineSpacing.shortSpaced("( 암 전 )")).isTrue();
        assertThat(LineSpacing.spaced("사 이")).isFalse();
        assertThat(LineSpacing.shortSpaced("사 이")).isTrue();

        assertThat(LineSpacing.spaced("[유세아] 응.")).isFalse();
        assertThat(LineSpacing.shortSpaced("[유세아] 응.")).isFalse();
        assertThat(LineSpacing.spaced("[엄마] 이번엔 시험 잘 봐야지.")).isFalse();
        assertThat(LineSpacing.shortSpaced("[엄마] 이번엔 시험 잘 봐야지.")).isFalse();
        assertThat(LineSpacing.shortSpaced("가")).as("한글 덩이 하나").isFalse();
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 숫자·영문·부호 덩이는 세지 않는다 — 한글 덩이만으로 판정한다")
    void countsOnlyHangulTokens() {
        assertThat(LineSpacing.spaced("S # 3 . 학 교 앞 , 밤")).isTrue();
        assertThat(LineSpacing.spaced("S # 1 . 교 실")).isFalse();
        assertThat(LineSpacing.shortSpaced("S # 1 . 교 실")).isTrue();
        assertThat(LineSpacing.spaced("O K 1 2 3")).isFalse();
        assertThat(LineSpacing.shortSpaced("O K 1 2 3")).isFalse();
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 띄어진 줄이 있으면 그 줄과 짧게 띄어진 줄을 순서대로 보내고, 없으면 아무것도 보내지 않는다")
    void picksLinesToRestore() {
        List<NumberedLine> lines = List.of(
                new NumberedLine(1, "[엄마] 이번엔 시험 잘 봐야지."),
                new NumberedLine(2, "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?"),
                new NumberedLine(3, "[유세아] 응."),
                new NumberedLine(4, "( 암 전 )"));
        assertThat(LineSpacing.toRestore(lines)).containsExactly(
                new NumberedLine(2, "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?"),
                new NumberedLine(4, "( 암 전 )"));

        assertThat(LineSpacing.toRestore(List.of(
                new NumberedLine(1, "[유세아] 응."),
                new NumberedLine(2, "( 암 전 )"),
                new NumberedLine(3, "사 이")))).as("짧게 띄어진 줄만으로는 부르지 않는다").isEmpty();
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 공백만 바뀐 줄만 받는다 — 글자가 바뀐 줄·보내지 않은 번호·빠진 줄·깨진 줄은 버리고, 줄 안의 탭은 남긴다")
    void acceptsOnlyWhitespaceChanges() {
        Map<Integer, String> restored = LineSpacing.parse(String.join("\n",
                "2\t[엄마] 유세아, 공부 열심히 하고 있니?",
                "4\t(암전)  ",
                "5\t윤서\t여기 있을 줄 알았어.",
                "9\t(암전)",
                "고친 줄입니다",
                "",
                "x\t(암전)"), SENT);

        assertThat(restored).containsExactly(
                Map.entry(4, "(암전)"),
                Map.entry(5, "윤서\t여기 있을 줄 알았어."));
        assertThat(LineSpacing.parse("2\t[엄마] 유세아, 공부 열심히 하고 있지?\r", SENT))
                .containsExactly(Map.entry(2, "[엄마] 유세아, 공부 열심히 하고 있지?"));
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 받은 줄만 바꾸고 나머지는 원문 그대로 둔다")
    void appliesRestoredLines() {
        List<NumberedLine> lines = List.of(
                new NumberedLine(1, "[엄마] 이번엔 시험 잘 봐야지."),
                new NumberedLine(2, "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?"),
                new NumberedLine(4, "( 암 전 )"));

        assertThat(LineSpacing.apply(lines, Map.of(2, "[엄마] 유세아, 공부 열심히 하고 있지?"))).containsExactly(
                new NumberedLine(1, "[엄마] 이번엔 시험 잘 봐야지."),
                new NumberedLine(2, "[엄마] 유세아, 공부 열심히 하고 있지?"),
                new NumberedLine(4, "( 암 전 )"));
    }
}
