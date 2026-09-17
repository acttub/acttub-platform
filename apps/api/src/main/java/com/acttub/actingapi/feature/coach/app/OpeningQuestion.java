package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;

/** Shared opening policy; these checks enforce form and grounding, not semantic coaching quality. */
final class OpeningQuestion {
    static final String PROMPT = StructuredJson.textResource("/coach/coach-opening-policy.txt");
    private static final Pattern QUOTED = Pattern.compile("“[^”]*”|‘[^’]*’|\"[^\"]*\"|'[^']*'");
    private static final Pattern VAGUE_READING = Pattern.compile(
            "말(?:의|에\\s*담긴)\\s*무게|(?:처럼|으로|로)\\s*읽(?:혀|혔|히|힌|힐|힘)");

    private OpeningQuestion() { }

    static long questionCount(String message) {
        // A question in quoted dialogue is not a question directed to the actor.
        return QUOTED.matcher(message).replaceAll("").codePoints().filter(c -> c == '?' || c == '？').count();
    }

    static boolean vagueReading(String message) {
        return VAGUE_READING.matcher(message).find();
    }

    static List<String> failures(String message) {
        List<String> failures = new ArrayList<>();
        if (questionCount(message) > 1) failures.add("첫 응답의 질문은 최대 하나다. 설명만으로 도움을 줄 수 있으면 질문하지 않는다. 인용한 대사의 물음표는 질문이 아니다.");
        if (vagueReading(message)) failures.add("첫 응답에서 말의 무게·처럼 읽힌다는 해석을 붙이지 않는다. 구체적인 영상 근거로 설명하고 질문은 꼭 필요할 때만 한다.");
        return failures;
    }

    static boolean videoSource(JsonNode source) {
        return source != null && !source.path("text").asText().isBlank()
                && List.of("video_observation", "video_utterance").contains(source.path("kind").asText());
    }

    static boolean legacyOpening(CoachSessionSnapshot session) {
        return CoachBranch.isBlockageUnspecified(session.blockageKind()) && CoachPrompt.turnNumber(session) == 1;
    }

    static boolean legacyMaterial(CoachSessionSnapshot session) {
        if (session.observationPack() == null) return false;
        // Legacy transcripts are not sent in CoachPrompt.videoFacts; use only delivered material.
        if (!session.observationPack().path("speech").path("transcript").asText().isBlank()) return true;
        for (JsonNode observation : session.observationPack().path("observations")) {
            if (!observation.path("what").asText().isBlank() || !observation.path("quote").asText().isBlank()) return true;
        }
        return false;
    }

    static String fallback(boolean english) {
        return english ? "I couldn’t prepare a grounded explanation of this video."
                : "영상에 근거한 설명을 준비하지 못했어요.";
    }
}
