package com.acttub.actingapi.integration.observation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 저장된 모델 출력의 새 팩과 구형 분리 배열을 같은 관찰 형태로 읽는다. */
public final class StoredObservationPack {
    private StoredObservationPack() {
    }

    public static JsonNode read(JsonNode raw, JsonNode observations, JsonNode uncertainties) {
        // 빈 관찰 배열도 새 팩이 내린 결과다. 오래된 분리 값을 합치지 않는다.
        if (raw != null && raw.isObject() && raw.path("observations").isArray()) {
            return raw;
        }
        ObjectNode pack = JsonNodeFactory.instance.objectNode();
        pack.set("observations", raw != null && raw.isArray() && !raw.isEmpty()
                ? raw : arrayOrEmpty(observations));
        pack.set("uncertainties", arrayOrEmpty(uncertainties));
        return pack;
    }

    private static JsonNode arrayOrEmpty(JsonNode value) {
        return value != null && value.isArray() ? value : JsonNodeFactory.instance.arrayNode();
    }
}
