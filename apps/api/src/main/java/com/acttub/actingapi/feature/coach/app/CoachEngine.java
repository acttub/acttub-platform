package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.coach.domain.RepeatedQuestion;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TextValidation;
import com.acttub.actingapi.integration.llm.TextValidator;
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
        String latest = firstActorMessage(session);
        CoachReply response = generateValidated(session, latest);
        return appendTurns(session, latest, response);
    }

    /**
     * 첫 사용자 메시지. 막힘 상세 → 목표 → 막힘 대분류 순으로 떨어진다.
     *
     * <p>이 값은 <b>배우의 발화로 대화 이력에 남는다.</b> 그래서 사슬 끝이 막힘 대분류다 —
     * 장면을 건너뛴 세션은 목표까지 비어 배우가 아무 말도 안 한 채로 대화가 열리는데,
     * 대분류는 배우가 실제로 고른 유일한 값이라 거짓이 남지 않는다(ADR-021).
     *
     * <p>대분류가 비어 사슬이 값에 못 닿는 일은 <b>이 파일이 막지 않는다</b> — 요청 검증
     * ({@code BlockageBranch.KINDS})과 {@code practice_sessions} 의 CHECK 제약이 값을
     * 보장한다. 막힘은 건너뛸 수 없다는 결정이 그 보장의 근거다.
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

    /**
     * 만든다 → 검사한다 → 걸리면 무엇에 걸렸는지 붙여 한 번 다시 만든다 → 그래도 걸리면
     * 안전 문장. 검사는 출력 검사 3종({@link TextValidator})에 <b>되풀이 검사</b>를 더한
     * 넷이다 — 같은 세션에서 이미 물은 질문을 다시 내면 통과하지 못한다. 호출 횟수는
     * 되풀이 검사를 더하기 전과 같다(최대 2회).
     *
     * <p>결과를 로그 한 줄로 남긴다({@code coach_turn_validation}). 통과·재생성 통과·안전
     * 문장 대체의 비율이 주간 품질 지표(폴백률·반복 질문율)의 원본이다.
     */
    private CoachReply generateValidated(
            CoachSessionSnapshot session, String userMessage) {
        String systemPrompt = CoachPrompt.select(session.blockageKind());
        GeneratedText generated = generate.generate(
                systemPrompt, CoachPrompt.buildChat(session, userMessage));
        String rawText = generated.text();
        CoachReply reply = parseCoachingResponse(rawText);
        List<String> failures = failuresOf(session, reply);
        String firstFailures = String.join(" | ", failures);
        if (!failures.isEmpty()) {
            generated = generate.generate(
                    systemPrompt,
                    CoachPrompt.buildRegeneration(
                            session,
                            userMessage,
                            rawText,
                            failures));
            reply = parseCoachingResponse(generated.text());
            failures = failuresOf(session, reply);
        }
        if (!failures.isEmpty()) {
            LOG.info("coach_turn_validation session={} outcome=fallback first_failures=\"{}\" second_failures=\"{}\"",
                    session.sessionId(), firstFailures, String.join(" | ", failures));
            return new CoachReply(CoachPrompt.safeTemplate(), "continue", null);
        }
        LOG.info("coach_turn_validation session={} outcome={} first_failures=\"{}\"",
                session.sessionId(), firstFailures.isEmpty() ? "pass" : "regen_pass", firstFailures);
        return sanitizeActorWords(reply);
    }

    /** 출력 검사 3종의 실패 문구에 되풀이 실패 문구를 잇는다. 순서가 재생성 프롬프트의 번호다. */
    private static List<String> failuresOf(CoachSessionSnapshot session, CoachReply reply) {
        TextValidation validation = TextValidator.validateTurn(reply.message(), false);
        List<String> failures = new ArrayList<>(validation.failures());
        repeatFailure(session, reply).ifPresent(failures::add);
        return failures;
    }

    /**
     * 마무리 응답(complete)은 보지 않는다 — 질문이 아니라 정리이고, 다시 만들면 handoff 를
     * 잃는다. 되풀이로 판정되면 <b>무엇을 되풀이했는지</b>를 문구에 그대로 넣는다.
     * 그냥 "다시" 가 아니라 이미 물은 질문을 보여 줘야 다른 각도가 나온다.
     */
    private static Optional<String> repeatFailure(CoachSessionSnapshot session, CoachReply reply) {
        if ("complete".equals(reply.status())) {
            return Optional.empty();
        }
        return RepeatedQuestion.find(reply.message(), session.turns())
                .map(match -> "같은 질문을 되풀이했습니다: \"" + match.earlier() + "\". "
                        + "배우의 마지막 답에서 아직 다루지 않은 부분 하나를 골라 "
                        + "다른 각도로 하나만 묻습니다.");
    }

    private static CoachResult appendTurns(
            CoachSessionSnapshot session, String actorText, CoachReply reply) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        turns.add(new CoachTurnSnapshot("actor", actorText));
        turns.add(new CoachTurnSnapshot("ai", reply.message()));
        return new CoachResult(session.withTurns(turns), reply);
    }
}
