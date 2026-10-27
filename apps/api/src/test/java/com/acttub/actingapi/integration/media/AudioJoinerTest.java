package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

/** 리딩 녹음 코칭(SOMA-791): 녹음을 순서대로 16kHz 모노 WAV 하나로 잇고, 줄마다 뒤에 빈 소리를 붙인다. */
class AudioJoinerTest {
    @Test
    void joinsEveryClipInOrderWithAGapAfterEach() {
        List<String> command = AudioJoiner.command(List.of(Path.of("/t/a.m4a"), Path.of("/t/b.m4a")), 600, Path.of("/t/out.wav"));
        assertThat(command).containsSubsequence("-i", "/t/a.m4a", "-i", "/t/b.m4a", "-filter_complex");
        String filter = command.get(command.indexOf("-filter_complex") + 1);
        assertThat(filter).isEqualTo("[0:a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono,apad=pad_dur=0.600[a0];"
                + "[1:a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono,apad=pad_dur=0.600[a1];"
                + "[a0][a1]concat=n=2:v=0:a=1[out]");
        assertThat(command).endsWith("-c:a", "pcm_s16le", "-threads", "1", "/t/out.wav");
    }
}
