package com.acttub.actingapi.feature.analysis.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OpenAiAudioTranscriberTest {

    @TempDir
    Path temporary;

    @Test
    void sendsGoldenMultipartFieldsFilenameContentTypeAndDefaultModel() throws Exception {
        Path audio = Files.writeString(temporary.resolve("random-name.bin"), "voice");
        List<OpenAiAudioTranscriber.TranscriptionRequest> requests = new ArrayList<>();
        OpenAiAudioTranscriber client = new OpenAiAudioTranscriber(
                new ObjectMapper(),
                request -> {
                    requests.add(request);
                    return new OpenAiAudioTranscriber.TranscriptionResponse(
                            200, "{\"text\":\"받아쓴 대사\"}");
                },
                duration -> { },
                name -> Map.of("OPENAI_API_KEY", "key").get(name));

        assertThat(client.transcribe(audio, "전사 규칙")).isEqualTo("받아쓴 대사");

        assertThat(requests).hasSize(1);
        var request = requests.getFirst();
        assertThat(request.uri()).isEqualTo(OpenAiAudioTranscriber.TRANSCRIPTIONS_URI);
        assertThat(request.model()).isEqualTo("gpt-transcribe");
        assertThat(request.responseFormat()).isEqualTo("json");
        assertThat(request.prompt()).isEqualTo("전사 규칙");
        assertThat(request.fileField()).isEqualTo("file");
        assertThat(request.fileName()).isEqualTo("audio.mp3");
        assertThat(request.fileContentType()).isEqualTo("audio/mpeg");
        assertThat(request.audioPath()).isEqualTo(audio);
    }

    @Test
    void retriesOnlyBusyStatusesWithOneTwoFourSecondBackoff() throws Exception {
        Path audio = Files.writeString(temporary.resolve("audio.mp3"), "voice");
        List<Duration> delays = new ArrayList<>();
        int[] calls = {0};
        OpenAiAudioTranscriber client = new OpenAiAudioTranscriber(
                new ObjectMapper(),
                request -> {
                    calls[0]++;
                    return calls[0] < 4
                            ? new OpenAiAudioTranscriber.TranscriptionResponse(503, "{}")
                            : new OpenAiAudioTranscriber.TranscriptionResponse(200, "{\"text\":\"ok\"}");
                },
                delays::add,
                name -> "OPENAI_API_KEY".equals(name) ? "key" : null);

        assertThat(client.transcribe(audio, "prompt")).isEqualTo("ok");
        assertThat(calls[0]).isEqualTo(4);
        assertThat(delays).containsExactly(
                Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(4));
    }
}
