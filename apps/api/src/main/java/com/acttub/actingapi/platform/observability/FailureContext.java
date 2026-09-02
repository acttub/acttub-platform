package com.acttub.actingapi.platform.observability;

import java.util.Objects;
import java.util.UUID;

public record FailureContext(String location, UUID operationId) {

    public FailureContext {
        Objects.requireNonNull(location, "location");
    }

    public FailureContext(String location) {
        this(location, null);
    }

    public String tagValue() {
        if (operationId == null) {
            return location;
        }
        return location + " operation_id=" + operationId;
    }
}
