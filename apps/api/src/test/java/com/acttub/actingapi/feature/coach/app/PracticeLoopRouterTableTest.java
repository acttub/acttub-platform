package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Locale;

import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Before;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Classified;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Kind;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Tally;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 연습 루프의 할 일 표: 분류 읽기, 상태 칸에서 흐름 다시 세기, 할 일 고르기, 다음 상태 칸 쓰기. */
class PracticeLoopRouterTableTest {
    static Before at(int stage, String lastDoing) {
        return new Before(5, lastDoing, null, new Tally(0, 0, 0), List.of(), false, false, false, false, stage);
    }

    static Classified answer(boolean decided, String respond, boolean want) {
        return new Classified(Kind.ANSWER, false, "model", respond, decided, false).with(want, false);
    }

    @Test void classificationOutputMustBeTheKnownSignalList() {
        assertThatThrownBy(() -> PracticeLoopRouter.parse("[]")).hasMessage("JSON output must be an object");
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":\"answered\"}")).hasMessage("invalid practice loop classification");
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[1]}")).hasMessage("unknown practice loop classification");
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[]}")).hasMessage("empty practice loop classification");
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"want\",\"ack\"]}")).hasMessage("empty practice loop classification");
    }

    @Test void respondSignalsArePrioritisedAndTheFirstStepWins() {
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"question\",\"correction\"]}").kind()).isEqualTo(Kind.CORRECTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"correction\",\"question\"]}").kind()).isEqualTo(Kind.CORRECTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"missed\",\"answered\"]}").kind()).isEqualTo(Kind.MISSED);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"question\"]}").kind()).isEqualTo(Kind.QUESTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"evaluation\"]}").kind()).isEqualTo(Kind.EVALUATION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"method\"]}").kind()).isEqualTo(Kind.METHOD);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\"]}").kind()).isEqualTo(Kind.SHORT);
        Classified answered = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"want\",\"line_fix\",\"decided\"]}");
        assertThat(answered.kind()).isEqualTo(Kind.ANSWER);
        assertThat(answered.want()).isTrue();
        assertThat(answered.lineFix()).isTrue();
        assertThat(answered.decided()).isTrue();
        assertThat(answered.respond()).isEmpty();
    }

    @Test void kindLabelsAreMatchedLongestFirst() {
        assertThat(Kind.ofLabel(null)).isNull();
        assertThat(Kind.ofLabel(" ")).isNull();
        assertThat(Kind.ofLabel("선택 설명")).isEqualTo(Kind.CHOICE);
        assertThat(Kind.ofLabel("답")).isEqualTo(Kind.ANSWER);
        assertThat(Kind.ofLabel("모름")).isNull();
    }

    ObjectNode loop(String... statuses) {
        ObjectNode loop = StructuredJson.MAPPER.createObjectNode();
        var array = loop.putArray("statuses");
        for (String status : statuses) array.add(status);
        return loop;
    }

    @Test void theFlowIsRecountedFromStoredStatusLines() {
        JsonNode loop = loop("할 일: 비추기\n배우의 말: 답", "할 일: 방법 주기\n배우의 말: 선택 설명\n지키기: 예\n피할 것: 웃음, 시선 / 손 · 고개");
        Before b = PracticeLoopRouter.before(loop, 2);
        assertThat(b.reply()).isEqualTo(3);
        assertThat(b.lastDoing()).isEqualTo("방법 주기");
        assertThat(b.lastKind()).isEqualTo(Kind.CHOICE);
        assertThat(b.tally()).isEqualTo(new Tally(1, 0, 1));
        assertThat(b.choiceExplained()).isTrue();
        assertThat(b.keep()).isTrue();
        assertThat(b.avoid()).containsExactly("웃음", "시선", "손", "고개");
        assertThat(b.stage()).isEqualTo(2);

        Before none = PracticeLoopRouter.before(null, 2);
        assertThat(none.lastDoing()).isEqualTo("비추기");
        assertThat(PracticeLoopRouter.before(StructuredJson.MAPPER.createObjectNode().put("statuses", "x"), 1).lastDoing()).isEqualTo("비추기");
        assertThat(PracticeLoopRouter.stayed(null, 3)).isZero();
        assertThat(PracticeLoopRouter.answers(null, 2)).isEmpty();
        assertThat(PracticeLoopRouter.latestWant(null, 2)).isEmpty();
        assertThat(PracticeLoopRouter.lineFixed(null, 2)).isFalse();
        assertThat(PracticeLoopRouter.latestWant(StructuredJson.MAPPER.createObjectNode().put("statuses", "x"), 1)).isEmpty();
        assertThat(PracticeLoopRouter.lineFixed(StructuredJson.MAPPER.createObjectNode().put("statuses", "x"), 1)).isFalse();
        assertThat(PracticeLoopRouter.answers(StructuredJson.MAPPER.createObjectNode().put("statuses", "x"), 1)).isEmpty();
    }

    @Test void afterAProposalTheConversationMovesOnUnlessTheActorObjected() {
        Before proposed = at(3, PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.ANSWER, proposed)).isEqualTo(PracticeLoopRouter.FIND);
        assertThat(PracticeLoopRouter.route(Kind.CORRECTION, proposed)).isEqualTo("내려놓기");
        assertThat(PracticeLoopRouter.route(Kind.METHOD, proposed)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(Kind.ANSWER, at(3, "마무리2"))).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.route(Kind.ANSWER, at(3, "끝"))).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void stayingTooLongOnAStepMakesTheCoachPropose() {
        assertThat(PracticeLoopRouter.route(Kind.MISSED, at(2, "다시 묻기"), 2)).isEqualTo(PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, at(2, "다시 묻기"), 2)).isEqualTo(PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.QUESTION, at(2, "다시 묻기"), 2)).isEqualTo("답하기");
    }

    @Test void anUndecidedFinalAnswerStaysUntilAnActionIsChosen() {
        Before find = at(4, PracticeLoopRouter.FIND);
        assertThat(PracticeLoopRouter.route(answer(false, "evaluation", false), find, 0)).isEqualTo("짚어주기");
        assertThat(PracticeLoopRouter.route(answer(false, "question", false), find, 0)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.route(answer(false, "method", false), find, 0)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(false, "", true), find, 0)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(false, "", true), find, 1)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(false, "", false), find, 0)).isEqualTo(PracticeLoopRouter.REASK);
        assertThat(PracticeLoopRouter.route(answer(false, "", false), find, 1)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(false, "", false), find, 2)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(true, "", false), find, 0)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(answer(false, "", false), find, 0, CoachFlows.B)).isEqualTo(PracticeLoopRouter.REASK);
    }

    @Test void stagesAndGoalsFollowTheTask() {
        Before second = at(2, "비추기");
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.WANT, at(1, "비추기"))).isEqualTo(2);
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.EASY, at(3, "비추기"))).isEqualTo(3);
        assertThat(PracticeLoopRouter.easyGoal(at(3, "비추기"))).isEqualTo("그 버릇이 인물이 바라는 것을 돕는지, 가리는지");
        assertThat(PracticeLoopRouter.easyGoal(at(5, "비추기"))).isEqualTo("그 버릇 대신 무엇으로 그걸 상대에게 전할 수 있을지");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.WANT, second)).isEqualTo("1/4 첫 질문 — 근본 문제를 풀 실마리를 배우 입에서 듣는다");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.EASY, at(4, "비추기"))).startsWith("3/4 스스로 찾기");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.GAP, second, CoachFlows.B))
                .isEqualTo("2/4 코치가 본 것 — 근본 문제를 대사 두 곳과 이유로 코치가 먼저 말한다. 해결책은 아직 말하지 않는다");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.WRAP_UP, second, CoachFlows.B))
                .isEqualTo("4/4 정리 — 배우가 말한 바람을 얻을 행동 하나를 코치가 제안해 확정한다");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.WANT, second, CoachFlows.B)).startsWith("1/4 첫 질문");
        assertThat(PracticeLoopRouter.answerField(Kind.CHOICE, at(3, "비추기"))).isEqualTo("알아챈 것");
        assertThat(PracticeLoopRouter.answerField(Kind.QUESTION, at(3, "비추기"))).isNull();
    }

    @Test void correctionsAddTheCurrentHabitToTheAvoidList() {
        Before b = new Before(3, "비추기", null, new Tally(0, 0, 0), List.of("웃음"), false, false, false, false, 2);
        assertThat(PracticeLoopRouter.avoidAfter(b, Kind.CORRECTION, " 시선 ")).containsExactly("웃음", "시선");
        assertThat(PracticeLoopRouter.avoidAfter(b, Kind.PUSHBACK, " ")).containsExactly("웃음");
        assertThat(PracticeLoopRouter.avoidAfter(b, Kind.ANSWER, "시선")).containsExactly("웃음");
    }

    @Test void theInstructionIsWrittenInTheActorsLanguage() {
        String english = PracticeLoopRouter.instruction(Locale.ENGLISH, "답하기", List.of("smile"), "", "",
                "- 답하기: Answer first.\n  Keep it short.\n", "2/4 gap", List.of("first answer: stay"));
        assertThat(english).isEqualTo("[This reply]\nCurrent step: 2/4 gap\nAnswer first.\nKeep it short.\n\nMaterial\n- first answer: stay\nDo not bring up again: smile");
        assertThat(PracticeLoopRouter.instruction(null, "답하기", List.of(), "e1", "가지 마", "- 답하기:\n먼저 답한다", " ", List.of()))
                .isEqualTo("[이번 응답]\n먼저 답한다\n관찰 근거: e1\n대사 확인: 가지 마");
    }

    @Test void theStatusLineRecordsWhatTheActorSaidAndWhatWasDecided() {
        Classified c = new Classified(Kind.ANSWER, true, "model", "", true, false).with(true, true);
        String status = PracticeLoopRouter.status("", "", c, at(4, PracticeLoopRouter.FIND), PracticeLoopRouter.WRAP_UP, " ",
                List.of("웃음"), "끝을 짧게", false, "  위로받고   싶어 ");
        assertThat(status).isEqualTo(String.join("\n",
                "배우의 말: 답",
                "지금까지: 같은 버릇 질문 0번 · 짚어주기 0번 · 방법 주기 0번 · 응답 5번째",
                "이번 목표: 없음",
                "피할 것: 웃음",
                "할 일: 정리하기",
                "다음 테이크: 끝을 짧게",
                "지키기: 예",
                "단계: 4",
                "찾은 대안: 위로받고 싶어",
                "최신 바람: 위로받고 싶어",
                "대사 정정: 예",
                "분류: model"));
        String undecided = PracticeLoopRouter.status("", "", answer(false, "", true), at(4, PracticeLoopRouter.FIND), PracticeLoopRouter.REASK,
                "목표", List.of(), null, false, " ");
        assertThat(undecided).doesNotContain("찾은 대안", "최신 바람").contains("다음 테이크: 없음");
    }

    @Test void afterAResumeTheFirstActorLineIsTreatedLikeTheLineAfterAWrapNotAnImmediateEnd() {
        var loop = StructuredJson.MAPPER.createObjectNode();
        loop.putArray("statuses").add("비추기").add("끝");
        assertThat(PracticeLoopRouter.before(loop, 2).lastDoing()).isEqualTo("끝");
        loop.put(PracticeLoopRouter.RESUMED_AT, 2);
        assertThat(PracticeLoopRouter.before(loop, 2).lastDoing()).isEqualTo(PracticeLoopRouter.WRAP_UP);
        // 이어 간 응답이 하나 더 쌓이면 표시는 더 이상 먹지 않는다.
        loop.withArray("statuses").add("끝");
        assertThat(PracticeLoopRouter.before(loop, 3).lastDoing()).isEqualTo("끝");
    }
}
