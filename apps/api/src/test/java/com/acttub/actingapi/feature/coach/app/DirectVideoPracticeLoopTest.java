package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 연습 루프의 글 다듬기·언어 판단·숨은 상태 칸·노트 재료. */
class DirectVideoPracticeLoopTest {
    static CoachSessionSnapshot session(JsonNode state, String situation, String kind, String subBranch, String detail, String... turns) {
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, situation, "", "", 8000,
                kind, subBranch, detail, "open", "", list, PriorContext.EMPTY, "three_layers_v1", 0, state, null);
    }

    static ObjectNode state(String design, String... statuses) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", design);
        ArrayNode array = loop.putArray("statuses");
        for (String status : statuses) array.add(status);
        return state;
    }

    @Test void textTrimmingKeepsTheOriginalWhenNothingWouldRemain() {
        assertThat(DirectVideoPracticeLoop.onlyFirstQuestion("말끝이 길어요.\n다음에 봐요.")).isEqualTo("말끝이 길어요.\n다음에 봐요.");
        assertThat(DirectVideoPracticeLoop.withoutQuestions("왜요? 정말요?")).isEqualTo("왜요? 정말요?");
        assertThat(DirectVideoPracticeLoop.firstQuestionOnly("말끝이 길어요. 왜요?")).isEqualTo("말끝이 길어요. 왜요?");
        assertThat(DirectVideoPracticeLoop.withoutEcho("한 문장뿐이에요.", "한 문장뿐이에요")).isEqualTo("한 문장뿐이에요.");
        assertThat(DirectVideoPracticeLoop.withoutEcho("가. 나.", null)).isEqualTo("가. 나.");
        assertThat(DirectVideoPracticeLoop.withoutEcho("붙잡고 싶었는데 애원하긴 싫었군요. 말끝을 봐요.", "붙잡고 싶었는데 애원하긴 싫었어"))
                .isEqualTo("말끝을 봐요.");
        assertThat(DirectVideoPracticeLoop.parse(null)).isEqualTo(new DirectVideoPracticeLoop.Parsed("", "", ""));
        assertThat(DirectVideoPracticeLoop.displayLength(null)).isZero();
        assertThat(DirectVideoPracticeLoop.hasTimestamp(null)).isFalse();
        assertThat(DirectVideoPracticeLoop.nextTake(null)).isEmpty();
        assertThat(DirectVideoPracticeLoop.designNextTake(null)).isEmpty();
    }

    @Test void brokenOutputIsRecognisedButOrdinaryWordsAreNot() {
        assertThat(DirectVideoPracticeLoop.looksBroken(null, null)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("  ", null)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("​​", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("<div>안녕</div>", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("좋아요 <answer>", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("This is plain English text", Locale.ENGLISH)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("This is plain English 텍스트", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("말끝이 ㅋㅋㅋㅋㅋㅋ", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("123 456", null)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("말끝이 길게 남아요.", Locale.KOREAN)).isFalse();
    }

    @Test void fixedMessagesFollowTheReplyLanguage() {
        assertThat(DirectVideoPracticeLoop.brokenRetryNote(Locale.ENGLISH)).startsWith("[Rewrite]\nYour last answer was unrelated text.");
        assertThat(DirectVideoPracticeLoop.emptyRetryNote(Locale.ENGLISH)).startsWith("[Rewrite]\nYour last answer had no words");
        assertThat(DirectVideoPracticeLoop.timestampRetryNote(Locale.ENGLISH)).startsWith("[Rewrite]\nYour last answer pointed to a passage");
        assertThat(DirectVideoPracticeLoop.notActingMessage(Locale.ENGLISH))
                .isEqualTo("I couldn't find an acting scene in this video.\nPlease upload a video with your acting in it.");
        assertThat(DirectVideoPracticeLoop.audioUnavailableMessage(Locale.ENGLISH))
                .isEqualTo("The video's audio is silent.\nPlease upload a video with audible sound.");
        assertThat(DirectVideoPracticeLoop.brokenRetryNote(Locale.KOREAN)).startsWith("[다시 쓰기]");
    }

    @Test void theActionSentenceIsPickedFromTheWrapUp() {
        assertThat(DirectVideoPracticeLoop.actionLine(null)).isEmpty();
        assertThat(DirectVideoPracticeLoop.actionLine(" ")).isEmpty();
        assertThat(DirectVideoPracticeLoop.actionLine("특히 끝을 봐요. 다음 테이크에서 확인해 봐요.\n상대 눈을 보며 말해 봐도 좋아요."))
                .isEqualTo("상대 눈을 보며 말해 봐도 좋아요");
        assertThat(DirectVideoPracticeLoop.actionLine("잘했어요.")).isEmpty();
    }

    @Test void theActorsLanguageComesFromTheirWordsOrExplicitRequests() {
        assertThat(DirectVideoPracticeLoop.actorLanguage(null, "Please answer in English")).isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.actorLanguage(null, "please answer in korean")).isNull();
        assertThat(DirectVideoPracticeLoop.actorLanguage(null, "これはテストです")).isEqualTo(Locale.JAPANESE);
        assertThat(DirectVideoPracticeLoop.actorLanguage(null, "ok")).isNull();
        CoachSessionSnapshot english = session(null, "A woman stops her partner at the door", "그 외", "그 외", "", "질문", "그만");
        assertThat(DirectVideoPracticeLoop.actorLanguage(english, "")).isEqualTo(Locale.ENGLISH);
        CoachSessionSnapshot dotted = session(null, ".", "그 외", "그 외", "", "질문", "ok");
        assertThat(DirectVideoPracticeLoop.actorLanguage(dotted, null)).isNull();
        assertThat(DirectVideoPracticeLoop.languageOf("ok fine")).isEqualTo(Locale.ROOT);
    }

    @Test void markersAreStoredOnceUnderTheLoopKey() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.rememberPersona(state, "b1");
        DirectVideoPracticeLoop.rememberPersona(state, "b2");
        DirectVideoPracticeLoop.rememberFlow(state, "b");
        DirectVideoPracticeLoop.rememberFlow(state, "a");
        DirectVideoPracticeLoop.rememberCoachModel(state, "b");
        DirectVideoPracticeLoop.rememberCoachModel(state, "a");
        DirectVideoPracticeLoop.markInputIssue(state, "silent");
        DirectVideoPracticeLoop.markNotActing(state, "뉴스");
        assertThat(DirectVideoPracticeLoop.storedPersona(state)).isEqualTo("b1");
        assertThat(DirectVideoPracticeLoop.storedFlow(state)).isEqualTo("b");
        assertThat(DirectVideoPracticeLoop.storedCoachModel(state)).isEqualTo("b");
        assertThat(DirectVideoPracticeLoop.wasCut(state)).isTrue();
        assertThat(state.path(DirectVideoPracticeLoop.STATE_KEY).path("input_issue").asText()).isEqualTo("silent");
        assertThat(DirectVideoPracticeLoop.storedPersona(null)).isEmpty();
        assertThat(DirectVideoPracticeLoop.storedFlow(null)).isEmpty();
        assertThat(DirectVideoPracticeLoop.storedCoachModel(null)).isEmpty();
        ObjectNode issueOnly = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.markInputIssue(issueOnly, "silent");
        ObjectNode notActingOnly = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.markNotActing(notActingOnly, "뉴스");
        assertThat(DirectVideoPracticeLoop.wasCut(issueOnly)).isTrue();
        assertThat(DirectVideoPracticeLoop.wasCut(notActingOnly)).isTrue();
        ObjectNode modelOnly = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.rememberCoachModel(modelOnly, "a");
        ObjectNode flowOnly = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.rememberFlow(flowOnly, "a");
        assertThat(DirectVideoPracticeLoop.storedCoachModel(modelOnly)).isEqualTo("a");
        assertThat(DirectVideoPracticeLoop.storedFlow(flowOnly)).isEqualTo("a");
    }

    @Test void onlySessionsStartedAsALoopContinueAsOne() {
        assertThat(DirectVideoPracticeLoop.applies(session(null, "", "그 외", "그 외", ""))).isTrue();
        assertThat(DirectVideoPracticeLoop.applies(session(null, "", "그 외", "그 외", "", "질문"))).isFalse();
        assertThat(DirectVideoPracticeLoop.applies(session(StructuredJson.MAPPER.createObjectNode(), "", "그 외", "그 외", "", "질문"))).isFalse();
        assertThat(DirectVideoPracticeLoop.applies(session(state("버릇: 말끝"), "", "그 외", "그 외", "", "질문"))).isTrue();
    }

    @Test void theActorMaterialSkipsWhatTheActorDidNotWrite() {
        assertThat(DirectVideoPracticeLoop.actorMaterial(session(null, ".", "그 외", "그 외", " "))).isEmpty();
        assertThat(DirectVideoPracticeLoop.actorMaterial(session(null, "문 앞", "표현", "그 외", "빨라진다")))
                .isEqualTo("## 배우가 적은 것\n이번 연습을 올리며 배우가 적은 것이다. 영상 근거가 아니다.\n"
                        + "- 상황: 문 앞\n- 막힌 곳: 표현\n- 막힌 곳 설명: 빨라진다\n\n");
        assertThat(DirectVideoPracticeLoop.actorMaterial(session(null, "", "표현", "속도", ""))).contains("- 막힌 곳: 표현 · 속도");
    }

    @Test void historyReattachesTheDesignAndOptionallyTheStatuses() {
        ObjectNode state = state("버릇: 말끝", "", "할 일: 파고들기");
        var turns = session(state, "", "그 외", "그 외", "", "첫 말", "답", "둘째 말").turns();
        List<DirectVideoModel.Message> with = DirectVideoPracticeLoop.history(turns, state, "새 답");
        assertThat(with.get(2).text()).isEqualTo("<상태>할 일: 파고들기</상태>\n둘째 말");
        assertThat(with.getLast()).isEqualTo(new DirectVideoModel.Message("user", "새 답"));
        List<DirectVideoModel.Message> without = DirectVideoPracticeLoop.history(turns, state, null, false);
        assertThat(without.get(0).text()).isEqualTo("<설계>\n버릇: 말끝\n</설계>\n<코치>\n첫 말\n</코치>");
        assertThat(without.get(2).text()).isEqualTo("둘째 말");
        assertThat(without).hasSize(3);
        assertThat(DirectVideoPracticeLoop.history(turns, null, null).get(0).text()).isEqualTo("첫 말");
    }

    @Test void theDesignIsKeptFromTheFirstReplyOnly() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.remember(state, new DirectVideoPracticeLoop.Parsed("버릇: 말끝", "", "첫 말"));
        DirectVideoPracticeLoop.remember(state, new DirectVideoPracticeLoop.Parsed("버릇: 다른 것", "할 일: 파고들기", "둘째 말"));
        assertThat(state.path(DirectVideoPracticeLoop.STATE_KEY).path("design").asText()).isEqualTo("버릇: 말끝");
        assertThat(state.path(DirectVideoPracticeLoop.STATE_KEY).path("statuses").toString()).isEqualTo("[\"\",\"할 일: 파고들기\"]");
    }

    @Test void finishingIsReadFromEitherStatusShape() {
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", "순간2 · 마무리2 · 응답 6번째", ""))).isTrue();
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", "할 일: 끝", ""))).isTrue();
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", "할 일: 파고들기", ""))).isFalse();
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", "순간1 · 파고들기", ""))).isFalse();
        assertThat(DirectVideoPracticeLoop.action("응답 2번째 · 파고들기")).isEqualTo("파고들기");
        assertThat(DirectVideoPracticeLoop.action("응답 2번째 · 누적 3")).isEmpty();
    }

    @Test void theNoteUsesTheActorsOwnLineReasonAndCorrections() {
        ObjectNode state = state("버릇: 소리 빠르기\n소리 빠르기: 대사가 점점 빨라진다. 특히 끝에서\n다음 테이크: [끝을 늦춘다]",
                "",
                "배우의 말: 정정\n할 일: 파고들기\n피할 것: 없음",
                "배우의 말: 답\n할 일: 마무리1",
                "배우의 말: 자기 한 줄\n다음 테이크: 지키며: 빨라짐을 지키며 끝만 늦춘다\n이번 목표: 끝 늦추기");
        CoachSessionSnapshot session = session(state, "", "그 외", "그 외", "",
                "첫 말", "그건 아니야 빠른 건 의도야", "왜 그랬나요?", "인물이 급해서 그래", "한 줄?", "나는 급한 사람이다", "좋아요");
        var note = DirectVideoPracticeLoop.note(session, 9);
        assertThat(note.title()).isEqualTo("대사가 점점 빨라진다");
        assertThat(note.kind()).isEqualTo("action");
        assertThat(note.nextTake()).isEqualTo("빨라짐을 지키며 끝만 늦춘다");
        assertThat(note.sourceRevision()).isEqualTo(9);
        assertThat(note.corrections().toString()).isEqualTo("[\"대사가 점점 빨라진다: \\\"그건 아니야 빠른 건 의도야\\\"\"]");
        assertThat(note.summaryQuotes().get(0).path("quote").asText()).isEqualTo("나는 급한 사람이다");
        assertThat(note.summaryQuotes().get(0).path("source_ref").asText()).isEqualTo(StructuredCoachEngine.turnId(session, 5));
        assertThat(note.summaryQuotes().get(1).path("quote").asText()).isEqualTo("인물이 급해서 그래");
        DirectVideoPracticeLoop.Round round = DirectVideoPracticeLoop.round(state.path(DirectVideoPracticeLoop.STATE_KEY), session.turns());
        assertThat(round.goal()).isEqualTo("끝 늦추기");
    }

    @Test void withoutTheActorsLineTheObservedHabitOpensTheSummary() {
        String longHabit = "대사를 시작하기 전에 고개를 숙이고 숨을 오래 고른 뒤 아주 작은 소리로 첫 마디를 겨우 꺼낸다";
        ObjectNode state = state("버릇: " + longHabit + "\n이번 목표: 없음", "");
        var note = DirectVideoPracticeLoop.note(session(state, "", "그 외", "그 외", "", "첫 말"), 1);
        assertThat(note.kind()).isEqualTo("observation");
        assertThat(note.nextTake()).isNull();
        assertThat(note.title()).endsWith("…").hasSizeLessThanOrEqualTo(41);
        assertThat(note.summaryQuotes().get(0).path("kind").asText()).isEqualTo("observation");
        assertThat(DirectVideoPracticeLoop.goal(state.path(DirectVideoPracticeLoop.STATE_KEY).path("statuses"), "이번 목표: 없음")).isNull();
        assertThat(DirectVideoPracticeLoop.goal(null, "이번 목표: 끝 늦추기")).isEqualTo("끝 늦추기");
        assertThat(DirectVideoPracticeLoop.closingNextTake(null)).isEmpty();
    }

    @Test void noNoteWithoutALoopDesignOrAfterACut() {
        assertThat(DirectVideoPracticeLoop.note(session(null, "", "그 외", "그 외", ""), 1)).isNull();
        assertThat(DirectVideoPracticeLoop.note(session(state("인물: 떠나는 사람"), "", "그 외", "그 외", ""), 1)).isNull();
        ObjectNode cut = state("버릇: 말끝");
        DirectVideoPracticeLoop.markNotActing(cut, "뉴스");
        assertThat(DirectVideoPracticeLoop.note(session(cut, "", "그 외", "그 외", ""), 1)).isNull();
    }

    @Test void aHabitCategoryIsReplacedByItsDescriptionWhenThereIsOne() {
        assertThat(DirectVideoPracticeLoop.habit("버릇: 몸")).isEqualTo("몸");
        assertThat(DirectVideoPracticeLoop.habit("버릇: 몸\n몸: 없음")).isEqualTo("몸");
        assertThat(DirectVideoPracticeLoop.habit("버릇: 몸\n몸: 어깨가 올라간다")).isEqualTo("어깨가 올라간다");
    }

    @org.junit.jupiter.api.Test void hidesNextTakeLineWhoseClosingBracketIsMissing() {
        String raw = "<다음 테이크>담담하게 말해 봐도 좋아요.</다음 테이크\n\n사실에 짓눌리지 않고 덤덤하게 말해 봐도 좋아요.";
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.parse(raw).message())
                .isEqualTo("사실에 짓눌리지 않고 덤덤하게 말해 봐도 좋아요.");
    }

    @org.junit.jupiter.api.Test void findsMetaphorsUnlessTheActorUsedTheWordFirst() {
        var a = org.assertj.core.api.Assertions.class;
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.metaphors("\"과학의 역할이야\"에서 말이 또렷하게 꽂혀요.", ""))
                .containsExactly("꽂혀");
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.metaphors("위로가 상대에게 닿지 않고 튕겨 나갈 거예요.", "")).containsExactly("튕겨");
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.metaphors("목소리는 깊게 눌러주는 무게감이 있어요.", "")).containsExactly("무게");
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.metaphors("사실의 무게에 짓눌리지 않고 말해 봐도 좋아요.", "무게를 견디는것도 없어")).isEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.metaphors("\"가지 마\"에서 목소리가 커져요. 그때 상대한테 뭘 하려고 했어요?", "")).isEmpty();
    }

    @org.junit.jupiter.api.Test void findsRepeatedFeedbackLines() {
        String before = "\"생활이 진실하게\"에서 들뜬 모습은 또렷해요. 아쉬운 건 \"아빤 꿈을 크게\"부터 상대가 아니라 계속 허공만 보며 말하는 거예요. 다음엔 상대가 내 말을 믿는지 보면서 들려줘 봐도 좋아요.";
        String again = "미안해요, 제가 놓쳤어요.\n\"생활이 진실하게\"에서 들뜬 모습은 또렷해요. 아쉬운 건 \"아빤 꿈을 크게\"부터 상대가 아니라 계속 허공만 보며 말하는 거예요.";
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedLines(again, java.util.List.of(before))).hasSize(2);
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedLines("\"불러줄게\"에서 상대를 챙기는 흐름은 또렷해요. 아쉬운 건 끝에서 혼자 신나게 끝내는 거예요.",
                java.util.List.of(before))).isEmpty();
    }

    @org.junit.jupiter.api.Test void findsARepeatedQuestion() {
        var earlier = java.util.List.of("아, 그럼 그 장면에서 기록관에게 메데이아로서 하려던 건 뭐였어요?");
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion(
                "아, 그럼 그 장면에서 기록관에게 메데이아로서 하려던 건 뭐였어요?", earlier)).isNotEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion(
                "\"40%는 좀\"과 사과할 때 태도가 비슷해서요.\n선배한테서 결국 뭘 얻어내고 싶었어요?",
                java.util.List.of("\"죄송합니다\" 할 때도 대사에 집중했어요.\n이 장면에서 선배한테 결국 뭘 얻어내고 싶었어요?"))).isNotEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion(
                "그걸 위해 장면 내내 기록관한테 뭘 해 볼래요?", earlier)).isEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion("질문 없는 말이에요.", earlier)).isEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion("아, 그럼 이 장면에선 스스로에게 무엇을 하려고 했어요?",
                java.util.List.of("아, 그럼 그 장면에서 인물은 스스로 무엇을 하려고 했어요?"))).isNotEmpty();
        org.assertj.core.api.Assertions.assertThat(DirectVideoPracticeLoop.repeatedQuestion("상대가 어떤 표정을 짓길 원했어요?",
                java.util.List.of("상대가 어떻게 반응하길 바랐어요?"))).isEmpty();
    }

    @Test void anEnglishScreenStillGetsKoreanRepliesWhenTheActorWritesKorean() {
        // 2026-10-15 00:12 운영(자문, 영어 화면): 배우는 내내 한국어로 답했는데 코치는 영어로 답했다.
        try {
            org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.ENGLISH);
            assertThat(DirectVideoPracticeLoop.replyLanguage(null, "폭발하는 씬이라서")).as("한국어 답이면 한국어").isNull();
            assertThat(DirectVideoPracticeLoop.replyLanguage(null, "I wanted to shift the mood there")).isEqualTo(java.util.Locale.ENGLISH);
            assertThat(DirectVideoPracticeLoop.replyLanguage(null, null)).as("배우 말이 아직 없으면 화면 언어").isEqualTo(java.util.Locale.ENGLISH);
            assertThat(DirectVideoPracticeLoop.replyLanguage(null, "그만")).as("종료 말만으로는 바꾸지 않는다").isEqualTo(java.util.Locale.ENGLISH);
            assertThat(DirectVideoPracticeLoop.replyLanguage(null, "영어로 해 줘")).isEqualTo(java.util.Locale.ENGLISH);
        } finally {
            org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();
        }
    }

    @Test void advisorTasksDropTheTrailingHowAbout() {
        assertThat(DirectVideoPrompts.withoutHowAbout("하나씩 따져 봐도 좋을 것 같아요. 어때요?\")")).isEqualTo("하나씩 따져 봐도 좋을 것 같아요.\")");
        assertThat(DirectVideoPrompts.withoutHowAbout(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.PROPOSE, null))).doesNotContain("어때요?");
    }

    @Test void unclosedThinkingTagLineIsDropped() {
        // 2026-10-22 운영: 배우 화면 맨 앞에 "<thought"가 그대로 나갔다(닫는 꺾쇠 없음, 10/14부터 8번).
        assertThat(DirectVideoPracticeLoop.parse("<thought\n화를 누르니까 더 집중됐군요.\n찍을 때도 그렇게 느꼈어요?").message())
                .isEqualTo("화를 누르니까 더 집중됐군요.\n찍을 때도 그렇게 느꼈어요?");
        assertThat(DirectVideoPracticeLoop.parse("  <think \n네. 그럼 장면 내내 뭘 해 볼래요?").message())
                .isEqualTo("네. 그럼 장면 내내 뭘 해 볼래요?");
        assertThat(DirectVideoPracticeLoop.parse("<생각\n아, 그럼 뭘 하려고 했어요?").message()).isEqualTo("아, 그럼 뭘 하려고 했어요?");
        // 대사 속 꺾쇠나 다른 낱말은 건드리지 않는다.
        assertThat(DirectVideoPracticeLoop.parse("\"<thoughtful>\"이 아니라 \"그만해\"에서요.").message())
                .isEqualTo("\"<thoughtful>\"이 아니라 \"그만해\"에서요.");
        assertThat(DirectVideoPracticeLoop.parse("thought 라는 말은 안 써요?").message()).isEqualTo("thought 라는 말은 안 써요?");
    }
}
