package com.acttub.actingapi.feature.challenge.app;

import java.util.Locale;
import java.util.Set;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 모델 출력을 판정으로 읽는다 (SOMA-907). 모양이 틀리면 던져 워커가 실패로 세고 다시 집게 한다. */
public final class EntryModerationParser {
    private static final ObjectMapper JSON = new ObjectMapper();
    static final Set<String> CATEGORIES =
            Set.of("none", "sexual", "violence", "self_harm", "hate", "harassment", "spam", "unrelated", "other");

    private EntryModerationParser() { }

    public static EntryModerationVerdict parse(String output) {
        if (output == null) throw new IllegalArgumentException("moderation output is empty");
        int start = output.indexOf('{');
        int end = output.lastIndexOf('}');
        if (start < 0 || end < start) throw new IllegalArgumentException("moderation output is not JSON");
        JsonNode root;
        try {
            root = JSON.readTree(output.substring(start, end + 1));
        } catch (Exception failure) {
            throw new IllegalArgumentException("moderation output is not JSON", failure);
        }
        if (root == null || !root.isObject()) throw new IllegalArgumentException("moderation output is not an object");
        Decision decision = switch (root.path("verdict").asText("").strip().toLowerCase(Locale.ROOT)) {
            case "pass" -> Decision.PASS;
            case "hide" -> Decision.HIDE;
            case "review" -> Decision.REVIEW;
            default -> throw new IllegalArgumentException("moderation verdict is unknown");
        };
        String category = root.path("category").asText("").strip().toLowerCase(Locale.ROOT);
        if (!CATEGORIES.contains(category)) category = decision == Decision.PASS ? "none" : "other";
        if (decision != Decision.PASS && "none".equals(category)) category = "other";
        String reason = root.path("reason").asText("").strip();
        return new EntryModerationVerdict(decision, category, reason.isEmpty() ? null : reason);
    }
}
