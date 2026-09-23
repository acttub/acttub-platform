package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 리딩 녹음의 형식 변환(reading.recording). 명령의 모양과 실패 정리는 흉내 낸 실행기로, 진짜 변환은 이 머신의 ffmpeg 로
 * 본다 — ffmpeg 가 없으면 그 하나는 건너뛰고 보고서에 남긴다.
 */
class AudioTranscoderTest {
    @TempDir Path temporary;

    @Test
    @DisplayName("reading.recording: m4a(AAC) 하나로 바꾸는 ffmpeg 명령을 한 스레드로 부르고 원본은 그대로 둔다")
    void transcodesToAacWithOneThreadAndPreservesTheSource() throws Exception {
        Path source = Files.writeString(temporary.resolve("line.webm"), "webm");
        var transcoder = new AudioTranscoder((command, timeout) -> {
            assertThat(command).containsExactly("ffmpeg", "-y", "-threads", "1", "-i", source.toString(),
                    "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-threads", "1", command.getLast());
            assertThat(command.getLast()).endsWith(".m4a");
            assertThat(timeout).isEqualTo(Duration.ofSeconds(120));
            Files.writeString(Path.of(command.getLast()), "m4a");
        });

        Path output = transcoder.toM4a(source);

        assertThat(output).exists().hasExtension("m4a").hasParent(source.toAbsolutePath().getParent());
        assertThat(source).hasContent("webm");
        Files.delete(output);
    }

    @Test
    @DisplayName("reading.recording: 변환이 실패하거나 빈 파일이면 부분 출력을 지우고 원인을 담아 던진다 — 기기가 같은 요청 id 로 다시 시도한다")
    void failedOrEmptyTranscodeRemovesPartialOutputAndRetainsTheCause() throws Exception {
        Path source = Files.writeString(temporary.resolve("line.webm"), "webm");
        var failure = new IOException("ffmpeg exited with status 1");
        var output = new AtomicReference<Path>();
        var transcoder = new AudioTranscoder((command, timeout) -> {
            output.set(Path.of(command.getLast()));
            Files.writeString(output.get(), "partial");
            throw failure;
        });
        assertThatThrownBy(() -> transcoder.toM4a(source)).isInstanceOf(AudioTranscoder.TranscodeFailed.class).hasCause(failure);
        assertThat(output.get()).doesNotExist();
        assertThat(source).exists();

        var empty = new AudioTranscoder((command, timeout) -> output.set(Path.of(command.getLast())));
        assertThatThrownBy(() -> empty.toM4a(source)).isInstanceOf(AudioTranscoder.TranscodeFailed.class)
                .hasRootCauseMessage("ffmpeg produced empty audio");
        assertThat(output.get()).doesNotExist();
    }

    /** 실제 ffmpeg — 1초짜리 webm/opus 를 만들어 m4a 로 바꾼다. ffmpeg 가 없으면 건너뛴다. */
    @Test
    @DisplayName("reading.recording: 웹에서 올린 webm/opus 가 m4a(AAC) 파일로 바뀐다 (실제 ffmpeg)")
    void aRealWebmOpusFileBecomesAnM4aContainer() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 실제 변환은 건너뛴다");
        Path webm = temporary.resolve("line.webm");
        int made = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-c:a", "libopus", webm.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD)
                .start().waitFor();
        assumeTrue(made == 0 && Files.size(webm) > 0, "ffmpeg 가 libopus 로 webm 을 만들지 못해 건너뛴다");

        Path m4a = new AudioTranscoder().toM4a(webm);

        assertThat(Files.size(m4a)).isPositive();
        byte[] head = Arrays.copyOfRange(Files.readAllBytes(m4a), 4, 8);
        assertThat(new String(head, StandardCharsets.US_ASCII)).as("MP4 계열 컨테이너의 ftyp 상자").isEqualTo("ftyp");
        Files.delete(m4a);
    }

    private static boolean ffmpegAvailable() {
        try {
            Process process = new ProcessBuilder(List.of("ffmpeg", "-version"))
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception missing) {
            return false;
        }
    }
}
