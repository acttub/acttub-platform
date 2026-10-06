package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository.Upload;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.integration.document.DocumentText;
import com.acttub.actingapi.platform.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 대본 원본 파일 (reading.script 「원본 파일」). 세 단계다: <b>올릴 자리 받기 · (기기가) 올리기 · 읽기</b>. 읽기가 서버로
 * 받아 글자를 뽑아 두고, 나누기 요청({@link ScriptImportService})은 {@code upload_id} 로 그 글을 쓴다.
 *
 * <p>거절은 코드 하나다: 50MB 초과 {@code script_file_too_large}, 형식 밖·글자를 못 뽑음 {@code script_file_unreadable},
 * 뽑은 글이 원문 한도를 넘음 {@code script_too_long}, 아직 안 올라옴·안 읽음 {@code script_upload_not_ready}. 바깥 호출
 * (저장소)은 트랜잭션 밖이다(CONTRACT §5-4).
 */
public class ScriptUploadService {
    private static final Logger log = LoggerFactory.getLogger(ScriptUploadService.class);

    private final ScriptUploadRepository uploads;
    private final ScriptImportRepository imports;
    private final ScriptFileStorage storage;
    private final ReadingRecordingCleanup cleanup;
    private final Clock clock;

    public ScriptUploadService(ScriptUploadRepository uploads, ScriptImportRepository imports, ScriptFileStorage storage,
            ReadingRecordingCleanup cleanup, Clock clock) {
        this.uploads = uploads;
        this.imports = imports;
        this.storage = storage;
        this.cleanup = cleanup;
        this.clock = clock;
    }

    /** 올릴 자리. 나누기와 같은 동의가 있어야 한다 — 원본 보관도 그 문서가 알린다. */
    public NewUpload reserve(UUID userId, String fileName, long byteSize) {
        if (byteSize > ScriptFileRules.FILE_MAX_BYTES) {
            throw new ApiException(422, "script_file_too_large");
        }
        if (!ScriptFileRules.accepts(fileName)) {
            throw new ApiException(422, "script_file_unreadable");
        }
        if (!"granted".equals(imports.consent(userId))) {
            throw new ApiException(403, "script_split_consent_required");
        }
        storage.requireConfigured();
        Instant now = clock.instant();
        UUID uploadId = UUID.randomUUID();
        String objectKey = ScriptFileRules.objectKey(userId, uploadId);
        Instant expiresAt = now.plus(ScriptFileRules.UPLOAD_TTL);
        uploads.reserve(userId, uploadId, objectKey, byteSize, expiresAt, now);
        String url = storage.presignUpload(objectKey, ScriptFileRules.CONTENT_TYPE, byteSize,
                Math.toIntExact(ScriptFileRules.UPLOAD_TTL.toSeconds()));
        return new NewUpload(uploadId, url, ScriptFileRules.CONTENT_TYPE, expiresAt);
    }

    public record NewUpload(UUID uploadId, String uploadUrl, String contentType, Instant expiresAt) {
    }

    /** 올라온 파일을 받아 글자를 뽑아 둔다. 이미 읽었으면 다시 읽지 않는다. */
    public void read(UUID userId, UUID uploadId) {
        Upload upload = require(userId, uploadId);
        if (upload.rawText() != null) {
            return;
        }
        Long size = storage.size(upload.objectKey());
        if (size == null || size != upload.byteSize()) {
            throw new ApiException(422, "script_upload_not_ready");
        }
        Path file = null;
        try {
            file = Files.createTempFile("script-upload-", ".bin");
            storage.download(upload.objectKey(), file);
            switch (DocumentText.read(file, ScriptRules.TEXT_MAX)) {
                case DocumentText.Text text -> uploads.saveText(uploadId, text.value(), clock.instant());
                case DocumentText.TooLong tooLong -> throw new ApiException(422, "script_too_long");
                case DocumentText.Unreadable unreadable -> {
                    log.info("script upload {} unreadable: {}", uploadId, unreadable.cause());
                    throw new ApiException(422, "script_file_unreadable");
                }
            }
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        } finally {
            deleteQuietly(file);
        }
    }

    /** 나누기 요청이 쓸 글. */
    String text(UUID userId, UUID uploadId) {
        Upload upload = require(userId, uploadId);
        if (upload.rawText() == null) {
            throw new ApiException(422, "script_upload_not_ready");
        }
        return upload.rawText();
    }

    /** 하루 지난 미연결 원본을 지운다. 매시간 도는 일이 부른다. */
    public int sweepUnlinked() {
        Instant now = clock.instant();
        List<UUID> scheduled = uploads.sweepUnlinked(now.minus(ScriptFileRules.UNLINKED_TTL), now);
        cleanup.attempt(scheduled);
        return scheduled.size();
    }

    private Upload require(UUID userId, UUID uploadId) {
        Upload upload = uploads.find(userId, uploadId);
        if (upload == null) {
            throw new ApiException(404, "script_upload_not_found");
        }
        return upload;
    }

    private static void deleteQuietly(Path file) {
        if (file == null) return;
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // 임시 디렉터리의 파일이라 남아도 OS 가 치운다.
        }
    }
}
