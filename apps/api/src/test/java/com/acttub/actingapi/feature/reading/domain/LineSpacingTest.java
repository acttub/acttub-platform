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
    @DisplayName("reading.script 띄어쓰기 복원: 한글 음절이 여덟 개 이상 붙은 덩이가 있으면 덜 띄어진 줄 — 영문·숫자는 세지 않는다")
    void judgesJoinedLines() {
        assertThat(LineSpacing.joined("칼군무로장비를챙겨퇴장한다.")).isTrue();
        assertThat(LineSpacing.joined("[쥬부인] 우리들의조상도지극히 평범한 평민계급이었다는걸")).as("「우리들의조상도지극히」").isTrue();
        assertThat(LineSpacing.joined("감사합니다.그럼전가봐야")).as("부호를 사이에 둬도 한 덩이의 음절을 다 센다").isTrue();

        assertThat(LineSpacing.joined("가나다라마바사")).as("일곱 음절").isFalse();
        assertThat(LineSpacing.joined("Welcome to Christopher's 2000000 theater")).isFalse();
        assertThat(LineSpacing.joined("[엄마] 이번엔 시험 잘 봐야지.")).isFalse();
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

        assertThat(LineSpacing.toRestore(List.of(
                new NumberedLine(1, "[유세아] 응."),
                new NumberedLine(2, "[엄마] 언제 돌아가실지모르겠지만그래도"),
                new NumberedLine(3, "( 암 전 )")))).as("덜 띄어진 줄은 띄어진 줄 없이도 혼자 보낸다 — 짧게 띄어진 줄은 여전히 따라가지 않는다")
                .containsExactly(new NumberedLine(2, "[엄마] 언제 돌아가실지모르겠지만그래도"));
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 보낸 번호의 줄만 받고 첫 탭에서만 가른다 — 줄 안의 탭은 남고, 모르는 번호·빠진 줄·깨진 줄은 없다")
    void readsNumberedAnswerLines() {
        Map<Integer, String> restored = LineSpacing.parse(String.join("\n",
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
        assertThat(LineSpacing.parse("4<TAB>(암전)", SENT)).as("「<TAB>」을 글자 그대로 쓴 답(SOMA-663 M1)").containsExactly(Map.entry(4, "(암전)"));
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 모델이 글자를 바꾸거나 더하거나 빼도 글자는 원문 그대로 두고 답의 띄어쓰기만 옮긴다")
    void projectsAnswerSpacingOntoOriginalLetters() {
        List<NumberedLine> sent = List.of(
                new NumberedLine(1, "아 니 , 괜 찮 아 요 . 그 런 거 에 요 ."),
                new NumberedLine(2, "그 는 천 천 히 의 자 에 앉 는 다"),
                new NumberedLine(3, "그 는 관 객 석 에 앉 는 다"),
                new NumberedLine(4, "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?"));

        Map<Integer, String> restored = LineSpacing.parse(String.join("\n",
                "1\t아니, 괜찮아요. 그런 거예요.",
                "2\t그는 , 천천히 의자에 앉는다.",
                "3\t그는 객석에 앉는다",
                "4\t[엄마]  유세아, 공부 열심히 하고 있니?"), sent);

        assertThat(restored).containsExactly(
                Map.entry(1, "아니, 괜찮아요. 그런 거에요."),
                Map.entry(2, "그는 천천히 의자에 앉는다"),
                Map.entry(3, "그는 관객석에 앉는다"),
                Map.entry(4, "[엄마]  유세아, 공부 열심히 하고 있지?"));
        for (NumberedLine line : sent) {
            assertThat(restored.get(line.no()).replaceAll("\\s", "")).as("글자는 원문 그대로")
                    .isEqualTo(line.text().replaceAll("\\s", ""));
        }
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 글자가 20% 넘게 다른 답(다른 줄의 글)은 버린다")
    void rejectsAnswersForAnotherLine() {
        List<NumberedLine> sent = List.of(
                new NumberedLine(1, "아 니 , 괜 찮 아 요 . 그 런 거 에 요 ."),
                new NumberedLine(2, "( 암 전 )"));

        assertThat(LineSpacing.parse(String.join("\n",
                "1\t[엄마] 유세아, 공부 열심히 하고 있지?",
                "2\t(암전)"), sent)).containsExactly(Map.entry(2, "(암전)"));
        assertThat(LineSpacing.parse("2\t", sent)).as("빈 답").isEmpty();
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
