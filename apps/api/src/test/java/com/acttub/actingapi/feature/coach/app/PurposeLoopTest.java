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
        assertThat(PurposeLoop.Purpose.EVALUATE.steps).containsExactly("card", "method", "wrap");
        assertThat(PurposeLoop.Purpose.STUCK.steps).containsExactly("reason", "line", "seen", "method", "wrap");
        assertThat(PurposeLoop.Purpose.CHARACTER.steps).containsExactly("view", "cell", "wrap");
        assertThat(PurposeLoop.Purpose.of(" stuck ")).isEqualTo(PurposeLoop.Purpose.STUCK);
        assertThat(PurposeLoop.Purpose.of("worry")).isNull();
    }

    /** 리딩 녹음 코칭(SOMA-791): 들린 것 → 해 볼 것 → 정리. 정리 뒤 물음에는 정리를 다시 하지 않고 답한다. */
    @Test void readingStartsShortAndMovesToTryThenWrap() {
        assertThat(PurposeLoop.Purpose.READING.steps).containsExactly("hear", "try", "wrap");
        assertThat(PurposeLoop.Purpose.of("reading")).isEqualTo(PurposeLoop.Purpose.READING);
        assertThat(PurposeLoop.Purpose.of("talk:reading")).as("리딩 녹음은 말로 하는 갈래가 아니다").isNull();
        var heard = state("{\"step\":0,\"questions\":1,\"choices\":[{\"label\":\"남아 줄게\",\"at\":null}]}");
        var tried = PurposeLoop.decide(PurposeLoop.Purpose.READING, heard, "남아 줄게", PurposeLoop.pressed(heard, "남아 줄게"), null, 1);
        assertThat(tried.doing()).isEqualTo("try");
        assertThat(tried.answeredStep()).isEqualTo("hear");
        var trying = state("{\"step\":1,\"questions\":2}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.READING, trying, "달래면서요", null, ANSWERED, 2).wrap()).isTrue();
        var wrapped = state("{\"step\":2,\"questions\":2}");
        var asked = PurposeLoop.decide(PurposeLoop.Purpose.READING, wrapped, "예시로 읽어줄 수 있어요?", null,
                kind(PracticeLoopRouter.Kind.QUESTION), 3);
        assertThat(asked.doing()).isEqualTo("answer");
        assertThat(PurposeLoop.answersAfterWrap(asked)).isTrue();
        assertThat(PurposeLoop.firstPrompt(PurposeLoop.Purpose.READING)).contains("[리딩 녹음으로 하는 코칭]")
                .doesNotContain("[영상 없이 말로 하는 코칭]");
    }

    /** 10/27 dev 실제 녹음: 두 문장짜리 대사의 앞 문장과 여는 따옴표가 빠진 다음 테이크를 대본 줄 그대로 되살린다. */
    @Test void aReadingTakeIsRestoredToTheWholeScriptLine() {
        String material = "[리딩 녹음]\n[소리 안 줄별 시간]\n- 녹음 1: 0:00~0:03 \"안녕.\"\n"
                + "- 녹음 2: 0:04~0:09 \"그래서 더 말하기 싫었어. 네가 그걸 아니까.\"\n[서버가 잰 소리]\n";
        assertThat(PurposeLoop.readingTake("네가 그걸 아니까.\"에서 윤서가 걱정하지 않게 달래며 말해 봐도 좋아요", material))
                .isEqualTo("\"그래서 더 말하기 싫었어. 네가 그걸 아니까.\"에서 윤서가 걱정하지 않게 달래며 말해 봐도 좋아요");
        assertThat(PurposeLoop.readingTake("“그래서 더\n말하기 싫었어. 네가 그걸 아니까.”에서 달래기", material))
                .isEqualTo("\"그래서 더 말하기 싫었어. 네가 그걸 아니까.\"에서 달래기");
        assertThat(PurposeLoop.readingTake("상대를 보며 말해 봐도 좋아요", material)).as("대본 줄과 안 겹치면 그대로")
                .isEqualTo("상대를 보며 말해 봐도 좋아요");
    }

    @Test void evaluateGoesFromTheCardToFixingTogether() {
        var card = state("{\"step\":0,\"choices\":[{\"label\":\"코치와 같이 고치기\",\"at\":null},{\"label\":\"다른 것도 봐 주세요\",\"at\":null}]}");
        String pressed = PurposeLoop.pressed(card, "코치와 같이 고치기");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, card, "코치와 같이 고치기", pressed, null, 1);
        assertThat(turn.doing()).as("평가는 의도를 캐묻지 않고 바로 방법").isEqualTo("method");
        assertThat(turn.answeredStep()).as("고치기 버튼은 단계 답이 아니다").isNull();

        var another = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, card, "다른 것도 봐 주세요",
                PurposeLoop.pressed(card, "다른 것도 봐 주세요"), null, 1);
        assertThat(another.doing()).isEqualTo("another");
        assertThat(another.step()).isEqualTo("card");
        var used = state("{\"step\":0,\"another\":1,\"choices\":[{\"label\":\"다른 것도 봐 주세요\",\"at\":null}]}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, used, "다른 것도 봐 주세요", "다른 것도 봐 주세요", null, 2).doing())
                .as("다른 곳은 한 번만 더 보여 준다").isEqualTo("method");
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
        var near = state("{\"step\":0,\"lines\":[{\"at\":49,\"text\":\"좀 가르쳐 줘\"}]}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, near, "가르쳐 줘 비결이 뭐야 여기가 안돼요", null, ANSWERED, 1).doing())
                .as("받아 적은 대사와 조금 달라도 겹치면 짚은 것").isEqualTo("seen");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "그 '어여쁘다는 말은 취소해' 부분이요", null, ANSWERED, 1).doing())
                .as("받아 적지 못한 대사라도 배우가 따옴표로 따왔으면 짚은 것이다").isEqualTo("seen");
    }

    @Test void notKnowingIsAskedEasilyThenTheCoachProposesThenItMovesOn() {
        var first = state("{\"step\":2,\"stays\":0}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, first, "잘 모르겠어요", "잘 모르겠어요", null, 3).doing())
                .as("모르겠다 버튼은 바로 코치 생각을 내놓는다").isEqualTo("propose");
        var twice = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, state("{\"step\":2,\"stays\":1,\"dont_knows\":1}"), "잘 모르겠어요", "잘 모르겠어요", null, 4);
        assertThat(twice.wrap()).as("대화에서 두 번째 모르겠다면 더 묻지 않고 코치가 정해 준다").isTrue();
        assertThat(twice.direct()).isTrue();
        assertThat(PurposeLoop.instruction(twice, state("{}"), "잘 모르겠어요")).contains("더 묻지 않는다");
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
        var method = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "그래서 어떻게 해요?", null, kind(PracticeLoopRouter.Kind.METHOD), 2);
        assertThat(method.wrap() && method.direct()).as("방법을 달라면 바로 코치가 정해 준다").isTrue();
        var stop = PurposeLoop.decide(PurposeLoop.Purpose.EVALUATE, intent, "그만", null, kind(PracticeLoopRouter.Kind.STOP), 2);
        assertThat(stop.end()).isTrue();
        assertThat(PurposeLoop.status(stop, "")).contains("할 일: 끝");
    }

    @Test void aQuestionAskedAlongWithAnAnswerIsAnsweredFirst() {
        var asked = new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, false, "model", "question");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, state("{\"step\":2}"), "알려 주려고요. 근데 왜요?", null, asked, 3);
        assertThat(turn.doing()).isEqualTo("method");
        assertThat(turn.asked()).isTrue();
        assertThat(PurposeLoop.instruction(turn, state("{\"step\":2}"), "알려 주려고요. 근데 왜요?")).contains("그 물음에 먼저");
    }

    @Test void stuckAndCharacterAskAtMostTwiceThenTheCoachDecides() {
        var asked2 = state("{\"step\":1,\"questions\":2}");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, asked2, "0:12 \"취소해\"", null, ANSWERED, 2);
        assertThat(turn.wrap() && turn.direct()).isTrue();
        var why = PurposeLoop.decide(PurposeLoop.Purpose.CHARACTER, state("{\"step\":1,\"questions\":2}"), "왜요?", null, kind(PracticeLoopRouter.Kind.QUESTION), 2);
        assertThat(why.wrap() && why.asked()).as("물음엔 정리 첫 문장에서 답한다").isTrue();
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, state("{\"step\":0,\"questions\":1}"), "감정이 안 따라와요", null, ANSWERED, 1).doing())
                .isEqualTo("line");
        assertThat(PurposeLoop.asksNothing(PurposeLoop.Purpose.EVALUATE)).isTrue();
    }

    @Test void anActorQuestionTheClassifierMissedIsStillAnsweredFirst() {
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, state("{\"step\":1,\"questions\":1}"), "그게 무슨 뜻이에요", null, ANSWERED, 2);
        assertThat(turn.asked()).isTrue();
        assertThat(PurposeLoop.asksSomething("그냥 알려주려고요")).isFalse();
        for (String q : List.of("왜요", "그게 무슨 뜻이죠", "뭔 뜻인지", "그래서 어떻게 해요", "어떻게 하는 건데", "어케 하라는", "이거 맞아?", "왜 그래야 돼"))
            assertThat(PurposeLoop.asksSomething(q)).as(q).isTrue();
        assertThat(PurposeLoop.asksSomething(null)).isFalse();
        var stayedTwice = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, state("{\"step\":1,\"stays\":2}"), "왜요", null,
                kind(PracticeLoopRouter.Kind.QUESTION), 2);
        assertThat(stayedTwice.advanced() && stayedTwice.asked()).as("두 번 머물러 넘어가도 물음엔 먼저 답한다").isTrue();
        var cell = new PurposeLoop.Turn(PurposeLoop.Purpose.CHARACTER, "cell", "cell", true, false, "답", false, "view");
        assertThat(PurposeLoop.instruction(cell, state("{}"), "엄마요")).doesNotContain("(영상)으로 채운다");
        var wrap = new PurposeLoop.Turn(PurposeLoop.Purpose.CHARACTER, "wrap", "wrap", true, false, "답", false, "cell");
        assertThat(PurposeLoop.instruction(wrap, state("{}"), "엄마요")).contains("(영상)으로 채운다", "다른 가능성");
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
        var wrapped = PurposeLoop.mergeCard(first, PurposeLoop.card("잘 된 곳: 다르게 쓴 줄\n아쉬운 곳: 배우 말대로 고친 줄\n다음 테이크: 매달려 봐도 좋아요"), true);
        assertThat(wrapped.path("issue").path("at").asInt()).as("정리가 고쳐 쓴 줄도 같은 곳의 시간을 살린다").isEqualTo(22);
        assertThat(wrapped.path("issue").path("text").asText()).isEqualTo("배우 말대로 고친 줄");
        assertThat(wrapped.path("next").path("text").asText()).isEqualTo("매달려 봐도 좋아요");
    }

    @Test void leadingTimesAreReadWithoutARegex() {
        assertThat(PurposeLoop.leadTime("0:12 \"취소해\"")).isEqualTo(new PurposeLoop.Lead(12, 5));
        assertThat(PurposeLoop.leadTime(" [1:05] 돌아서는 곳").seconds()).isEqualTo(65);
        assertThat(PurposeLoop.leadTime("0:11-0:35 손이 많아요").end()).isEqualTo("0:11-0:35 ".length());
        assertThat(PurposeLoop.leadTime("12:345 아님")).isNull();
        assertThat(PurposeLoop.leadTime("붙잡고 싶었어요")).isNull();
        assertThat(PurposeLoop.leadTime("3:4")).isNull();
        assertThat(PurposeLoop.splitSource("엄마가 먼저 알아채 주기 （같이 찾음）")).containsExactly("엄마가 먼저 알아채 주기", "같이 찾음");
        assertThat(PurposeLoop.splitSource("말을 돌려 떠보기 (내 말)")).containsExactly("말을 돌려 떠보기", "내 말");
        assertThat(PurposeLoop.splitSource("망설이는 사람 (아마도)")).containsExactly("망설이는 사람 (아마도)", "같이 찾음");
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
            names.add(purpose.dir + "/first");
            names.add(purpose.dir + "/path");
        }
        names.addAll(List.of("common/answer", "common/accept", "common/easy", "common/propose", "common/method",
                "evaluate/another", "evaluate/wrap", "stuck/line", "stuck/seen", "stuck/wrap",
                "character/cell", "character/wrap", "talk/mode", "talk/stuck/line", "talk/stuck/wrap",
                "talk/character/cell", "talk/character/wrap", "talk/concern/need", "talk/concern/wrap",
                "reading/mode", "reading/try", "reading/wrap"));
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

    // ---- 영상 없이 말로 (SOMA-745) ----

    @Test void theTalkMarkPicksTheTalkPurposesAndConcernNeedsIt() {
        assertThat(PurposeLoop.Purpose.of("talk:stuck")).isEqualTo(PurposeLoop.Purpose.TALK_STUCK);
        assertThat(PurposeLoop.Purpose.of("talk:character")).isEqualTo(PurposeLoop.Purpose.TALK_CHARACTER);
        assertThat(PurposeLoop.Purpose.of(" talk:concern ")).isEqualTo(PurposeLoop.Purpose.CONCERN);
        assertThat(PurposeLoop.Purpose.of("stuck")).isEqualTo(PurposeLoop.Purpose.STUCK);
        assertThat(PurposeLoop.Purpose.of("concern")).as("영상과 함께 온 고민 상담은 목적 없는 회차").isNull();
        assertThat(PurposeLoop.Purpose.of("talk:evaluate")).as("평가 받기는 영상 없이 할 수 없다").isNull();
        assertThat(PurposeLoop.Purpose.TALK_STUCK.id).as("화면에는 저장된 목적 그대로").isEqualTo("stuck");
        assertThat(PurposeLoop.Purpose.TALK_STUCK.steps).doesNotContain("seen");
        assertThat(PurposeLoop.Purpose.TALK_CHARACTER.character()).isTrue();
        assertThat(PurposeLoop.Purpose.CONCERN.talk()).isTrue();
        assertThat(PurposeLoop.Purpose.CHARACTER.talk()).isFalse();
        assertThat(PurposeView.from("talk:concern", null).step()).isEqualTo("concern");
    }

    @Test void theTalkModeIsAddedOnlyToTalkPromptsAndVideoPromptsStayTheSame() {
        assertThat(PurposeLoop.turnPrompt(PurposeLoop.Purpose.STUCK)).isEqualTo(PurposeLoop.turnPrompt());
        assertThat(PurposeLoop.turnPrompt(PurposeLoop.Purpose.TALK_STUCK)).startsWith(PurposeLoop.turnPrompt())
                .contains("[영상 없이 말로 하는 코칭]");
        assertThat(PurposeLoop.firstPrompt(PurposeLoop.Purpose.CHARACTER)).doesNotContain("[영상 없이 말로 하는 코칭]");
        for (PurposeLoop.Purpose purpose : List.of(PurposeLoop.Purpose.TALK_STUCK, PurposeLoop.Purpose.TALK_CHARACTER,
                PurposeLoop.Purpose.CONCERN)) {
            assertThat(PurposeLoop.firstPrompt(purpose)).contains("[영상 없이 말로 하는 코칭]", "영상 없이]");
            assertThat(PurposeLoop.talkOpening(purpose)).contains("영상 없이", PurposeLoop.label(purpose));
        }
    }

    @Test void everyTalkStepHasItsPromptFile() {
        for (PurposeLoop.Purpose purpose : List.of(PurposeLoop.Purpose.TALK_STUCK, PurposeLoop.Purpose.TALK_CHARACTER,
                PurposeLoop.Purpose.CONCERN)) {
            for (String step : purpose.steps.subList(1, purpose.steps.size())) {
                var turn = new PurposeLoop.Turn(purpose, step, step, true, false, "답", false, null);
                assertThat(PurposeLoop.instruction(turn, null, "말")).as(purpose + " " + step).contains("[이번 응답]", "영상 없이");
            }
        }
    }

    @Test void aTalkStuckAnswerThatQuotesTheLineSkipsWhichLine() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        PurposeLoop.rememberOpening(state, PurposeLoop.Purpose.TALK_STUCK, PurposeLoop.extract(""), "");
        var quoted = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, state, "\"취소해\"에서 울먹거려요", null,
                new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, true, "model"), 1);
        assertThat(quoted.step()).isEqualTo("method");
        var plain = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, state, "감정이 안 따라와요", null,
                new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, true, "model"), 1);
        assertThat(plain.step()).isEqualTo("line");
        var concern = StructuredJson.MAPPER.createObjectNode();
        PurposeLoop.rememberOpening(concern, PurposeLoop.Purpose.CONCERN, PurposeLoop.extract(""), "");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.CONCERN, concern, "오디션이 무서워요", null,
                new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, true, "model"), 1).step()).isEqualTo("need");
    }

    @Test void theTalkCharacterWrapAndDirectionNeverAskForVideoCells() {
        var wrap = PurposeLoop.Turn.directing(PurposeLoop.Purpose.TALK_CHARACTER, "답", false, null, false);
        String instruction = PurposeLoop.instruction(wrap, null, "모르겠어요");
        assertThat(instruction).contains("배우가 한 말과 배우가 적은 대사로 직접 정한다", "(영상) 칸은 쓰지 않는다")
                .doesNotContain("코치가 영상에서 본 것으로 직접 정한다");
        var take = StructuredJson.MAPPER.createObjectNode();
        PurposeLoop.remember(take, wrap, PurposeLoop.extract(""), "지안 앞에서 기다려 봐도 좋아요");
        assertThat(take.path(PurposeLoop.STATE_KEY).has("card")).as("인물 정리는 결과 카드를 만들지 않는다").isFalse();
    }

    @Test void quotesTheActorNeverWroteAreDropped() {
        String actor = "\"어여쁘다는 말은 취소해\" 이 대사요";
        assertThat(PurposeLoop.withoutUngroundedQuotes("\"취소해\"에서 따져 봐도 좋아요.", actor))
                .isEqualTo("\"취소해\"에서 따져 봐도 좋아요.");
        assertThat(PurposeLoop.withoutUngroundedQuotes("지안은 숨기는 사람이에요. \"고마워요\"에서 눌러 말해 봐도 좋아요.", actor))
                .isEqualTo("지안은 숨기는 사람이에요.");
        assertThat(PurposeLoop.withoutUngroundedQuotes("\"고마워요\"에서 눌러 말해 봐도 좋아요.", actor))
                .as("근거 없는 대사만 있으면 그 말을 다시 노출하지 않는다").isEqualTo("이 부분은 말해 준 내용만으로는 판단하기 어려워요.");
        assertThat(PurposeLoop.withoutUngroundedQuotes("", actor)).isEmpty();
        assertThat(PurposeLoop.withoutUngroundedQuotes("따옴표 없는 말이에요.", null)).isEqualTo("따옴표 없는 말이에요.");
    }

    @Test void talkAnswersQuestionsAfterTheWrapInsteadOfWrappingAgain() {
        // 10/25 운영 afedbad8: 정리 뒤 "예시로 읽어줄 수 있어?"(방법 요청)에 정리를 한 번 더 하고 닫았다.
        var wrapped = state("{\"step\":3,\"questions\":2}");
        var method = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, wrapped, "예시로 읽어줄 수 있어?", null,
                kind(PracticeLoopRouter.Kind.METHOD), 3);
        assertThat(method.doing()).isEqualTo("answer");
        assertThat(method.wrap()).isFalse();
        assertThat(method.end()).isFalse();
        assertThat(PurposeLoop.instruction(method, wrapped, "예시로 읽어줄 수 있어?")).contains("정리는 이미 했다");
        // 분류가 답이어도 물음표가 있으면 답한다(10/26 운영 2ccd52cd).
        var drama = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, wrapped, "드라마에 나온 연기를 따라 하고싶으면 어떻게 하나요?", null, ANSWERED, 5);
        assertThat(drama.doing()).isEqualTo("answer");
        // 물음이 아니면 예전처럼 정리로 받는다.
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, wrapped, "해 볼게요", null, ANSWERED, 3).wrap()).isTrue();
        // 응답 상한은 그대로 정리한다.
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, wrapped, "왜요?", null,
                kind(PracticeLoopRouter.Kind.QUESTION), PurposeLoop.REPLY_CAP - 1).wrap()).isTrue();
        // 영상 코칭은 바꾸지 않는다.
        var videoWrapped = state("{\"step\":4,\"questions\":2}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, videoWrapped, "예시로 보여줄 수 있어?", null,
                kind(PracticeLoopRouter.Kind.METHOD), 3).wrap()).isTrue();
    }

    @Test void talkAnswersAQuestionEvenAtTheQuestionCap() {
        var asked2 = state("{\"step\":1,\"questions\":2}");
        var talk = PurposeLoop.decide(PurposeLoop.Purpose.TALK_CHARACTER, asked2, "왜요?", null, kind(PracticeLoopRouter.Kind.QUESTION), 2);
        assertThat(talk.doing()).isEqualTo("answer");
        assertThat(talk.wrap()).isFalse();
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.CHARACTER, asked2, "왜요?", null, kind(PracticeLoopRouter.Kind.QUESTION), 2).wrap())
                .as("영상 코칭은 예전처럼 상한에서 정리").isTrue();
    }

    @Test void talkAnswersAfterTheWrapCarryNoButtons() {
        ObjectNode wrapped = state("{\"step\":3,\"questions\":2,\"choices\":[]}");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, wrapped, "예시로 읽어줄 수 있어?", null,
                kind(PracticeLoopRouter.Kind.METHOD), 3);
        PurposeLoop.remember(wrapped, turn, PurposeLoop.extract("<코치>팁</코치>\n<보기>\n하나\n</보기>"));
        assertThat(PurposeLoop.loop(wrapped).path("choices").size()).as("잘 모르겠어요도 붙이지 않는다").isZero();
        // 정리 전 답은 예전처럼 버튼과 잘 모르겠어요를 둔다.
        ObjectNode early = state("{\"step\":0,\"questions\":1}");
        var line = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, early, "감정이 안 따라와요", null, ANSWERED, 1);
        PurposeLoop.remember(early, line, PurposeLoop.extract("<코치>어느 대사요?</코치>\n<보기>\n첫 대사\n</보기>"));
        assertThat(PurposeLoop.loop(early).path("choices").size()).isEqualTo(2);
    }

    @Test void talkDropsSentencesThatPromiseAResult() {
        // 10/27 dev 재생 원문.
        String reply = "직접 소리 내어 읽어 주긴 어렵지만, 팁은 줄 수 있어요.\n\"남편 이야기는 얼마든지 받습니다\"를 마치 엄청난 비밀을 허락해 주듯 장난스럽게 던져 보세요.\n꽁트의 재미가 훨씬 더 잘 느껴질 거예요.";
        assertThat(PurposeLoop.withoutPromises(reply)).isEqualTo(
                "직접 소리 내어 읽어 주긴 어렵지만, 팁은 줄 수 있어요.\n\"남편 이야기는 얼마든지 받습니다\"를 마치 엄청난 비밀을 허락해 주듯 장난스럽게 던져 보세요.");
        assertThat(PurposeLoop.withoutPromises("이렇게 해 봐요. 훨씬 자연스러워질 거예요! 어때요?")).isEqualTo("이렇게 해 봐요. 어때요?");
        assertThat(PurposeLoop.withoutPromises("훨씬 나아질 거예요.")).as("한 문장뿐이면 둔다").isEqualTo("훨씬 나아질 거예요.");
        assertThat(PurposeLoop.promises("그 장면에서 해 볼 거예요?")).as("물음은 둔다").isFalse();
        assertThat(PurposeLoop.promises("\"내가 갈 거예요.\"")).as("따옴표 대사는 둔다").isFalse();
        assertThat(PurposeLoop.promises("상대가 웃는 거예요.")).as("ㄹ 받침이 아니면 둔다").isFalse();
        assertThat(PurposeLoop.promises("상대에게 더 잘 들릴 거예요.")).isTrue();
    }

    @Test void talkAnswerAfterTheWrapLosesItsTrailingQuestion() {
        // 10/27 폰 재생 원문: 정리 뒤 답이 새 질문으로 끝났다.
        String reply = "긴 대사는 이유를 쪼개서 상대에게 하나씩 던지듯 해 보세요.\n지금 설득해야 하는 가장 큰 이유가 무엇인지부터 골라 볼까요?";
        assertThat(DirectVideoPracticeLoop.withoutQuestions(reply)).isEqualTo("긴 대사는 이유를 쪼개서 상대에게 하나씩 던지듯 해 보세요.");
        var turn = PurposeLoop.decide(PurposeLoop.Purpose.TALK_STUCK, state("{\"step\":3,\"questions\":2}"), "긴 대사는 어떻게 해요", null, ANSWERED, 4);
        assertThat(PurposeLoop.answersAfterWrap(turn)).isTrue();
    }
}
