package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import static com.acttub.actingapi.feature.coach.app.CoachingStateReducer.require;

/** Narrow conversation repair guards. These do not grade the actor's interpretation. */
final class DialogueProgress {
    private DialogueProgress() { }

    static boolean actorFinished(String text) {
        if (text == null) return false;
        if (ClosingIntent.isClosing(text)) return true;
        // A correction can precede an explicit closing sentence. Quoted script endings are not commands.
        String unquoted = text.replaceAll("“[^”]*”|‘[^’]*’|\"[^\"]*\"|'[^']*'", "");
        return unquoted.strip().matches("(?s)(?:.*[.!?。]\\s*)?(?:(?:네|응|ㅇㅇ|알겠어|알겠어요)[,\\s]*)?"
                + "(?:(?:오늘은|이번 대화는)\\s*)?여기까지(?:\\s*(?:할게|할게요|하자|정리해줘|정리해 주세요))?[.!?\\s]*")
                || unquoted.strip().matches("(?s)(?:.*[.!?。]\\s*)?(?:(?:여기까지|지금까지|오늘은|오늘 대화|이번 대화)\\s*)?정리(?:해줘|해 줘|해주세요|해 주세요)[.!?\\s]*");
    }

    static ObjectNode controls(JsonNode input) {
        String latest = input.path("user_message").path("text").asText();
        boolean confusion = latest.matches("(?s).*(?:무슨\\s*(?:질문|말)|뭔\\s*소리|뭐라는|이해가?\\s*안|모르겠|^\\?+$).*");
        int acknowledgements = acknowledgement(latest) ? 1 : 0;
        JsonNode messages = input.path("recent_messages");
        boolean objectiveAsked = false;
        for (JsonNode message : messages) {
            if ("ai".equals(message.path("role").asText()) && asksObjective(message.path("text").asText())) objectiveAsked = true;
        }
        if (acknowledgements > 0) for (int i = messages.size() - 1; i >= 0; i--) {
            JsonNode message = messages.get(i);
            if (!"actor".equals(message.path("role").asText())) continue;
            if (!acknowledgement(message.path("text").asText())) break;
            acknowledgements++;
        }
        return StructuredJson.MAPPER.createObjectNode()
                .put("explain_instead_of_repeating_question", confusion)
                .put("objective_already_asked", objectiveAsked)
                .put("consecutive_acknowledgements", acknowledgements);
    }

    static void validate(JsonNode response, JsonNode progress) {
        if (!"respond".equals(response.path("action").asText())) return;
        boolean finish = "finish".equals(response.path("flow").asText());
        require(!finish || progress.path("allow_finish").asBoolean(),
                "배우의 수긍은 종료 요청이 아니다. finish_required=false이면 대화를 계속하며 다음 도움을 준다.");
        if (finish) return;
        require(!response.path("message").asText().matches("(?s).*(?:제가\\s*묻는\\s*건|묻는\\s*거(?:예요|였어요)|왜.{0,20}생각해보세요).*"),
                "원래 질문을 반복해 설명하지 말고, 배우가 막힌 뜻을 구체적인 장면 내용으로 풀어준다.");
        require(!progress.path("objective_already_asked").asBoolean() || !asksObjective(response.path("message").asText()),
                "원하는 결과는 이미 물었다. 계기를 반복하거나 답하지 못한 배우에게 같은 목적 질문을 다시 하지 말고, 대사로 가능한 뜻을 설명한다.");
        String move = response.path("reply_link").path("move").asText();
        if (progress.path("explain_instead_of_repeating_question").asBoolean()) {
            require(response.path("reply_link").path("selection").path("question").isNull()
                    && !"clarify".equals(move) && OpeningQuestion.questionCount(response.path("message").asText()) == 0,
                    "배우가 질문에 혼란을 보였다. 질문을 멈추고 영상 대사에서 확실한 내용과 가능한 뜻 하나만 쉬운 말로 설명하라. selection.question=null이며 질문하지 않는다.");
        }
        if (progress.path("consecutive_acknowledgements").asInt() >= 2) {
            require(!"acknowledge".equals(move), "수긍 뒤 같은 요약을 반복하지 말고 다음 도움을 주거나 마쳐라.");
        }
    }

    private static boolean acknowledgement(String text) {
        return text.strip().matches("(?:ㅇㅇ|ㅇㅋ|응|네+|맞아|맞아요|그래|그래요|알겠어|알겠어요)[.!\\s]*");
    }

    private static boolean asksObjective(String text) {
        return text.matches("(?s).*(?:어떻게\\s*하길|무엇을\\s*하길).{0,18}(?:바라|바랐|원하|원했).*[?？].*");
    }
}
