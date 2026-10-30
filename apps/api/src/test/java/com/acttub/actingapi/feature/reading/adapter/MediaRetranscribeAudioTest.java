package com.acttub.actingapi.feature.reading.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;

import com.acttub.actingapi.integration.media.AudioPeak;
import com.acttub.actingapi.integration.observation.SpeechAnalysis;
import org.junit.jupiter.api.Test;

/** 받아쓰기 결과를 글로 넘기고, 결과가 없으면 빈 글이다. 리딩 녹음은 코칭 회차 id 없이 부른다. */
class MediaRetranscribeAudioTest {

    @Test
    void passesTheTranscriptWithoutASessionId() {
        Object[] seen = new Object[2];
        MediaRetranscribeAudio audio = new MediaRetranscribeAudio(new AudioPeak(), (path, session, user) -> {
            seen[0] = session;
            seen[1] = user;
            return new SpeechAnalysis("대사 하나", 3.0, List.of(), List.of());
        });
        assertThat(audio.transcribe(Path.of("line.m4a"))).isEqualTo("대사 하나");
        assertThat(seen).containsOnlyNulls();
    }

    @Test
    void missingResultIsBlank() {
        assertThat(new MediaRetranscribeAudio(new AudioPeak(), (path, session, user) -> null).transcribe(Path.of("a.m4a")))
                .isEmpty();
        assertThat(new MediaRetranscribeAudio(new AudioPeak(),
                (path, session, user) -> new SpeechAnalysis(null, 0, List.of(), List.of())).transcribe(Path.of("a.m4a")))
                .isEmpty();
    }
}
