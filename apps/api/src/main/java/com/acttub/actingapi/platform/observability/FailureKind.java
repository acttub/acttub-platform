package com.acttub.actingapi.platform.observability;

public enum FailureKind {
    EXTERNAL("external"),
    UNEXPECTED("unexpected");

    private final String tagValue;

    FailureKind(String tagValue) {
        this.tagValue = tagValue;
    }

    public String tagValue() {
        return tagValue;
    }
}
