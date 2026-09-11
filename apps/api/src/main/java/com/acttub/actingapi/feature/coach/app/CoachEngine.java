package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachHelpIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmScore;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
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
    private final LlmTelemetry telemetry;

    public CoachEngine(
            TextGenerator generate, FailureReporter failureReporter, LlmTelemetry telemetry) {
        this.generate = generate;
        this.failureReporter = failureReporter;
        this.telemetry = telemetry;
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
        CoachReply response = generateValidated(session, actorText, operationId);
        return appendTurns(session, actorText, response);
    }

    static String messageForGeneration(String actorText) {
        return ClosingIntent.isClosing(actorText)
                ? actorText + CLOSING_TURN_INSTRUCTION
                : actorText;
    }

    /**
     * handoff 에서 종료어와 도움 버튼 문구를 걷어낸다.
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
            if (word.isTextual() && !ClosingIntent.isClosing(word.textValue())
                    && !CoachHelpIntent.isHelpOnly(word.textValue())) {
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
            CoachSessionSnapshot session, String actorText, UUID operationId) {
        String userMessage = messageForGeneration(actorText)
                + CoachResponsePolicy.recoveryInstruction(session, actorText);
        String systemPrompt = CoachPrompt.select(session.blockageKind());
        int turnNumber = CoachPrompt.turnNumber(session);
        String chatPrompt = CoachPrompt.buildChat(session, userMessage);
        GeneratedText generated = recorded(
                LlmStep.COACH_TURN, session, turnNumber, systemPrompt, chatPrompt);
        String rawText = generated.text();
        CoachReply reply = parseGeneratedResponse(rawText, operationId);
        List<String> failures = CoachResponsePolicy.failures(session, actorText, reply);
        List<String> firstFailures = failures;
        if (!failures.isEmpty()) {
            String retryPrompt =
                    CoachPrompt.buildRegeneration(session, userMessage, rawText, failures);
            generated = recorded(
                    LlmStep.COACH_REGENERATION, session, turnNumber, systemPrompt, retryPrompt);
            reply = parseGeneratedResponse(generated.text(), operationId);
            failures = CoachResponsePolicy.failures(session, actorText, reply);
        }
        boolean fellBack = !failures.isEmpty();
        scoreValidation(session, firstFailures, fellBack, failures);
        if (fellBack) {
            LOG.warn(
                    "코치 답이 두 번 검증에 걸려 안전 문구로 대체한다: session={} response={} failures={}",
                    session.sessionId(), turnNumber, failures);
            return CoachResponsePolicy.fallback(session, actorText);
        }
        return sanitizeActorWords(reply);
    }

    /**
     * 이번 응답이 규칙을 어겼는지를 점수로 남긴다.
     *
     * <p>모델을 한 번도 더 부르지 않는다 — 서버가 이미 판정한 것을 옮겨 적을 뿐이다.
     * 여기서 나오는 비율("이번 주 안전 문구 대체 11%, 그중 8할이 금지어")이 품질을
     * 눈이 아니라 숫자로 보게 하는 자리다(SOMA-517).
     */
    private void scoreValidation(
            CoachSessionSnapshot session,
            List<String> firstFailures,
            boolean fellBack,
            List<String> remainingFailures) {
        UUID practiceSessionId = session.practiceSessionId();
        if (practiceSessionId == null) {
            return;
        }
        telemetry.score(LlmScore.flag(
                practiceSessionId, "coach.regenerated", !firstFailures.isEmpty()));
        telemetry.score(LlmScore.flag(practiceSessionId, "coach.fallback_used", fellBack)
                .withComment(fellBack ? String.join(" / ", remainingFailures) : null));
        for (String failure : firstFailures) {
            telemetry.score(LlmScore.category(
                    practiceSessionId, "coach.validation_failure", failureLabel(failure)));
        }
    }

    /**
     * 실패 문구의 <b>첫 마디</b>를 갈래 이름으로 쓴다. 문구가 코드의 상수라 안정적이지만,
     * 문구를 고치면 갈래가 갈린다 — 고칠 때 지난 기록과 이어지지 않는다는 것만 알고 고친다.
     */
    private static String failureLabel(String failure) {
        int cut = failure.length();
        for (String delimiter : List.of(":", ". ", "·")) {
            int at = failure.indexOf(delimiter);
            if (at > 0) {
                cut = Math.min(cut, at);
            }
        }
        return failure.substring(0, Math.min(cut, 40)).trim();
    }

    /**
     * 모델을 부르고 그 한 번을 기록한다.
     *
     * <p><b>1차와 재생성을 따로 남기는 것이 요점이다.</b> 둘은 같은 메서드를 부르지만 뜻이
     * 다르다 — 재생성이 있었다는 것은 1차가 서버 검증에 걸렸다는 뜻이고, 그 비율이 곧
     * 품질 지표다. 지금까지는 둘이 원장 한 행에 묻혀 사후에 셀 방법이 없었다.
     *
     * <p>실패해도 기록하고 예외는 그대로 올린다 — 실패만 기록에서 빠지면 비율이 거짓이 된다.
     */
    private GeneratedText recorded(
            LlmStep step,
            CoachSessionSnapshot session,
            int turnNumber,
            String systemPrompt,
            String userPrompt) {
        Instant startedAt = Instant.now();
        try {
            GeneratedText generated = generate.generate(systemPrompt, userPrompt);
            telemetry.record(new LlmCall(
                    step,
                    session.practiceSessionId(),
                    session.userId(),
                    generated.model(),
                    systemPrompt + "\n\n" + userPrompt,
                    generated.text(),
                    tokens(generated),
                    startedAt,
                    Duration.between(startedAt, Instant.now()),
                    null,
                    metadata(session, turnNumber)));
            return generated;
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(
                    step,
                    session.practiceSessionId(),
                    session.userId(),
                    "",
                    systemPrompt + "\n\n" + userPrompt,
                    "",
                    LlmTokens.unknown(),
                    startedAt,
                    Duration.between(startedAt, Instant.now()),
                    failure.getMessage() == null ? failure.toString() : failure.getMessage(),
                    metadata(session, turnNumber)));
            throw failure;
        }
    }

    private static java.util.Map<String, String> metadata(
            CoachSessionSnapshot session, int turnNumber) {
        return LlmCall.metadata(
                "coach_session", String.valueOf(session.sessionId()),
                "turn", String.valueOf(turnNumber),
                "blockage_kind", session.blockageKind(),
                "sub_branch", session.subBranch());
    }

    private static LlmTokens tokens(GeneratedText generated) {
        if (generated.usage() == null) {
            return LlmTokens.unknown();
        }
        return LlmTokens.of(
                generated.usage().prompt(),
                generated.usage().completion(),
                generated.usage().total());
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
