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
        boolean confusion = latest.matches("(?s).*(?:무슨\\s*(?:질문|말)|뭔\\s*소리|뭐라는|이해가?\\s*안|질문.{0,12}모르겠|설명.{0,12}모르겠|^\\?+$).*");
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
        boolean handQuestion = latest.matches("(?s).*(?:손동작|손으로|손이|손은|손을|손\\s+.{0,8}(?:보|전달|움직|연기)).*")
                && !latest.matches("(?s).*손.{0,12}(?:말고|아니라|제외).*");
        handQuestion &= latest.matches("(?s).*(?:영상|보여|보였|보이는|전달|피드백|평가|확인|잘\\s*(?:됐|했|된|돼)).*");
        var handRefs = StructuredJson.MAPPER.createArrayNode();
        boolean handUnavailable = false;
        for (JsonNode source : input.path("record_view").path("source_catalog")) {
            String description = source.path("text").asText();
            if ("record_limitation".equals(source.path("kind").asText()) && description.contains("손")
                    && description.matches("(?s).*(?:화면\\s*밖|확인할\\s*수\\s*없).*")) {
                handUnavailable = true;
                handRefs.add(source.path("id"));
            }
        }
        String lastCoach = input.path("last_exchange").path("coach_message").path("text").asText();
        boolean unclearCorrection = latest.strip().matches("(?:아[,\\s]*)?(?:내가\\s*)?(?:실수로|잘못)\\s*(?:말했(?:어|어요|다)|썼(?:어|어요|다))[.!?\\s]*")
                && OpeningQuestion.questionCount(lastCoach) == 0;
        return StructuredJson.MAPPER.createObjectNode()
                .put("explain_instead_of_repeating_question", confusion)
                .put("unclear_correction", unclearCorrection)
                .put("analysis_uncertain", latest.strip().matches("(?:모르겠(?:어|어요|다)|몰라(?:요)?|ㅁㄹ|글쎄(?:요)?)[.!?\\s]*"))
                .put("unobservable_hand_requested", handQuestion && handUnavailable)
                .put("objective_already_asked", objectiveAsked)
                .put("acknowledged_suggestion", acknowledgement(latest) && "suggest".equals(input.path("coaching_state").path("last_reply").path("move").asText()))
                .put("consecutive_acknowledgements", acknowledgements)
                .set("unobservable_hand_refs", handRefs);
    }

    static String turnInstruction(JsonNode progress) {
        if (progress.path("explain_instead_of_repeating_question").asBoolean()) {
            return "\n\n[이번 응답에서 가장 먼저 지킬 것]\n"
                    + "배우는 코치 말을 이해하지 못했다. 영상 속 말을 상대에게 어떤 뜻으로 건넬 수 있는지 일상적인 말로 풀이한다. "
                    + "줄거리나 관찰 사실을 다시 나열하지 않는다. 부탁이라고만 하지 말고 '상대가 조금 더 남아 내 말을 들어줬으면 하는 뜻'처럼 쉽게 풀이한다. "
                    + "확인되지 않은 의도는 '일 수 있어요'로 구분하고 배우의 확정된 목적처럼 저장하지 않는다. "
                    + "직전 설명도 이해하지 못했다면 같은 내용을 반복하지 말고 더 쉬운 뜻으로 풀어준다. 코치가 무엇을 물었는지·왜 질문했는지 설명하지 않는다. "
                    + "새 질문이나 연기 동작 지시 없이 끝낸다. move=explain 또는 simplify, selection.question=null이다.";
        }
        if (progress.path("analysis_uncertain").asBoolean()) {
            return "\n\n[이번 응답에서 가장 먼저 지킬 것]\n"
                    + "배우는 아직 장면의 뜻을 모른다. 대사에서 확실히 알 수 있는 뜻 하나를 설명하거나, 막힌 뜻을 풀어줄 구체적인 질문 하나를 한다. "
                    + "말해보세요·기다려보세요 같은 수행 지시나 표정·억양·시선 처방으로 넘어가지 않는다. "
                    + "모른다는 답을 상황·관계·인물 목적의 사실로 저장하지 않는다.";
        }
        return "";
    }

    static ObjectNode correctionTargetReply(JsonNode input) {
        var reply = StructuredJson.MAPPER.createObjectNode().put("action", "respond")
                .put("base_state_revision", input.path("coaching_state").path("revision").asLong())
                .put("message", "방금 저에게 한 답을 고치신다는 뜻인가요, 영상 속 대사를 실수로 말했다는 뜻인가요?")
                .putNull("context_update").putNull("style_update").put("flow", "continue");
        var actor = input.path("user_message");
        String text = actor.path("text").asText();
        var link = reply.putObject("reply_link").put("user_message_id", actor.path("id").asText())
                .put("actor_quote", text.substring(0, Math.min(80, text.length()))).put("move", "clarify");
        link.putArray("evidence_refs");
        var selection = link.putObject("selection").put("need", "정정하려는 대상 확인").put("blocker", "scene_understanding");
        selection.putArray("known_refs").add(actor.path("id"));
        selection.putObject("question").put("missing_information", "코치에게 한 답을 정정하는지 영상 속 대사를 설명하는지")
                .put("help_if_answered", "잘못된 전제를 철회하고 배우가 뜻한 상황으로 이어간다.");
        return reply;
    }

    static ObjectNode observationLimitReply(JsonNode input) {
        var reply = StructuredJson.MAPPER.createObjectNode().put("action", "respond")
                .put("base_state_revision", input.path("coaching_state").path("revision").asLong())
                .put("message", "영상에서 손동작을 확인할 수 없어, 그 동작이 잘 전달됐는지는 판단하기 어려워요.")
                .putNull("context_update").putNull("style_update").put("flow", "continue");
        var actor = input.path("user_message");
        String text = actor.path("text").asText();
        var link = reply.putObject("reply_link").put("user_message_id", actor.path("id").asText())
                .put("actor_quote", text.substring(0, Math.min(80, text.length()))).put("move", "explain");
        link.set("evidence_refs", input.path("dialogue_progress").path("unobservable_hand_refs").deepCopy());
        var selection = link.putObject("selection").put("need", "손동작의 확인 가능 여부")
                .put("blocker", "delivery").putNull("question");
        selection.putArray("known_refs").add(actor.path("id"));
        return reply;
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
        if (progress.path("analysis_uncertain").asBoolean()) {
            require(!"suggest".equals(move) && !response.path("message").asText().matches("(?s).*(?:보세요|기다리세요).*"),
                    "아직 장면의 뜻을 모른다. 연기해 보라는 지시 대신 대사의 뜻을 설명하거나 그 뜻을 찾게 돕는 구체적인 질문 하나를 한다.");
        }
        if (progress.path("unobservable_hand_requested").asBoolean()) {
            require("explain".equals(move) || "clarify".equals(move),
                    "손동작을 물었지만 손은 관찰할 수 없다. assess 대신 explain으로 손의 확인 한계만 설명한다. 어깨·몸통·시선·표정·목소리로 손을 대신 평가하지 않는다.");
        }
        if (progress.path("explain_instead_of_repeating_question").asBoolean()) {
            require(!response.path("message").asText().matches("(?s).*(?:제가\\s*묻|묻는\\s*말|질문을?\\s*드린).*$"),
                    "코치가 무엇을 물었는지 설명하지 않는다. 주어를 실제 대사 내용으로 바꾸고 구체적인 뜻을 알려준다.");
            require(response.path("reply_link").path("selection").path("question").isNull()
                    && !"clarify".equals(move) && OpeningQuestion.questionCount(response.path("message").asText()) == 0,
                    "배우가 질문에 혼란을 보였다. 질문을 멈추고 영상 대사에서 확실한 내용과 가능한 뜻 하나만 쉬운 말로 설명하라. selection.question=null이며 질문하지 않는다.");
        }
        if (progress.path("acknowledged_suggestion").asBoolean()) {
            require(!"suggest".equals(move), "이미 방법을 제안했고 배우가 수긍했다. 같은 제안을 반복하거나 다른 표현 동작을 추가하지 말고, 남은 장면 해석 하나를 돕거나 실제 관찰로 평가하라.");
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
