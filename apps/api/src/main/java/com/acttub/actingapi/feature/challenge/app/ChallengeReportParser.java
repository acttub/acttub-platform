package com.acttub.actingapi.feature.challenge.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Comparison;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Evidence;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Result;
import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 모델 출력을 결과로 옮기며 검사한다 (challenge.ai-report). 모양이 틀리거나 금지 어휘가 들었으면 {@link Rejected} 로
 * 거절해 저장하지 않는다 — 워커가 그 실행을 한 번으로 세고 다시 만든다.
 */
public final class ChallengeReportParser {
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 저장하면 안 되는 출력. {@code reason} 은 실패 분류다. */
    public static final class Rejected extends RuntimeException {
        private final String reason;
        public Rejected(String reason, String message) { super(message); this.reason = reason; }
        public String reason() { return reason; }
    }

    private ChallengeReportParser() { }

    /** @param labels 표본 라벨 → 참여작 id. 표본이 부족하면 견주기를 버리고 한계에 안내를 적는다 */
    public static Result parse(String text, Map<String, UUID> labels) {
        JsonNode root;
        try {
            String body = text == null ? "" : text.strip();
            if (body.startsWith("```")) body = body.replaceAll("^```[a-zA-Z]*\\s*", "").replaceAll("```\\s*$", "");
            root = JSON.readTree(body);
        } catch (Exception malformed) {
            throw new Rejected("parse", "report output is not JSON");
        }
        if (root == null || !root.isObject()) throw new Rejected("parse", "report output is not an object");
        var observations = new ArrayList<Evidence>();
        for (JsonNode item : root.path("observations")) {
            int start = item.path("start_ms").asInt(-1);
            int end = item.path("end_ms").asInt(-1);
            String said = text(item.path("text"));
            if (start < 0 || end < start || said == null) continue;
            observations.add(new Evidence(start, end, said));
        }
        if (observations.isEmpty()) throw new Rejected("parse", "report has no observation");
        boolean compare = labels.size() >= ChallengeReportRules.MIN_SAMPLES;
        var comparisons = new ArrayList<Comparison>();
        if (compare) {
            for (JsonNode item : root.path("comparisons")) {
                String said = text(item.path("text"));
                var used = new ArrayList<UUID>();
                item.path("samples").forEach(label -> {
                    UUID id = labels.get(label.asText());
                    if (id != null && !used.contains(id)) used.add(id);
                });
                if (said != null && !used.isEmpty()) comparisons.add(new Comparison(said, List.copyOf(used)));
            }
        }
        var limits = new ArrayList<String>();
        if (!compare) limits.add(ChallengeReportRules.TOO_FEW_SAMPLES);
        root.path("limits").forEach(item -> { String said = text(item); if (said != null) limits.add(said); });
        String suggestion = text(root.path("suggestion"));
        var every = new ArrayList<String>();
        observations.forEach(item -> every.add(item.text()));
        comparisons.forEach(item -> every.add(item.text()));
        every.addAll(limits);
        if (suggestion != null) every.add(suggestion);
        for (String said : every) {
            String word = ChallengeReportRules.forbiddenWord(said);
            if (word != null) throw new Rejected("forbidden_words", "report output contains a forbidden word");
        }
        return new Result(List.copyOf(observations), List.copyOf(comparisons), List.copyOf(limits), suggestion,
                compare ? List.copyOf(labels.values()) : List.of());
    }

    private static String text(JsonNode node) {
        if (node == null || !node.isTextual()) return null;
        String value = node.asText().strip();
        return value.isEmpty() || "null".equals(value) ? null : value;
    }
}
