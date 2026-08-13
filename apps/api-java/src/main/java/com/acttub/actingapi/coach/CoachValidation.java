package com.acttub.actingapi.coach;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record CoachValidation(
        Map<String, Boolean> checks,
        List<String> failures,
        List<String> forbiddenHits) {

    public CoachValidation {
        checks = Collections.unmodifiableMap(new LinkedHashMap<>(checks));
        failures = List.copyOf(failures);
        forbiddenHits = List.copyOf(forbiddenHits);
    }
}
