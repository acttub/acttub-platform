package com.acttub.actingapi.llm;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record TextValidation(
        Map<String, Boolean> checks,
        List<String> failures,
        List<String> forbiddenHits) {

    public TextValidation {
        checks = Collections.unmodifiableMap(new LinkedHashMap<>(checks));
        failures = List.copyOf(failures);
        forbiddenHits = List.copyOf(forbiddenHits);
    }
}
