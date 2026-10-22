package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Before;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Classified;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Kind;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Tally;
import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

/** 맞춤 코칭은 단계 지시 자체를 그 배우용으로 바꿔 끼운다 — 근거 없는 칸은 공통 지시 그대로다 (SOMA-795). */
class ActorCoachingTest {

    private static final List<String> STEPS = List.of(PracticeLoopRouter.EASY, PracticeLoopRouter.FIND, PracticeLoopRouter.GAP,
            PracticeLoopRouter.WRAP_UP, PracticeLoopRouter.PROPOSE, "답하기", "다시 묻기", "짚어주기", PracticeLoopRouter.LET_GO);

    private static ActorCoaching only(String summary) {
        return new ActorCoaching(null, null, null, List.of(), null, null, null, null, List.of(), null, summary, null);
    }

    private static ActorCoaching stuck(String mode) {
        return new ActorCoaching(mode, null, null, List.of(), null, null, null, null, List.of(), null, "근거", null);
    }

    @Test
    void fieldsWithoutEvidenceOnlyAddTheCommonBansLine() {
        ActorCoaching none = only("이 배우는 방법을 바로 들을 때 움직였다.");
        for (String doing : STEPS) {
            String task = DirectVideoPrompts.practiceLoopTask(doing, null);
            String swapped = none.stepTask(doing, task);
            assertThat(swapped.replace(ActorCoaching.COMMON_BANS + "\n", "")).as(doing).isEqualTo(task);
            assertThat(swapped.indexOf(ActorCoaching.COMMON_BANS)).as(doing + " 피할 말 바로 아래")
                    .isEqualTo(swapped.indexOf("피할 말:") + "피할 말:\n".length());
            assertThat(none.withoutNeverSay(task)).as(doing).isEqualTo(task);
        }
        String first = DirectVideoPrompts.practiceLoop(UUID.randomUUID(), null);
        assertThat(none.firstTask(first).replace(ActorCoaching.COMMON_BANS + "\n", "")).isEqualTo(first);
        assertThat(stuck("choice").stepTask(PracticeLoopRouter.EASY, DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.EASY, null))
                .replace(ActorCoaching.COMMON_BANS + "\n", ""))
                .as("둘 중 고르기가 통한 배우는 고르기 지시 그대로").isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.EASY, null));
    }

    @Test
    void commonBanExpressionsLeaveTheInstructionsButQuotesWarningsAndMaterialStay() {
        ActorCoaching coaching = only("근거");
        String answer = DirectVideoPrompts.practiceLoopTask("답하기", null);
        assertThat(answer).contains("그러면 내 말에 아빠가 흔들리는지 알 수 없어요.");
        assertThat(coaching.withoutCommonBans(answer))
                .as("공통 금지 표현이 든 좋은 예는 빠진다").doesNotContain("아빠가 흔들리는지 알 수 없어요")
                .as("피할 말의 경고 줄은 남는다").contains("- \"~해 보세요\", \"~하세요\"처럼 시키기.");
        String pointOut = DirectVideoPrompts.practiceLoopTask("짚어주기", null);
        assertThat(coaching.withoutCommonBans(pointOut))
                .as("따옴표 안의 배우 말 예시는 남는다").contains("(\"피드백 해 주세요\", ")
                .as("\"흔들리는지\"가 든 좋은 예는 빠진다").doesNotContain("다음엔 아빠가 흔들리는지 보면서 따져 봐도 좋아요.");
        String withMaterial = "[이번 응답]\n도움이 되는 말:\n- 상대를 살피며 말해 봐도 좋아요.\n\n재료\n- 배우가 방금 한 말: 피드백 해 주세요 살피며 볼게요\n";
        assertThat(coaching.withoutCommonBans(withMaterial))
                .doesNotContain("- 상대를 살피며 말해 봐도 좋아요.").contains("- 배우가 방금 한 말: 피드백 해 주세요 살피며 볼게요");
        assertThat(coaching.personaText()).contains("- 칭찬, 감상을 하지 않는다.")
                .contains("- 시키는 말(\"~하세요\", \"~보세요\", \"~마세요\")을 쓰지 않는다. 방향은 \"~해 봐도 좋아요\"로 말한다.")
                .contains("\"확인하며\", \"살피며\", \"흔들리는지\"를 쓰지 않는다.");
        ActorCoaching legacy = ActorCoaching.parse("[이 배우에게 맞춘 코칭]\n지난 글");
        assertThat(legacy.withoutCommonBans(answer)).isEqualTo(answer);
    }

    @Test
    void aStuckActorWhoMovedOnOneProposalNeverGetsTheChoiceQuestionInstruction() {
        ActorCoaching propose = stuck("propose_one");
        String easy = propose.stepTask(PracticeLoopRouter.EASY, DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.EASY, null));
        assertThat(easy).isEqualTo(ActorCoaching.EASY_PROPOSE).doesNotContain("모양: 둘 중 고르는 질문").contains("하나를");
        String find = propose.stepTask(PracticeLoopRouter.FIND, DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.FIND, null));
        assertThat(find).doesNotContain("둘 중 고르게 묻는다(").contains("둘 중 고르게 묻지 않는다");
        String gap = propose.stepTask(PracticeLoopRouter.GAP, DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null));
        assertThat(gap).doesNotContain("고르게 하고 싶으면 한 질문 안에 둘을 넣는다");

        String open = stuck("easier_open").stepTask(PracticeLoopRouter.EASY,
                DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.EASY, null));
        assertThat(open).isEqualTo(ActorCoaching.EASY_OPEN).contains("열린 질문 한 문장").doesNotContain("보기 둘을 준다");
    }

    @Test
    void theFirstQuestionAndClosingTemplatesReplaceTheCommonShapes() {
        ActorCoaching shaped = new ActorCoaching(null, "[상대]는 [인물]한테 어떤 사람이에요?",
                "처음엔 [행동1], \"[대사]\"부터는 [행동2]해 봐도 좋아요. [이유 한 문장]", List.of(), null, null, null, null,
                List.of("카메라 시선"), null, "근거", null);
        String first = shaped.firstTask(DirectVideoPrompts.practiceLoop(UUID.randomUUID(), null));
        assertThat(first)
                .doesNotContain("- 2 목적성이 안 보인다 →").doesNotContain("위 목록에서 그대로 옮긴다")
                .doesNotContain("첫 질문은 <설계>의 근본 문제에 맞춰 고른다.")
                .contains("첫 질문 모양: [이 배우의 첫 질문 모양 \"[상대]는 [인물]한테 어떤 사람이에요?\"")
                .contains("- 이 배우에게 짚지 않는 것: 카메라 시선");
        assertThat(first.split("\\[상대\\]는 \\[인물\\]한테 어떤 사람이에요\\?", -1).length - 1)
                .as("목록 설명·<코치> 칸·<설계> 칸 세 곳에 틀이 들어간다").isEqualTo(3);
        assertThat(first).contains("- 이 배우의 첫 질문 모양을 그대로 쓴다.").doesNotContain("- 위의 모양을 그대로 쓴다.");

        String wrap = shaped.stepTask(PracticeLoopRouter.WRAP_UP, DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, null));
        assertThat(wrap).contains("- 이 배우에게는 정리를 이 모양으로 말한다").contains("처음엔 [행동1]")
                .doesNotContain("좋은 예").doesNotContain("- 장면 전체를 꿰는 행동 하나와 그게 되는지 확인할 대사 하나로 말한다.")
                .contains("모양: 맨 첫 줄에 숨은 줄 <다음 테이크>");
    }

    @Test
    void phrasesTheActorDislikedLeaveTheCommonInstructionsButWarningsStay() {
        ActorCoaching never = new ActorCoaching(null, null, null, List.of("확인하며", "어떤 사람이라고 생각했어요"), null, null, null,
                null, List.of(), null, "근거", null);
        String wrap = DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, null);
        String first = DirectVideoPrompts.practiceLoop(UUID.randomUUID(), null);
        assertThat(never.withoutNeverSay(wrap)).doesNotContain("\"확인하며\", \"살피며\"만 따로 쓰지 않는다");
        assertThat(never.withoutNeverSay(first)).doesNotContain("- 3 캐릭터에 대한 이해가 잘못됐다 → 이 장면의 [인물]은 어떤 사람이라고 생각했어요?")
                .doesNotContain("좋은 예(다른 영상, 캐릭터)");
        String answer = DirectVideoPrompts.practiceLoopTask("답하기", null);
        String bad = "나쁜 예: 확인하며 해 보세요.";
        assertThat(never.withoutNeverSay(answer + "\n" + bad)).as("나쁜 예는 쓰지 말라는 줄이라 남긴다").endsWith(bad);
    }

    @Test
    void answerAndReasonSwitchesStrengthenTheAnswerStep() {
        ActorCoaching direct = new ActorCoaching(null, null, null, List.of(), true, true, null, null, List.of(), null, "근거", null);
        String answer = direct.stepTask("답하기", DirectVideoPrompts.practiceLoopTask("답하기", null));
        assertThat(answer).contains("- 이 배우에게는 이유·방법을 물으면 첫 문장에서 바로 답한다. 끝 질문은 붙이지 않는다.")
                .contains("- 이 배우에게는 관찰이나 제안에 이유 한 문장을 꼭 붙인다.");
        assertThat(answer.indexOf("바로 답한다. 끝 질문은")).isGreaterThan(answer.indexOf("도움이 되는 말:"));
    }

    @Test
    void theStoredJsonRoundTripsAndOldTextProfilesStillAttachAsText() {
        ActorCoaching full = new ActorCoaching("propose_one", "[인물]은 [상대]한테서 뭘 얻고 싶었어요?", null, List.of("확인하며"),
                true, true, 3, "root", List.of("카메라 시선"), 100, "이 배우는 이유를 들을 때 움직였다.", null);
        ActorCoaching back = ActorCoaching.parse(full.toJson());
        assertThat(back).isEqualTo(full);
        assertThat(back.personaText()).startsWith("[길이] 100\n" + ActorCoaching.HEADER + "\n")
                .contains("둘 중 고르게 묻지 않는다. 코치가 하나를 이유와 함께 제안한다")
                .contains("정리 전에 묻는 질문은 3개까지다")
                .endsWith("- 한 번에 하는 말은 공백 포함 100자 안쪽이다.");
        assertThat(DirectVideoPrompts.persona("actor-profile", null, full.toJson())).startsWith(ActorCoaching.HEADER).doesNotContain("[길이]");
        assertThat(DirectVideoPrompts.personaReplyLimit("actor-profile", null, full.toJson())).isEqualTo(100);
        assertThat(DirectVideoPrompts.persona("actor-profile", Locale.ENGLISH, full.toJson())).isEmpty();
        assertThat(new ActorCoaching(null, null, null, null, null, null, 9, null, null, 400, null, null))
                .satisfies(c -> assertThat(c.maxQuestions()).isEqualTo(4)).satisfies(c -> assertThat(c.replyLength()).isEqualTo(160));

        ActorCoaching legacy = ActorCoaching.parse("[길이] 90\n[이 배우에게 맞춘 코칭]\n지난 글");
        assertThat(legacy.personaText()).isEqualTo("[길이] 90\n[이 배우에게 맞춘 코칭]\n지난 글");
        String easy = DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.EASY, null);
        assertThat(legacy.stepTask(PracticeLoopRouter.EASY, easy)).isEqualTo(easy);
    }

    @Test
    void theQuestionCapSendsTheConversationToTheClosingOnceReached() throws Exception {
        Before stage2 = new Before(3, "어긋남 보기", Kind.ANSWER, new Tally(0, 0, 0), List.of(), false, false, false, false, 3);
        Classified shortAnswer = new Classified(Kind.SHORT, false, "code");
        assertThat(PracticeLoopRouter.route(shortAnswer, stage2, 0, "a", null, 3)).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.route(shortAnswer, stage2, 0, "a", 4, 3)).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.route(shortAnswer, stage2, 0, "a", 3, 3)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        Classified question = new Classified(Kind.QUESTION, false, "code");
        assertThat(PracticeLoopRouter.route(question, stage2, 0, "a", 2, 3)).as("물음에는 상한이어도 답한다").isEqualTo("답하기");
        Classified correction = new Classified(Kind.CORRECTION, false, "code");
        assertThat(PracticeLoopRouter.route(correction, stage2, 0, "a", 2, 3)).as("정정은 그대로 받는다").isEqualTo(PracticeLoopRouter.LET_GO);

        var loop = StructuredJson.MAPPER.readTree(
                "{\"statuses\":[\"\",\"배우의 말: 답\\n할 일: 어긋남 보기\",\"배우의 말: 질문·설명\\n할 일: 답하기\",\"배우의 말: 짧은 답\\n할 일: 쉽게 묻기\"]}");
        assertThat(PracticeLoopRouter.questionsAsked(loop, 4)).as("첫 질문 + 어긋남 보기 + 쉽게 묻기, 답하기는 세지 않는다").isEqualTo(3);
        assertThat(PracticeLoopRouter.questionsAsked(loop, 0)).isZero();
    }
}
