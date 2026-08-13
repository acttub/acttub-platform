package com.acttub.actingapi.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

class TranscriptionPromptParityTest {
    private static final Pattern PROMPT = Pattern.compile(
            "TRANSCRIPTION_SYSTEM_PROMPT = \"\"\"([\\s\\S]*?)\"\"\"");

    @Test
    void promptMatchesPythonSourceByteForByte() throws Exception {
        Path source = Path.of("../api/acting-api/src/acting_api/analysis_worker.py");
        Matcher matcher = PROMPT.matcher(Files.readString(source, StandardCharsets.UTF_8));
        assertThat(matcher.find()).isTrue();
        assertThat(SummaryAnalyzer.TRANSCRIPTION_SYSTEM_PROMPT).isEqualTo(matcher.group(1));
    }
}
