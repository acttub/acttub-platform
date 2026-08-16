package com.acttub.actingapi.coach;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    private static final Pattern CLOSING_STRIP = Pattern.compile(
            "[\\s.,!?~…·'\"]+", Pattern.UNICODE_CHARACTER_CLASS);
    // 이 넷은 발화 전체가 그 말일 때만 종료로 본다. "끝"은 한 글자라
    // "끝까지", "끝나고" 같은 정상 답변에 항상 걸린다.
    private static final Set<String> CLOSING_EXACT = Set.of("그만", "종료", "끝", "여기까지");
    // 짧은 발화 안에서만 부분 일치를 허용한다 ("여기서 그만할게").
    private static final List<String> CLOSING_LOOSE = List.of("그만", "종료");
    private static final int CLOSING_LOOSE_MAX_LEN = 10;
    // 원본은 loose 단어마다 정규식을 두지만 둘의 패턴이 같아 하나로 둔다.
    private static final Pattern CLOSING_LOOSE_ENDING = Pattern.compile(
            "^\\s*(?:(?:할게|할래)(?:요)?|하자|하고\\s*싶어요?|요|용)?[\\s.,!?~…·'\"]*$",
            Pattern.UNICODE_CHARACTER_CLASS);
    private static final Set<String> CLOSING_NEGATIONS = Set.of("안", "못");
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
        return isClosing(actorText) ? actorText + CLOSING_TURN_INSTRUCTION : actorText;
    }

    /**
     * 배우가 대화를 끝내겠다고 한 말인지 판정한다.
     *
     * <p>오탐이 미탐보다 훨씬 비싸다. 오탐이면 답변 도중에 세션이 끊기고, 미탐이면
     * 배우가 '그만'을 한 번 더 치면 된다. 그래서 길게 설명하는 문장은 종료로 보지 않는다.
     * 어절 경계 없는 오타 '그렇그만'으로 세션이 끊긴 사고가 있어 loose는 어절 시작만 본다.
     */
    static boolean isClosing(String text) {
        String stripped = CLOSING_STRIP.matcher(text).replaceAll("");
        if (CLOSING_EXACT.contains(stripped)) {
            return true;
        }
        if (stripped.length() > CLOSING_LOOSE_MAX_LEN) {
            return false;
        }
        for (String word : CLOSING_LOOSE) {
            int start = text.indexOf(word);
            while (start != -1) {
                if (start == 0 || Character.isWhitespace(text.charAt(start - 1))) {
                    String previousWord = previousWord(text.substring(0, start));
                    String ending = text.substring(start + word.length());
                    if (!CLOSING_NEGATIONS.contains(previousWord)
                            && CLOSING_LOOSE_ENDING.matcher(ending).matches()) {
                        return true;
                    }
                }
                start = text.indexOf(word, start + word.length());
            }
        }
        return false;
    }

    /** 종료어 바로 앞 어절에서 구두점을 걷어낸 값. 앞이 비었으면 빈 문자열이다. */
    private static String previousWord(String head) {
        String trimmed = head.stripTrailing();
        if (trimmed.isEmpty()) {
            return "";
        }
        int boundary = -1;
        for (int i = trimmed.length() - 1; i >= 0; i--) {
            if (Character.isWhitespace(trimmed.charAt(i))) {
                boundary = i;
                break;
            }
        }
        return CLOSING_STRIP.matcher(trimmed.substring(boundary + 1)).replaceAll("");
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
            if (word.isTextual() && !isClosing(word.textValue())) {
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
