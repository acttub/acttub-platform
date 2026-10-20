package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 목적별 코칭(SOMA-719): 단계표, 버튼 판정, 숨은 칸 걷기, 화면 값. 모델을 부르지 않는다. */
class PurposeLoopTest {
    static final PracticeLoopRouter.Classified ANSWERED = new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, false, "model");

    static PracticeLoopRouter.Classified kind(PracticeLoopRouter.Kind kind) {
        return new PracticeLoopRouter.Classified(kind, false, "model");
    }

    static ObjectNode state(String json) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        try {
            state.set(PurposeLoop.STATE_KEY, StructuredJson.MAPPER.readTree(json));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return state;
    }

    @Test void eachPurposeHasItsOwnSteps() {
        assertThat(PurposeLoop.Purpose.EVALUATE.steps).containsExactly("card", "intent", "method", "wrap");
        assertThat(PurposeLoop.Purpose.STUCK.steps).containsExactly("reason", "line", "seen", "method", "wrap");
        assertThat(PurposeLoop.Purpose.CHARACTER.steps).containsExactly("view", "cell", "wrap");
        assertThat(PurposeLoop.Purpose.of(" stuck ")).isEqualTo(PurposeLoop.Purpose.STUCK);
        assertThat(PurposeLoop.Purpose.of("worry")).isNull();
    }

    @Test void evaluateGoesFromTheCardToFixingTogether() {
        var card = state("{\"step\":0,\"choices\":[{\"label\":\"코치와 같이 고치기\",\"at\":null},{\"label\":\"다른 것도 봐 주세요\",\"at\":null}]}");
        String pressed = PurposeLoop.pressed(card, "코치와 같이 고치기");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, card, "코치와 같이 고치기", pressed, null, 1);
        assertThat(turn.doing()).isEqualTo("intent");
        assertThat(turn.answeredStep()).as("고치기 버튼은 단계 답이 아니다").isNull();

        var another = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, card, "다른 것도 봐 주세요",
                PurposeLoop.pressed(card, "다른 것도 봐 주세요"), null, 1);
        assertThat(another.doing()).isEqualTo("another");
        assertThat(another.step()).isEqualTo("card");
        var used = state("{\"step\":0,\"another\":1,\"choices\":[{\"label\":\"다른 것도 봐 주세요\",\"at\":null}]}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, used, "다른 것도 봐 주세요", "다른 것도 봐 주세요", null, 2).doing())
                .as("다른 곳은 한 번만 더 보여 준다").isEqualTo("intent");
    }

    @Test void aChipMovesOnWithoutTheClassifierAndIsRememberedAsTheStepAnswer() {
        var reason = state("{\"step\":0,\"choices\":[{\"label\":\"감정이 안 따라와요\",\"at\":null},{\"label\":\"잘 모르겠어요\",\"at\":null}]}");
        String pressed = PurposeLoop.pressed(reason, " 감정이 안 따라와요 ");
        assertThat(pressed).isEqualTo("감정이 안 따라와요");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", pressed, null, 1);
        assertThat(turn.doing()).isEqualTo("line");
        assertThat(turn.answeredStep()).isEqualTo("reason");
        assertThat(turn.kindLabel()).isEqualTo("버튼");
        assertThat(PurposeLoop.pressed(reason, "감정이 안 따라와서 답답해요")).as("직접 쓴 말은 버튼이 아니다").isNull();
    }

    @Test void aTimedChipMatchesWithOrWithoutItsTime() {
        var line = state("{\"step\":1,\"choices\":[{\"label\":\"0:12 \\\"취소해\\\"\",\"at\":12}]}");
        assertThat(PurposeLoop.pressed(line, "\"취소해\"")).isEqualTo("0:12 \"취소해\"");
        assertThat(PurposeLoop.pressed(line, "0:12 \"취소해\"")).isEqualTo("0:12 \"취소해\"");
    }

    @Test void namingALineWhileSayingHowItWasStuckSkipsTheLineQuestion() {
        var reason = state("{\"step\":0,\"lines\":[{\"at\":3,\"text\":\"가르쳐 줘\"},{\"at\":12,\"text\":\"취소해\"}]}");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "취소해에서 감정이 안 올라와요", null, ANSWERED, 1);
        assertThat(turn.doing()).isEqualTo("seen");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "그냥 다 어색해요", null, ANSWERED, 1).doing()).isEqualTo("line");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "그 '어여쁘다는 말은 취소해' 부분이요", null, ANSWERED, 1).doing())
                .as("받아 적지 못한 대사라도 배우가 따옴표로 따왔으면 짚은 것이다").isEqualTo("seen");
    }

    @Test void notKnowingIsAskedEasilyThenTheCoachProposesThenItMovesOn() {
        var first = state("{\"step\":2,\"stays\":0}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, first, "잘 모르겠어요", "잘 모르겠어요", null, 3).doing()).isEqualTo("easy");
        var again = state("{\"step\":2,\"stays\":1}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, again, "음", null, kind(PracticeLoopRouter.Kind.SHORT), 4).doing())
                .isEqualTo("propose");
        var stuck = state("{\"step\":2,\"stays\":2}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, stuck, "음", null, kind(PracticeLoopRouter.Kind.SHORT), 5).doing())
                .as("두 번 머물면 다음 단계").isEqualTo("method");
    }

    @Test void questionsAreAnsweredCorrectionsAcceptedMethodRequestsJumpAndStopEnds() {
        var intent = state("{\"step\":1,\"stays\":0}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "왜요?", null, kind(PracticeLoopRouter.Kind.QUESTION), 2).doing())
                .isEqualTo("answer");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "아닌데요", null, kind(PracticeLoopRouter.Kind.CORRECTION), 2).doing())
                .isEqualTo("accept");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "어떻게 해요?", null, kind(PracticeLoopRouter.Kind.METHOD), 2).doing())
                .isEqualTo("method");
        var stop = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "그만", null, kind(PracticeLoopRouter.Kind.STOP), 2);
        assertThat(stop.end()).isTrue();
        assertThat(PurposeLoop.status(stop, "")).contains("할 일: 끝");
    }

    @Test void theReplyCapForcesTheWrap() {
        var intent = state("{\"step\":1}");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "왜요?", null, kind(PracticeLoopRouter.Kind.QUESTION),
                PurposeLoop.REPLY_CAP - 1);
        assertThat(turn.wrap()).isTrue();
        assertThat(PurposeLoop.status(turn, "붙잡듯 말해 봐도 좋아요")).contains("할 일: " + PracticeLoopRouter.WRAP_UP, "다음 테이크: 붙잡듯 말해 봐도 좋아요");
    }

    @Test void characterAsksUpToThreeCellsThenWrapsEarlierWhenTheCardIsFull() {
        var view = state("{\"step\":0,\"cells\":0}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.CHARACTER, view, "망설이는 사람", null, ANSWERED, 1).doing()).isEqualTo("cell");
        var third = state("{\"step\":1,\"cells\":3}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.CHARACTER, third, "엄마", null, ANSWERED, 4).doing()).isEqualTo("wrap");
        var full = new StringBuilder("{\"step\":1,\"cells\":1,\"character_card\":{\"cells\":[");
        for (int i = 0; i < 6; i++) full.append(i == 0 ? "" : ",").append("{\"key\":\"k").append(i).append("\"}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.CHARACTER, state(full + "]}}"), "응", null, ANSWERED, 2).doing())
                .isEqualTo("wrap");
    }

    @Test void hiddenBlocksAreReadAndNeverShown() {
        String raw = """
                "취소해"에선 화내는 사람처럼 들려요. 그때 상대한테 뭘 하고 싶었어요?
                <보기>
                - 0:12 붙잡고 싶었어요
                - 따지고 싶었어요
                - 잘 모르겠어요
                - 직접 쓰기
                - 밀어내고 싶었어요
                - 하나 더
                </보기>
                <장면>헤어지자는 말을 들은 밤 | 헬레네 | 모름</장면>""";
        var out = PurposeLoop.extract(raw);
        assertThat(out.choices()).extracting(PurposeView.Choice::label).containsExactly("붙잡고 싶었어요", "따지고 싶었어요", "밀어내고 싶었어요");
        assertThat(out.choices().getFirst().at()).isEqualTo(12);
        assertThat(out.scene().path("character").asText()).isEqualTo("헬레네");
        assertThat(out.scene().path("partner").asText()).as("모르는 칸은 빈 문자열").isEmpty();
        assertThat(DirectVideoPracticeLoop.parse(raw).message()).isEqualTo("\"취소해\"에선 화내는 사람처럼 들려요. 그때 상대한테 뭘 하고 싶었어요?");
    }

    @Test void theResultCardAndTheCharacterCardAreParsed() {
        var card = PurposeLoop.extract("""
                붙잡는 게 보였어요.
                <카드>
                잘 된 곳: 0:03 "가르쳐 줘"에서 붙잡는 마음이 보여요
                아쉬운 곳: [0:12] "취소해"에서 화내는 쪽으로 들려요
                다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
                </카드>""").card();
        assertThat(card.path("good").path("at").asInt()).isEqualTo(3);
        assertThat(card.path("issue").path("at").asInt()).isEqualTo(12);
        assertThat(card.path("issue").path("text").asText()).isEqualTo("\"취소해\"에서 화내는 쪽으로 들려요");
        assertThat(card.path("next").path("at").isNull()).isTrue();
        assertThat(PurposeLoop.extract("<카드>\n아쉬운 곳: 0:11-0:35 손이 많아요\n</카드>").card().path("issue").path("text").asText())
                .as("구간이면 시작 시간만 쓰고 글에 남기지 않는다").isEqualTo("손이 많아요");

        var person = PurposeLoop.extract("""
                <인물 카드>
                누구: 상처 줄까 봐 망설이는 사람 (내 말)
                바라는 것: 엄마가 먼저 알아채 주기 (같이 찾음)
                막는 것: 없음
                하는 일: 말을 돌려 떠보기
                </인물 카드>""").characterCard();
        assertThat(person.path("cells")).extracting(cell -> cell.path("key").asText()).containsExactly("who", "want", "action");
        assertThat(person.path("cells").get(0).path("source").asText()).isEqualTo("내 말");
        assertThat(person.path("cells").get(2).path("source").asText()).as("출처가 없으면 같이 찾음").isEqualTo("같이 찾음");
    }

    @Test void heardLinesComeFromTheDesignOnlyWhenSpeechWasConfirmed() {
        String design = "대사 확인: 확인됨\n대사 시간: 0:03 \"가르쳐 줘\" / 0:12 \"취소해\" / 1:05 「다신 안 와」";
        assertThat(PurposeLoop.lines(design)).extracting(line -> line.path("at").asInt()).containsExactly(3, 12, 65);
        assertThat(PurposeLoop.lines("대사 확인: 확인 안 됨\n대사 시간: 0:03 \"가르쳐 줘\"")).isEmpty();
        assertThat(PurposeLoop.scene("장면: 헤어지자는 말을 들은 밤 | 모름 | 연인").path("situation").asText()).isEqualTo("헤어지자는 말을 들은 밤");
    }

    @Test void rememberedStateBecomesWhatTheScreenDraws() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        var opening = PurposeLoop.extract("<카드>\n잘 된 곳: 0:03 붙잡는 게 보여요\n아쉬운 곳: 0:12 화내는 쪽으로 들려요\n</카드>");
        PurposeLoop.rememberOpening(state, PurposeLoop.Purpose.EVALUATE, opening,
                "대사 확인: 확인됨\n대사 시간: 0:03 \"가르쳐 줘\"\n장면: 이별 직후 | 헬레네 | 연인");
        var view = PurposeView.from("evaluate", state);
        assertThat(view.step()).isEqualTo("card");
        assertThat(view.choices()).extracting(PurposeView.Choice::label).containsExactly("코치와 같이 고치기", "다른 것도 봐 주세요");
        assertThat(view.card().issue().at()).isEqualTo(12);
        assertThat(view.lines()).containsExactly(new PurposeView.Line(3, "가르쳐 줘"));
        assertThat(view.scene().partner()).isEqualTo("연인");

        var wrap = new PurposeLoop.Turn(PurposeLoop.Purpose.EVALUATE, "wrap", "wrap", true, false, "버튼", true, "method");
        PurposeLoop.remember(state, wrap, PurposeLoop.extract("정리\n<보기>\n남은 버튼\n</보기>"));
        assertThat(PurposeView.from("evaluate", state).choices()).as("정리 뒤에는 버튼이 없다").isEmpty();
        var wrapped = StructuredJson.MAPPER.createObjectNode();
        PurposeLoop.remember(wrapped, wrap, PurposeLoop.extract("정리"), "\"취소해\"에서 붙잡듯 말해 봐도 좋아요");
        assertThat(PurposeView.from("evaluate", wrapped).card().next().text()).as("정리의 행동이 카드의 다음 테이크").isEqualTo("\"취소해\"에서 붙잡듯 말해 봐도 좋아요");
        assertThat(PurposeView.from(null, state)).isNull();
    }

    @Test void aRewrittenCardKeepsEarlierTimesAndTheWrapKeepsTheSpotItFixed() {
        var first = PurposeLoop.card("잘 된 곳: 0:10 웃는 게 보여요\n아쉬운 곳: 0:22 한숨이 준비된 것 같아요\n다음 테이크: 떠올려 봐도 좋아요");
        var another = PurposeLoop.mergeCard(first, PurposeLoop.card("잘 된 곳: 웃는 게 보여요\n아쉬운 곳: 눈을 돌리면 상대가 없어져요"), false);
        assertThat(another.path("good").path("at").asInt()).as("같은 줄은 앞 시간을 살린다").isEqualTo(10);
        assertThat(another.path("issue").path("text").asText()).isEqualTo("눈을 돌리면 상대가 없어져요");
        assertThat(another.path("issue").path("at").isNull()).isTrue();
        var wrapped = PurposeLoop.mergeCard(first, PurposeLoop.card("잘 된 곳: 다르게 쓴 줄\n아쉬운 곳: 다르게 쓴 줄\n다음 테이크: 매달려 봐도 좋아요"), true);
        assertThat(wrapped.path("issue").path("at").asInt()).as("정리는 고친 곳을 바꾸지 않는다").isEqualTo(22);
        assertThat(wrapped.path("next").path("text").asText()).isEqualTo("매달려 봐도 좋아요");
    }

    @Test void stepAnswersAreKeptForTheNextReply() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        PurposeLoop.rememberAnswer(state, "reason", "  감정이  안 따라와요 ");
        var turn = new PurposeLoop.Turn(PurposeLoop.Purpose.STUCK, "line", "line", true, false, "버튼", true, "reason");
        String instruction = PurposeLoop.instruction(turn, state, "감정이 안 따라와요");
        assertThat(instruction).contains("목적: 막힌 곳 풀기", "이번 응답이 하는 단계: 어느 대사인지",
                "배우가 「어떻게 막혔는지」 질문에 한 답: 감정이 안 따라와요", "(버튼을 눌렀다)", "[막힌 곳 풀기의 길]");
    }

    @Test void everyPromptFileThePathsNeedExists() {
        List<String> names = new ArrayList<>(List.of("first-common", "turn"));
        for (var purpose : PurposeLoop.Purpose.values()) {
            names.add(purpose.id + "/first");
            names.add(purpose.id + "/path");
        }
        names.addAll(List.of("common/answer", "common/accept", "common/easy", "common/propose", "common/method",
                "evaluate/intent", "evaluate/another", "evaluate/wrap", "stuck/line", "stuck/seen", "stuck/wrap",
                "character/cell", "character/wrap"));
        for (String name : names) assertThat(DirectVideoPrompts.purposeResource(name)).as(name).isNotBlank();
        for (var purpose : PurposeLoop.Purpose.values()) {
            assertThat(PurposeLoop.firstPrompt(purpose)).startsWith("역할:").contains("<설계>", "</코치>");
        }
    }

    @Test void streamingHidesTheButtonsAndCards() {
        assertThat(VisibleCoachText.visible("어느 대사에서 그랬어요?\n<보기>\n0:12 \"취소해\"", false)).isEqualTo("어느 대사에서 그랬어요?\n");
        assertThat(VisibleCoachText.visible("정리예요.\n<인물 카드>\n누구: 망설이는 사람\n</인물 카드>", false)).isEqualTo("정리예요.\n");
        JsonNode none = null;
        assertThat(PurposeView.from("stuck", none).step()).isEqualTo("reason");
    }
}
