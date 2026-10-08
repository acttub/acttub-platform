package com.acttub.actingapi.feature.audition.app;

import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionRules;

/**
 * {@code AUDITION_ENABLED}(기본 false)와 {@code AUDITION_SOURCES}(기본 {@value AuditionRules#DEFAULT_SOURCES}).
 * 꺼져 있으면 수집하지 않고 목록은 비어 있다.
 */
public record AuditionSettings(boolean enabled, List<String> sources) {

    public AuditionSettings {
        sources = List.copyOf(sources);
    }

    public static AuditionSettings of(boolean enabled, String sourcesCsv) {
        return new AuditionSettings(enabled, AuditionRules.enabledSources(sourcesCsv));
    }
}
