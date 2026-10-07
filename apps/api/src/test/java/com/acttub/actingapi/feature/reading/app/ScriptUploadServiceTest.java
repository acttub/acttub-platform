package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 읽기의 동시 수·시간 상한 (reading.script 「원본 파일」). 받기가 끝나지 않는 스토리지로 본다. */
class ScriptUploadServiceTest {
    private static final UUID USER = UUID.randomUUID();
    private final CountDownLatch release = new CountDownLatch(1);

    @Test
    @DisplayName("reading.script 원본: 받기·뽑기가 시간 상한을 넘으면 422 script_file_unreadable, 끊긴 일이 자리를 쥔 동안 다음 읽기는 자리를 기다리다 429 script_upload_busy")
    void readsAreBoundedInTimeAndConcurrency() {
        ScriptUploadService service = new ScriptUploadService(new Uploads(), null, new StuckStorage(), null,
                Clock.fixed(Instant.parse("2026-10-06T03:00:00Z"), ZoneOffset.UTC),
                new ScriptUploadService.ReadLimits(1, Duration.ofMillis(200), Duration.ofMillis(300)));

        long started = System.nanoTime();
        ApiException slow = catchThrowableOfType(ApiException.class, () -> service.read(USER, UUID.randomUUID()));
        assertThat(slow.status()).isEqualTo(422);
        assertThat(slow.getMessage()).isEqualTo("script_file_unreadable");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));

        ApiException busy = catchThrowableOfType(ApiException.class, () -> service.read(USER, UUID.randomUUID()));
        assertThat(busy.status()).isEqualTo(429);
        assertThat(busy.getMessage()).isEqualTo("script_upload_busy");
        release.countDown();
    }

    /** 끊어도(interrupt) 멈추지 않는 받기 — 자리를 계속 쥔다. */
    private final class StuckStorage implements ScriptFileStorage {
        @Override public void requireConfigured() {
        }

        @Override public String presignUpload(String objectKey, String contentType, long byteSize, int expiresInSeconds) {
            throw new UnsupportedOperationException();
        }

        @Override public Long size(String objectKey) {
            return 10L;
        }

        @Override public void download(String objectKey, Path destination) {
            while (release.getCount() > 0) {
                try {
                    release.await();
                } catch (InterruptedException ignored) {
                    // 일부러 끊김을 무시한다.
                }
            }
        }
    }

    private static final class Uploads implements ScriptUploadRepository {
        @Override public void reserve(UUID userId, UUID uploadId, String objectKey, long byteSize, Instant expiresAt, Instant now) {
            throw new UnsupportedOperationException();
        }

        @Override public Upload find(UUID userId, UUID uploadId) {
            return new Upload(uploadId, "reading-source/" + userId + "/" + uploadId, 10, null, false, null);
        }

        @Override public void saveText(UUID uploadId, String rawText, Instant now) {
            throw new UnsupportedOperationException();
        }

        @Override public List<UUID> sweepUnlinked(Instant before, Instant now) {
            return List.of();
        }
    }
}
