package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingRepository.NewRecording;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Precheck;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Stored;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 줄 단위 녹음의 규칙 — 검사·변환·저장을 한 요청으로 받고, 줄마다 다시 듣게 하고, 지운다 (reading.recording, ADR-031).
 *
 * <p>서버가 음성을 건드리는 유일한 일은 형식 변환이다: m4a(AAC)가 아니면 ffmpeg 로 바꿔 저장하고 내용은 읽지 않는다.
 * 올리기는 회차의 진행 상태와 분리된다 — completed·stopped 회차에도 소유권·줄·한도 검사를 통과하면 받는다.
 *
 * <p>순서: 한도(크기·길이) → 잠그지 않는 사전 확인(회차·줄·재전송·시도 번호) → 변환 → 객체 올림 → 회차 행을 잠근 최종
 * 저장(총량 포함). 최종 저장이 거절하면 방금 올린 객체는 장부가 지운다(apps/api/CONTRACT.md §5-4 — 바깥 호출은
 * 트랜잭션 밖이다). 여기서 거절하는 것은 규칙이고 본문은 사유 코드 하나다: {@code recording_too_long}·
 * {@code recording_quota}·{@code invalid_line}·{@code session_not_found}·{@code recording_not_found}, 변환 실패는
 * 503 {@code audio_conversion_failed}.
 */
public class RecordingService {

    private final RecordingRepository recordings;
    private final RecordingStorage storage;
    private final AudioTranscoder transcoder;
    private final RecordingPlayback playback;
    private final ReadingRecordingCleanup cleanup;
    private final Clock clock;

    public RecordingService(
            RecordingRepository recordings,
            RecordingStorage storage,
            AudioTranscoder transcoder,
            RecordingPlayback playback,
            ReadingRecordingCleanup cleanup,
            Clock clock) {
        this.recordings = recordings;
        this.storage = storage;
        this.transcoder = transcoder;
        this.playback = playback;
        this.cleanup = cleanup;
        this.clock = clock;
    }

    /**
     * @param upload 이미 임시 파일에 받아 둔 녹음. 파일은 부르는 쪽이 지운다
     * @return 만들었거나 대체했으면 {@code created=true}(201), 같은 요청 id 의 재전송이거나 더 작은 시도 번호면
     *         {@code created=false} 와 현재 값(200)
     */
    public Uploaded upload(UUID userId, boolean guest, UUID sessionId, Upload upload) {
        if (upload.fileSize() > RecordingRules.FILE_MAX_BYTES || upload.durationMs() > RecordingRules.DURATION_MAX_MS) {
            throw tooLong();
        }
        Precheck precheck = recordings.precheck(userId, sessionId, upload.lineId(), upload.requestId(), upload.attemptNo());
        switch (precheck.outcome()) {
            case NOT_FOUND -> throw sessionNotFound();
            case INVALID_LINE -> throw invalidLine();
            case REPLAYED, IGNORED -> {
                return new Uploaded(playback.decorate(precheck.current()), false);
            }
            default -> { }
        }
        storage.requireConfigured();
        String objectKey = RecordingRules.objectKey(userId, sessionId, upload.lineId(), upload.requestId());
        Path stored = null;
        try {
            stored = RecordingRules.alreadyM4a(upload.contentType()) ? upload.file() : transcode(upload.file());
            long byteSize = Files.size(stored);
            storage.upload(objectKey, RecordingRules.STORED_CONTENT_TYPE, stored);
            Stored result = recordings.store(userId, sessionId, new NewRecording(
                    upload.requestId(),
                    upload.lineId(),
                    upload.attemptNo(),
                    objectKey,
                    RecordingRules.STORED_CONTENT_TYPE,
                    byteSize,
                    upload.durationMs(),
                    upload.transcript(),
                    upload.transcriptSource(),
                    upload.matched()), RecordingRules.quotaBytes(guest), clock.instant());
            // 거절·대체·재전송으로 남은 객체는 장부에 있다 — 커밋 뒤에 바로 한 번 시도한다.
            cleanup.attempt(result.cleanupOperationIds());
            return switch (result.outcome()) {
                case NOT_FOUND -> throw sessionNotFound();
                case INVALID_LINE -> throw invalidLine();
                case QUOTA -> throw new ApiException(422, "recording_quota");
                case REPLAYED, IGNORED -> new Uploaded(playback.decorate(result.recording()), false);
                case CREATED, REPLACED -> new Uploaded(playback.decorate(result.recording()), true);
            };
        } catch (IOException failure) {
            throw new IllegalStateException("could not read the transcoded recording", failure);
        } finally {
            if (stored != null && !stored.equals(upload.file())) {
                try {
                    Files.deleteIfExists(stored);
                } catch (IOException ignored) {
                    // 임시 파일은 다음 기동의 정리에 맡긴다.
                }
            }
        }
    }

    /** 행과 객체를 지운다. 회차 진행·암기 상태는 그대로다. 객체 삭제는 장부가 커밋 뒤에 시도한다. */
    public void delete(UUID userId, UUID recordingId) {
        List<UUID> scheduled = recordings.delete(userId, recordingId, clock.instant());
        if (scheduled == null) {
            throw new ApiException(404, "recording_not_found");
        }
        cleanup.attempt(scheduled);
    }

    /**
     * ffmpeg 는 네트워크 의존이 아니라 External 이 아니고, 실패는 기기가 같은 요청 id 로 다시 시도한다. 행도 객체도
     * 만들지 않았다.
     */
    private Path transcode(Path source) {
        try {
            return transcoder.toM4a(source);
        } catch (AudioTranscoder.TranscodeFailed failure) {
            throw ApiException.unexpected(503, "audio_conversion_failed", failure);
        }
    }

    private static ApiException tooLong() {
        return new ApiException(422, "recording_too_long");
    }

    private static ApiException invalidLine() {
        return new ApiException(422, "invalid_line");
    }

    private static ApiException sessionNotFound() {
        return new ApiException(404, "session_not_found");
    }

    /**
     * 기기가 multipart 로 보낸 것.
     *
     * @param file 임시 파일. 부르는 쪽이 만들고 지운다
     * @param fileSize 올린 원본의 바이트 수(한도 기준)
     * @param transcriptSource {@code stt}·{@code none}. none 이면 {@code transcript}·{@code matched} 는 {@code null}
     */
    public record Upload(
            UUID requestId,
            UUID lineId,
            int attemptNo,
            String contentType,
            Path file,
            long fileSize,
            int durationMs,
            String transcript,
            String transcriptSource,
            Boolean matched) {
    }

    /** @param created 이번에 만들었거나 대체했으면 {@code true}, 재전송·작은 시도 번호면 {@code false} */
    public record Uploaded(RecordingView recording, boolean created) {
    }
}
