package com.acttub.actingapi.coach;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.llm.GeneratedText;
import com.acttub.actingapi.llm.TextGenerator;
import com.acttub.actingapi.llm.TextValidation;
import com.acttub.actingapi.llm.TextValidator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/** OpenAI 기반 갈래 코칭 엔진. 저장과 HTTP 응답 조립은 다음 층의 책임이다. */
@Service
public class CoachEngine {

    private static final ObjectMapper RESPONSE_MAPPER = new ObjectMapper();
    private static final Pattern FENCED_JSON = Pattern.compile(
            "^```(?:json)?\\s*([\\s\\S]*?)\\s*```$", Pattern.CASE_INSENSITIVE);
    private static final List<String> CLOSING_WORDS = List.of("그만", "종료", "끝");
    private static final String CLOSING_TURN_INSTRUCTION =
            "\n\n## 배우의 마무리 요청\n"
                    + "배우가 지금 대화를 마치겠다고 했다.\n"
                    + "더 질문하지 말고 지금까지 모인 내용만으로 초안을 마무리한다.\n"
                    + "아직 확인하지 못한 내용은 uncertainties에 남긴다.\n"
                    + "실험 전이라도 현재까지의 handoff를 작성해 status를 complete로 출력한다.";

    private final TextGenerator generate;

    public CoachEngine(TextGenerator generate) {
        this.generate = generate;
    }

    public static CoachReply parseCoachingResponse(String rawText) {
        String original = rawText.strip();
        Matcher fenced = FENCED_JSON.matcher(original);
        String jsonText = fenced.matches() ? fenced.group(1).strip() : original;
        JsonNode candidate;
        try {
            candidate = RESPONSE_MAPPER.readTree(jsonText);
        } catch (JsonProcessingException exc) {
            return new CoachReply(original, "continue", null);
        }
        JsonNode message = candidate == null || !candidate.isObject()
                ? null
                : candidate.get("message");
        if (message == null || !message.isTextual()) {
            return new CoachReply(original, "continue", null);
        }

        JsonNode handoff = candidate.get("handoff");
        boolean complete = "complete".equals(candidate.path("status").asText())
                && handoff != null
                && handoff.isObject();
        return new CoachReply(
                message.textValue().strip(),
                complete ? "complete" : "continue",
                complete ? ((ObjectNode) handoff).deepCopy() : null);
    }

    /** 새 세션의 첫 응답을 만들고 actor→ai 순서로 두 turn을 추가한다. */
    public CoachResult start(CoachSessionSnapshot session) {
        String detail = session.blockageDetail();
        String latest = detail == null || detail.isEmpty() ? session.goal() : detail;
        CoachReply response = generateValidated(session, latest);
        return appendTurns(session, latest, response);
    }

    /** 기존 세션의 다음 응답을 만들고 actor→ai 순서로 두 turn을 추가한다. */
    public CoachResult reply(CoachSessionSnapshot session, String actorText) {
        String userMessage = messageForGeneration(actorText);
        CoachReply response = generateValidated(session, userMessage);
        return appendTurns(session, actorText, response);
    }

    static String messageForGeneration(String actorText) {
        return CLOSING_WORDS.stream().anyMatch(actorText::contains)
                ? actorText + CLOSING_TURN_INSTRUCTION
                : actorText;
    }

    private CoachReply generateValidated(
            CoachSessionSnapshot session, String userMessage) {
        String systemPrompt = CoachPrompt.select(session.blockageKind());
        GeneratedText generated = generate.generate(
                systemPrompt, CoachPrompt.buildChat(session, userMessage));
        String rawText = generated.text();
        CoachReply reply = parseCoachingResponse(rawText);
        TextValidation validation = TextValidator.validateTurn(reply.message(), false);
        if (!validation.failures().isEmpty()) {
            generated = generate.generate(
                    systemPrompt,
                    CoachPrompt.buildRegeneration(
                            session,
                            userMessage,
                            rawText,
                            validation.failures()));
            reply = parseCoachingResponse(generated.text());
            validation = TextValidator.validateTurn(reply.message(), false);
        }
        if (!validation.failures().isEmpty()) {
            return new CoachReply(CoachPrompt.safeTemplate(), "continue", null);
        }
        return reply;
    }

    private static CoachResult appendTurns(
            CoachSessionSnapshot session, String actorText, CoachReply reply) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        turns.add(new CoachTurnSnapshot("actor", actorText));
        turns.add(new CoachTurnSnapshot("ai", reply.message()));
        return new CoachResult(session.withTurns(turns), reply);
    }
}
