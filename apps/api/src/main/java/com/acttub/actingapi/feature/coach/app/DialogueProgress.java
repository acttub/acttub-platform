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
        String lastMove = input.path("coaching_state").path("last_reply").path("move").asText();
        int acknowledgements = acknowledgement(latest) ? 1 : 0;
        JsonNode messages = input.path("recent_messages");
        if (acknowledgements > 0) for (int i = messages.size() - 1; i >= 0; i--) {
            JsonNode message = messages.get(i);
            if (!"actor".equals(message.path("role").asText())) continue;
            if (!acknowledgement(message.path("text").asText())) break;
            acknowledgements++;
        }
        return StructuredJson.MAPPER.createObjectNode()
                .put("explain_instead_of_repeating_question", confusion && "simplify".equals(lastMove))
                .put("consecutive_acknowledgements", acknowledgements);
    }

    static void validate(JsonNode response, JsonNode progress) {
        if (!"respond".equals(response.path("action").asText())) return;
        boolean finish = "finish".equals(response.path("flow").asText());
        require(!finish || progress.path("allow_finish").asBoolean(),
                "배우의 수긍은 종료 요청이 아니다. finish_required=false이면 대화를 계속하며 다음 도움을 준다.");
        if (finish) return;
        require(!response.path("message").asText().matches("(?s).*(?:제가\\s*묻는\\s*건|묻는\\s*거예요|왜.{0,20}생각해보세요).*"),
                "원래 질문을 반복해 설명하지 말고, 배우가 막힌 뜻을 구체적인 장면 내용으로 풀어준다.");
        String move = response.path("reply_link").path("move").asText();
        if (progress.path("explain_instead_of_repeating_question").asBoolean()) {
            require(response.path("reply_link").path("selection").path("question").isNull()
                    && !"simplify".equals(move) && !"clarify".equals(move),
                    "질문을 풀었는데도 혼란이 이어졌다. 같은 질문을 다시 묻지 말고 확인된 장면 내용으로 설명하라.");
        }
        if (progress.path("consecutive_acknowledgements").asInt() >= 2) {
            require(!"acknowledge".equals(move), "수긍 뒤 같은 요약을 반복하지 말고 다음 도움을 주거나 마쳐라.");
        }
    }

    private static boolean acknowledgement(String text) {
        return text.strip().matches("(?:ㅇㅇ|ㅇㅋ|응|네+|맞아|맞아요|그래|그래요|알겠어|알겠어요)[.!\\s]*");
    }
}
