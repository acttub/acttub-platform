package com.acttub.actingapi.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.coach.domain.ClosingIntent;
import com.acttub.actingapi.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TextValidation;
import com.acttub.actingapi.integration.llm.TextValidator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/** OpenAI 기반 갈래 코칭 엔진. 저장과 HTTP 응답 조립은 다음 층의 책임이다. */
@Service
public class CoachEngine {

    private static final ObjectMapper RESPONSE_MAPPER = new ObjectMapper();
    private static final Pattern FENCED_JSON = Pattern.compile(
            "^```(?:json)?\\s*([\\s\\S]*?)\\s*```$", Pattern.CASE_INSENSITIVE);
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
        return ClosingIntent.isClosing(actorText)
                ? actorText + CLOSING_TURN_INSTRUCTION
                : actorText;
    }

    /**
     * handoff 에서 종료어를 걷어낸다.
     *
     * <p>handoff 가 만들어지는 유일한 자리라 여기서 걸러야 새는 곳이 없다. 노트를 만드는
     * 경로가 둘(완료 턴, /v2/reports 가 저장된 handoff 로 다시 만드는 경우)이라
     * 소비하는 쪽에서 거르면 한쪽이 반드시 빠진다.
     *
     * <p>모델이 actor_words 를 리스트가 아닌 값으로 줄 수 있다. 문자열 원소만 남긴다.
     */
    private static CoachReply sanitizeActorWords(CoachReply reply) {
        if (reply.handoff() == null || !reply.handoff().isObject()) {
            return reply;
        }
        JsonNode words = reply.handoff().get("actor_words");
        if (words == null || !words.isArray()) {
            return reply;
        }
        ArrayNode kept = RESPONSE_MAPPER.createArrayNode();
        for (JsonNode word : words) {
            if (word.isTextual() && !ClosingIntent.isClosing(word.textValue())) {
                kept.add(word);
            }
        }
        if (kept.size() == words.size()) {
            return reply;
        }
        ObjectNode handoff = ((ObjectNode) reply.handoff()).deepCopy();
        handoff.set("actor_words", kept);
        return new CoachReply(reply.message(), reply.status(), handoff);
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
        return sanitizeActorWords(reply);
    }

    private static CoachResult appendTurns(
            CoachSessionSnapshot session, String actorText, CoachReply reply) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        turns.add(new CoachTurnSnapshot("actor", actorText));
        turns.add(new CoachTurnSnapshot("ai", reply.message()));
        return new CoachResult(session.withTurns(turns), reply);
    }
}
