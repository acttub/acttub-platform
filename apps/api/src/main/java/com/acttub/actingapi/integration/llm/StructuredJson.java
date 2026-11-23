package com.acttub.actingapi.integration.llm;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import com.acttub.actingapi.platform.json.LenientJson;
import tools.jackson.databind.json.JsonMapper;

/** 모델 출력과 저장 정본에 같은 JSON Schema를 적용한다. 외부 참조는 사용하지 않는다. */
public final class StructuredJson {
    public static final ObjectMapper MAPPER = JsonMapper.builderWithJackson2Defaults()
            .enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();
    private static final JsonNode CONTRACTS = resource("/coaching/three-layer-contracts.schema.json");
    private static final SchemaRegistry SCHEMAS = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);
    private static final ConcurrentHashMap<String, Schema> VALIDATORS = new ConcurrentHashMap<>();

    private StructuredJson() {
    }

    public static JsonNode parse(String text) {
        if (text == null || text.length() > 1_500_000) {
            throw new IllegalArgumentException("missing or oversized JSON output");
        }
        try {
            JsonNode value = MAPPER.readTree(text);
            if (value == null || !value.isObject()) {
                throw new IllegalArgumentException("JSON output must be an object");
            }
            return value;
        } catch (JacksonException error) {
            throw new IllegalArgumentException("invalid JSON output", error);
        }
    }

    public static void validate(String definition, JsonNode value) {
        Schema validator = VALIDATORS.computeIfAbsent(definition, name -> SCHEMAS.getSchema(schema(name)));
        var errors = validator.validate(value);
        if (!errors.isEmpty()) {
            // 모델 원문/사용자 내용은 예외에 복사하지 않는다.
            throw new IllegalArgumentException("output does not satisfy " + definition);
        }
    }

    public static ObjectNode schema(String definition) {
        JsonNode root = CONTRACTS.path("$defs").get(definition);
        if (root == null) {
            throw new IllegalArgumentException("unknown output contract: " + definition);
        }
        ObjectNode result = (ObjectNode) root.deepCopy();
        ObjectNode definitions = MAPPER.createObjectNode();
        collect(root, definitions, new HashSet<>());
        result.set("$defs", definitions);
        result.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        return result;
    }

    public static String instructions(String prompt, String definition) {
        return prompt + "\n\n출력 계약의 실제 JSON Schema:\n" + schema(definition);
    }

    public static JsonNode resource(String path) {
        try (var input = StructuredJson.class.getResourceAsStream(path)) {
            if (input == null) {
                throw new IllegalStateException("missing JSON resource: " + path);
            }
            return MAPPER.readTree(input);
        } catch (IOException | JacksonException error) {
            throw new IllegalStateException("cannot read JSON resource: " + path, error);
        }
    }

    public static String textResource(String path) {
        try (var input = StructuredJson.class.getResourceAsStream(path)) {
            if (input == null) {
                throw new IllegalStateException("missing prompt resource: " + path);
            }
            return new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new IllegalStateException("cannot read prompt resource: " + path, error);
        }
    }

    private static void collect(JsonNode node, ObjectNode target, Set<String> visited) {
        if (node.isObject() && node.has("$ref")) {
            String ref = LenientJson.asText(node.path("$ref"));
            if (!ref.startsWith("#/$defs/")) {
                throw new IllegalStateException("external schema references are not allowed");
            }
            String name = ref.substring("#/$defs/".length());
            if (visited.add(name)) {
                JsonNode definition = CONTRACTS.path("$defs").get(name);
                if (definition == null) {
                    throw new IllegalStateException("missing schema definition: " + name);
                }
                target.set(name, definition.deepCopy());
                collect(definition, target, visited);
            }
        }
        if (node.isContainer()) {
            node.forEach(child -> collect(child, target, visited));
        }
    }
}
