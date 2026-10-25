package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.ReadingExampleAudio;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * {@code reading_examples.audio}(V62) 글을 푼다: {@code {"prefix", "voices": {이름: 프리셋}, "lines": [{"seq","key","duration_ms"}]}}.
 * 모양이 틀리면 {@link IllegalArgumentException} — 운영 SQL 로 고친 칸이 깨졌다는 뜻이다.
 */
final class ReadingExampleAudioJson {
    private ReadingExampleAudioJson() {
    }

    /** @return {@code json} 이 {@code null} 이면 {@code null}(미리 만든 음성 없음) */
    static ReadingExampleAudio parse(ObjectMapper mapper, String json) {
        if (json == null) {
            return null;
        }
        JsonNode root;
        try {
            root = mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("audio is not JSON", e);
        }
        if (root == null || !root.isObject() || !root.path("voices").isObject() || !root.path("lines").isArray()) {
            throw new IllegalArgumentException("audio must be an object with voices and lines");
        }
        JsonNode prefix = root.path("prefix");
        if (!prefix.isMissingNode() && !prefix.isNull() && !prefix.isTextual()) {
            throw new IllegalArgumentException("audio prefix must be text");
        }
        Map<String, String> voices = new LinkedHashMap<>();
        root.path("voices").properties().forEach(entry -> {
            if (!entry.getValue().isTextual()) {
                throw new IllegalArgumentException("audio voice must be text: " + entry.getKey());
            }
            voices.put(entry.getKey(), entry.getValue().textValue());
        });
        List<ReadingExampleAudio.Line> lines = new ArrayList<>();
        for (JsonNode line : root.path("lines")) {
            if (!line.path("seq").isIntegralNumber() || !line.path("key").isTextual() || !line.path("duration_ms").isIntegralNumber()) {
                throw new IllegalArgumentException("audio line needs seq, key and duration_ms: " + line);
            }
            lines.add(new ReadingExampleAudio.Line(line.path("seq").intValue(), line.path("key").textValue(),
                    line.path("duration_ms").intValue()));
        }
        return new ReadingExampleAudio(prefix.isTextual() ? prefix.textValue() : null, voices, lines);
    }
}
