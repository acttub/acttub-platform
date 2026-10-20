package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

/** 모델 응답을 못 쓸 때의 고정 문구와 언어 판단, 첫 응답·도움 요청에 대한 서버 검사. */
class CoachResponsePolicyFallbackTest {
    static CoachSessionSnapshot session(String kind, JsonNode pack, String... turns) {
        List<CoachTurnSnapshot> list = new ArrayList<>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), pack, "", "", "", 8000, kind,
                "그 외", "", "open", "", list, PriorContext.EMPTY, "legacy", 0, null, null);
    }

    @Test void anEnglishSpeakerWhoIsStuckGetsTheEnglishExplanationForTheirBranch() {
        assertThat(CoachResponsePolicy.fallback(session("표현", null, "Question?", "I want her to stay"), "I don't know").message())
                .startsWith("I couldn’t tailor the explanation reliably.");
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "Question?", "I want her to stay"), "I don't know").message())
                .startsWith("My explanation wasn’t clear enough.");
    }

    @Test void anOrdinaryRequestGetsTheGenericFallbackInTheActorsLanguage() {
        CoachReply english = CoachResponsePolicy.fallback(session("분석", null, "질문"), "Why does the pause matter?");
        assertThat(english.message()).startsWith("I couldn’t produce a reliable answer to that request.");
        assertThat(english.status()).isEqualTo("continue");
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "질문"), "왜 멈추는 게 중요해?").message())
                .startsWith("이번 요청에 맞는 답을 정확하게 만들지 못했어요.");
    }

    @Test void anExplicitLanguageRequestWinsOverTheScriptUsed() {
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "질문"), "please answer 한국어로").message())
                .startsWith("이번 요청에 맞는 답을");
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "질문"), "설명은 영어로 해줘").message())
                .startsWith("I couldn’t produce");
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "질문"), "Answer in Korean").message())
                .startsWith("이번 요청에 맞는 답을");
        assertThat(CoachResponsePolicy.fallback(session("분석", null, "질문", "편하게 말할래"), "???").message())
                .startsWith("이번 요청에 맞는 답을");
    }

    @Test void anEnglishActorMustNotGetAKoreanOnlyExplanation() {
        CoachSessionSnapshot session = session("분석", null, "질문", "I want her to stay");
        assertThat(CoachResponsePolicy.failures(session, "Why the pause?", new CoachReply("멈춘 뒤에 말해요.", "continue", null)))
                .contains("배우는 영어로 대화하고 있다. 대사 인용을 제외한 설명은 영어로 답한다.");
        assertThat(CoachResponsePolicy.failures(session, "Why the pause?", new CoachReply("The pause before “가지 마” matters.", "continue", null)))
                .doesNotContain("배우는 영어로 대화하고 있다. 대사 인용을 제외한 설명은 영어로 답한다.");
    }

    @Test void theFirstReplyWithVideoMaterialMustKeepTheConversationOpen() {
        JsonNode pack = StructuredJson.parse("{\"speech\":{\"transcript\":\"가지 마\"},\"observations\":[]}");
        CoachSessionSnapshot opening = session("그 외", pack);
        assertThat(CoachResponsePolicy.failures(opening, "", new CoachReply("말끝이 길어요. 왜 그랬나요? 무엇을 바랐나요?", "complete", null)))
                .contains("첫 질문에 대한 답을 받기 전에 대화를 완료하지 않는다.")
                .anyMatch(failure -> failure.startsWith("첫 응답의 질문은 최대 하나다."));
        assertThat(CoachResponsePolicy.fallback(opening, "").message()).isEqualTo("영상에 근거한 설명을 준비하지 못했어요.");
        JsonNode observed = StructuredJson.parse("{\"observations\":[{\"what\":\"\",\"quote\":\"가지 마\"}]}");
        assertThat(CoachResponsePolicy.fallback(session("그 외", observed), "").status()).isEqualTo("continue");
        assertThat(OpeningQuestion.legacyMaterial(session("그 외", StructuredJson.parse("{\"observations\":[{\"what\":\" \"}]}")))).isFalse();
        assertThat(OpeningQuestion.legacyMaterial(session("그 외", null))).isFalse();
        assertThat(OpeningQuestion.fallback(true)).isEqualTo("I couldn’t prepare a grounded explanation of this video.");
    }

    @Test void repeatingThePreviousAnswerToAHelpRequestIsRejected() {
        CoachSessionSnapshot session = session("분석", null, "말끝이 길어요. 일부러 그랬나요?", "붙잡고 싶었어");
        assertThat(CoachResponsePolicy.failures(session, "모르겠어요", new CoachReply("말끝이 길어요, 일부러 그랬나요?", "continue", null)))
                .contains("도움 요청에 직전 응답을 반복했다. 설명과 구체적인 예시로 바꾼다.");
        assertThat(CoachResponsePolicy.failures(session("분석", null), "모르겠어요", new CoachReply("예를 들어 볼게요.", "continue", null)))
                .doesNotContain("도움 요청에 직전 응답을 반복했다. 설명과 구체적인 예시로 바꾼다.");
    }

    @Test void questionMarksCountOnlyOutsideQuotesInBothWidths() {
        assertThat(OpeningQuestion.questionCount("“어디 가？”라고 했죠. 왜 그랬어요？")).isEqualTo(1);
        assertThat(OpeningQuestion.videoSource(null)).isFalse();
        assertThat(OpeningQuestion.videoSource(StructuredJson.parse("{\"kind\":\"video_observation\",\"text\":\" \"}"))).isFalse();
        assertThat(OpeningQuestion.videoSource(StructuredJson.parse("{\"kind\":\"actor_message\",\"text\":\"말\"}"))).isFalse();
    }
}
