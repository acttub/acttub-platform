package com.acttub.actingapi.practice;

import java.io.IOException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

final class CanonicalJson {
    private final ObjectMapper mapper;

    CanonicalJson(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    byte[] bytes(Object value) {
        Object sortable = value instanceof JsonNode node
                ? mapper.convertValue(node, Object.class)
                : value;
        try {
            return mapper.writer()
                    .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                    .writeValueAsBytes(sortable);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot encode canonical JSON", exception);
        }
    }
}
