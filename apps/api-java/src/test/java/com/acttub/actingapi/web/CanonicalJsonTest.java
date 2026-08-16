package com.acttub.actingapi.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class CanonicalJsonTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final CanonicalJson canonical = new CanonicalJson(mapper);

    @Test
    void fingerprintBytesMatchThePythonCanonicalJsonRule() throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("upload_intent_id", "00000000-0000-4000-8000-000000000777");
        payload.put("situation", "상황");
        payload.put("character_context", "인물");
        payload.put("goal", "목표");
        payload.put("blockage_kind", "분석");
        payload.put("sub_branch", "대사 분석");
        payload.put("blockage_detail", null);

        byte[] bytes = canonical.bytes(Map.of("kind", "analyze", "payload", payload));

        assertThat(HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(bytes)))
                .isEqualTo("87093cf0dcab493be1bb7473a637166ede992ba0a7869145378992e99eb5cdc8");
        assertThat(new String(bytes, StandardCharsets.UTF_8))
                .contains("분석")
                .doesNotContain("\\u");
    }

    @Test
    void storedJsonNodesAreSortedRecursivelyWithoutWhitespace() throws Exception {
        byte[] bytes = canonical.bytes(mapper.readTree(
                "{\"한국어\":{\"나\":2,\"가\":1},\"status\":\"analyzed\"}"));

        assertThat(new String(bytes, StandardCharsets.UTF_8))
                .isEqualTo("{\"status\":\"analyzed\",\"한국어\":{\"가\":1,\"나\":2}}");
    }
}
