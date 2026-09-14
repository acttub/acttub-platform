package com.acttub.actingapi.integration.observation;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/** 단어 시각으로 계산한 값. rate와 편차는 계산 후에만 표시 자릿수로 반올림한다. */
public record SpeechAnalysis(
        String transcript,
        @JsonProperty("avg_syllables_per_sec") double avgSyllablesPerSec,
        List<Pause> pauses,
        List<Chunk> chunks,
        @com.fasterxml.jackson.annotation.JsonIgnore List<SpeechFacts.Word> words) {

    public SpeechAnalysis {
        pauses = List.copyOf(pauses);
        chunks = List.copyOf(chunks);
        // 기존 저장 JSON에는 내부 계산용 words가 없고 @JsonIgnore이므로 null로 복원된다.
        words = words == null ? List.of() : List.copyOf(words);
    }

    public SpeechAnalysis(String transcript, double avgSyllablesPerSec, List<Pause> pauses, List<Chunk> chunks) {
        this(transcript, avgSyllablesPerSec, pauses, chunks, List.of());
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
