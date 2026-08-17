package com.acttub.actingapi.feature.analysis.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public final class TranscriptSegments {
    private static final Pattern NEWLINES = Pattern.compile("\\n+");
    private static final Pattern SENTENCES = Pattern.compile("(?<=[.!?。！？])\\s+(?=\\S)");

    private TranscriptSegments() {
    }

    public static List<String> fromText(String text) {
        String normalized = text.replace("\r\n", "\n").replace('\r', '\n');
        List<String> segments = new ArrayList<>();
        for (String line : NEWLINES.split(normalized)) {
            for (String sentence : SENTENCES.split(line)) {
                String stripped = sentence.strip();
                if (!stripped.isEmpty()) {
                    segments.add(stripped);
                }
            }
        }
        return List.copyOf(segments);
    }
}
