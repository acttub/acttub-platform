package com.acttub.actingapi.feature.reading.app;

import com.acttub.actingapi.feature.reading.app.RetranscribeRepository.Claimed;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * 기기 음성 인식이 빈 결과를 낸 리딩 줄 녹음을 서버가 뒤에서 다시 받아쓴다. 하나씩 임대로 집고, 내려받기·소리 재기·받아쓰기는
 * 트랜잭션 밖에서 한다.
 *
 * <p>순서: 녹음이 바뀌었으면 건너뜀(stale) → 너무 길면 건너뜀(too_long) → 하루 한도를 넘었으면 미룸 →
 * 내려받기 → 가장 큰 소리가 기준보다 작으면 모델에 보내지 않음(silent) → 받아쓰기 → 글이 없으면 empty, 있으면 녹음의 전사와
 * 대조를 채움(done). 리딩 진행·자동 넘김은 기기에서 이미 끝났으므로 여기서 늦어져도 배우는 기다리지 않는다.
 */
public class RetranscribeWorker {
    private static final Logger LOGGER = Logger.getLogger(RetranscribeWorker.class.getName());
    private static final Duration DAY = Duration.ofHours(24);

    private final RetranscribeRepository queue;
    private final PronunciationAudio storage;
    private final RetranscribeAudio audio;
    private final RetranscribeSettings settings;
    private final Clock clock;

    public RetranscribeWorker(RetranscribeRepository queue, PronunciationAudio storage, RetranscribeAudio audio,
            RetranscribeSettings settings, Clock clock) {
        this.queue = queue;
        this.storage = storage;
        this.audio = audio;
        this.settings = settings;
        this.clock = clock;
    }

    /** @return 하나를 집어 끝냈으면 {@code true}. 집을 것이 없거나, 하루 한도로 미뤘거나, 실패했으면 {@code false} */
    public boolean runOnce() {
        if (!settings.enabled()) {
            return false;
        }
        UUID token = UUID.randomUUID();
        Claimed claimed = queue.claimNext(token, settings.lease(), settings.maxAttempts(), clock.instant());
        if (claimed == null) {
            return false;
        }
        if (!claimed.current()) {
            queue.finish(claimed.recordingId(), token, "stale", null, clock.instant());
            return true;
        }
        if (claimed.durationMs() != null && claimed.durationMs() > settings.maxDurationMs()) {
            queue.finish(claimed.recordingId(), token, "too_long", null, clock.instant());
            return true;
        }
        Instant now = clock.instant();
        if (queue.transcribedSince(now.minus(DAY)) >= settings.dailyLimit()) {
            queue.release(claimed.recordingId(), token, now);
            return false;
        }
        Path temp = null;
        try {
            // 배우의 목소리라 주인만 읽고 쓰게 만든다.
            temp = Files.createTempFile("retranscribe-", ".m4a",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            storage.download(claimed.objectKey(), temp);
            double peak = audio.peakDb(temp);
            Double stored = Double.isFinite(peak) ? peak : null;
            if (peak < settings.minPeakDb()) {
                queue.finish(claimed.recordingId(), token, "silent", stored, clock.instant());
                return true;
            }
            queue.markTranscribing(claimed.recordingId(), token, clock.instant());
            String text = audio.transcribe(temp);
            if (text == null || text.isBlank()) {
                queue.finish(claimed.recordingId(), token, "empty", stored, clock.instant());
                return true;
            }
            queue.fill(claimed.recordingId(), token, claimed.objectKey(), text.strip(), stored, clock.instant());
            return true;
        } catch (RuntimeException | IOException failure) {
            boolean retry = claimed.attempt() < settings.maxAttempts();
            LOGGER.warning("reading retranscribe failed: recording=" + claimed.recordingId() + " attempt="
                    + claimed.attempt() + " retry=" + retry + " cause=" + failure.getClass().getSimpleName());
            queue.fail(claimed.recordingId(), token, failure.getClass().getSimpleName(), retry, clock.instant());
            // 바깥 서비스가 죽었으면 쌓인 것을 한꺼번에 실패시키지 않게 이번 주기는 여기서 멈춘다.
            return false;
        } finally {
            if (temp != null) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                    // 임시 파일은 다음 기동의 정리에 맡긴다.
                }
            }
        }
    }
}
