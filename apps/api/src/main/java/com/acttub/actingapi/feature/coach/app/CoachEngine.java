package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TextValidation;
import com.acttub.actingapi.integration.llm.TextValidator;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** OpenAI 기반 갈래 코칭 엔진. 저장과 HTTP 응답 조립은 다음 층의 책임이다. */
@Service
public class CoachEngine {

    private static final Logger LOG = LoggerFactory.getLogger(CoachEngine.class);
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
    private final FailureReporter failureReporter;

    public CoachEngine(TextGenerator generate, FailureReporter failureReporter) {
        this.generate = generate;
        this.failureReporter = failureReporter;
    }

    public static CoachReply parseCoachingResponse(String rawText) {
        return parse(rawText).reply();
    }

    private static ParsedCoachReply parse(String rawText) {
        String original = rawText.strip();
        Matcher fenced = FENCED_JSON.matcher(original);
        String jsonText = fenced.matches() ? fenced.group(1).strip() : original;
        JsonNode candidate;
        try {
            candidate = RESPONSE_MAPPER.readTree(jsonText);
        } catch (JsonProcessingException exc) {
            return new ParsedCoachReply(
                    new CoachReply(original, "continue", null), exc);
        }
        if (candidate == null || candidate.isMissingNode()) {
            return new ParsedCoachReply(
                    new CoachReply(original, "continue", null),
                    new IllegalStateException("coach response was empty"));
        }
        JsonNode message = !candidate.isObject()
                ? null
                : candidate.get("message");
        if (message == null || !message.isTextual()) {
            return new ParsedCoachReply(
                    new CoachReply(original, "continue", null), null);
        }

        JsonNode handoff = candidate.get("handoff");
        boolean complete = "complete".equals(candidate.path("status").asText())
                && handoff != null
                && handoff.isObject();
        return new ParsedCoachReply(
                new CoachReply(
                        message.textValue().strip(),
                        complete ? "complete" : "continue",
                        complete ? ((ObjectNode) handoff).deepCopy() : null),
                null);
    }

    /** 새 세션의 첫 응답을 만들고 actor→ai 순서로 두 turn을 추가한다. */
    public CoachResult start(CoachSessionSnapshot session, UUID operationId) {
        String latest = firstActorMessage(session);
        CoachReply response = generateValidated(session, latest, operationId);
        return appendTurns(session, latest, response);
    }

    /**
     * 첫 사용자 메시지. 막힘 상세 → 목표 → 막힘 대분류 순으로 떨어진다.
     *
     * <p>이 값은 <b>배우의 발화로 대화 이력에 남는다.</b> 그래서 사슬 끝이 막힘 대분류다 —
     * 장면을 건너뛴 세션은 목표까지 비어 배우가 아무 말도 안 한 채로 대화가 열리는데,
     * 대분류는 항상 값이 있는 유일한 칸이다. 배우가 직접 고른 값이면 거짓이 남지 않는다
     * (ADR-021). 막힘까지 건너뛴 세션은 웹·앱이 보내는 건너뛰기 값 {@code 그 외} 가 그대로
     * 첫 발화가 된다(ADR-021 보강).
     *
     * <p>대분류가 비어 사슬이 값에 못 닿는 일은 <b>이 파일이 막지 않는다</b> — 요청 검증
     * ({@code BlockageBranch.KINDS})과 {@code practice_sessions} 의 CHECK 제약이 값을
     * 보장한다. 건너뛰어도 {@code 그 외} 가 저장된다는 결정이 그 보장의 근거다.
     *
     * <p>공백만 든 값도 건너뛴다 — 배우가 한 말이 아니므로 이력에 공백 한 칸을 남기지 않는다.
     */
    private static String firstActorMessage(CoachSessionSnapshot session) {
        if (!CoachPrompt.blank(session.blockageDetail())) {
            return session.blockageDetail();
        }
        if (!CoachPrompt.blank(session.goal())) {
            return session.goal();
        }
        return session.blockageKind();
    }

    /** 기존 세션의 다음 응답을 만들고 actor→ai 순서로 두 turn을 추가한다. */
    public CoachResult reply(
            CoachSessionSnapshot session, String actorText, UUID operationId) {
        String userMessage = messageForGeneration(actorText);
        CoachReply response = generateValidated(session, userMessage, operationId);
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
            CoachSessionSnapshot session, String userMessage, UUID operationId) {
        String systemPrompt = CoachPrompt.select(session.blockageKind());
        GeneratedText generated = generate.generate(
                systemPrompt, CoachPrompt.buildChat(session, userMessage));
        String rawText = generated.text();
        CoachReply reply = parseGeneratedResponse(rawText, operationId);
        TextValidation validation = TextValidator.validateTurn(reply.message(), false);
        if (!validation.failures().isEmpty()) {
            generated = generate.generate(
                    systemPrompt,
                    CoachPrompt.buildRegeneration(
                            session,
                            userMessage,
                            rawText,
                            validation.failures()));
            reply = parseGeneratedResponse(generated.text(), operationId);
            validation = TextValidator.validateTurn(reply.message(), false);
        }
        if (!validation.failures().isEmpty()) {
            int turnNumber = CoachPrompt.turnNumber(session);
            LOG.warn(
                    "코치 답이 두 번 검증에 걸려 안전 문구로 대체한다: session={} response={} failures={}",
                    session.sessionId(), turnNumber, validation.failures());
            return new CoachReply(
                    CoachPrompt.safeTemplate(turnNumber, session.blockageKind()),
                    "continue",
                    null);
        }
        return sanitizeActorWords(reply);
    }

    private CoachReply parseGeneratedResponse(String rawText, UUID operationId) {
        ParsedCoachReply parsed = parse(rawText);
        if (parsed.failure() != null) {
            failureReporter.report(
                    parsed.failure(),
                    FailureKind.EXTERNAL,
                    new FailureContext("CoachEngine.responseParse", operationId));
        }
        return parsed.reply();
    }

    private static CoachResult appendTurns(
            CoachSessionSnapshot session, String actorText, CoachReply reply) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        turns.add(new CoachTurnSnapshot("actor", actorText));
        turns.add(new CoachTurnSnapshot("ai", reply.message()));
        return new CoachResult(session.withTurns(turns), reply);
    }

    private record ParsedCoachReply(CoachReply reply, Throwable failure) {
    }
}
