package com.acttub.actingapi.integration.observation;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/** 단어 시각으로 계산한 값. rate와 편차는 계산 후에만 표시 자릿수로 반올림한다. */
public record SpeechAnalysis(
        String transcript,
        @JsonProperty("avg_syllables_per_sec") double avgSyllablesPerSec,
        List<Pause> pauses,
        List<Chunk> chunks) {

    public SpeechAnalysis {
        pauses = List.copyOf(pauses);
        chunks = List.copyOf(chunks);
    }

    public record Pause(
            @JsonProperty("at_ms") long atMs,
            double seconds,
            String after,
            String before) {
    }

    /** 발화시간이 0.4초 이하면 rate·deltaPct·mark는 null이다. */
    public record Chunk(
            @JsonProperty("start_ms") long startMs,
            @JsonProperty("end_ms") long endMs,
            Double rate,
            @JsonProperty("delta_pct") Integer deltaPct,
            String mark,
            String text) {
    }
}
