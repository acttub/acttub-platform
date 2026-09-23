package com.acttub.actingapi.feature.reading.adapter.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RecordingResponse;
import com.acttub.actingapi.feature.reading.app.RecordingService;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 줄 단위 녹음 — 올리기·삭제 (reading.recording). 전부 보호 기능이고 웹 게스트도 쓴다(게스트의 기능 표 {@code READING}).
 *
 * <p>올리기는 유일한 multipart 요청이다. 칸의 모양(필수·UUID·정수·값 목록)은 여기서 보고 422 배열로 답한다 — JSON 본문의
 * 검증기가 닿지 않는 자리라 같은 형상을 직접 만든다. 규칙(한도·줄·회차·총량·변환)은 서비스가 사유 코드 하나로 답한다.
 */
@RestController
@RequestMapping("/v2/reading")
class RecordingController {
    private final RecordingService recordings;
    private final AccessGate auth;

    RecordingController(RecordingService recordings, AccessGate auth) {
        this.recordings = recordings;
        this.auth = auth;
    }

    @Operation(
            summary = "Upload Line Recording",
            description = """
                    내 대사 한 줄의 녹음을 multipart 한 요청으로 올린다: request_id·line_id·attempt_no·audio(파일)·
                    duration_ms·transcript_source(stt·none)·transcript?·matched?. 서버가 m4a(AAC)가 아니면 변환해 저장한다.
                    같은 request_id 는 같은 행(200), 같은 줄의 더 큰 attempt_no 는 대체(201), 더 작은 번호는 200 현재 값.
                    10,000,000바이트·180초 초과 422 recording_too_long, 총량(회원 1GB·게스트 100MB) 초과 422 recording_quota,
                    구간 밖·상대역·지문 줄 422 invalid_line, 지워진 회차 404, 변환 실패 503 audio_conversion_failed.
                    completed·stopped 회차에도 받는다.""",
            operationId = "upload_reading_recording_v2_reading_sessions__session_id__recordings_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = RecordingResponse.class)))
    @ApiResponse(
            responseCode = "200",
            description = "같은 요청의 재전송이거나 더 작은 시도 번호 — 현재 값",
            content = @Content(schema = @Schema(implementation = RecordingResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            required = true,
            content = @Content(
                    mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                    schema = @Schema(implementation = SessionDtos.UploadForm.class)))
    @PostMapping(value = "/sessions/{session_id}/recordings", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<RecordingResponse> upload(
            @PathVariable("session_id") UUID sessionId,
            @Parameter(description = "본문의 request_id 와 같은 값. 실으면 같아야 하고 다르면 422 다")
            @RequestHeader(name = RequestIdHeader.NAME, required = false) String requestIdHeader,
            @Parameter(hidden = true) @RequestParam(value = "request_id", required = false) String requestId,
            @Parameter(hidden = true) @RequestParam(value = "line_id", required = false) String lineId,
            @Parameter(hidden = true) @RequestParam(value = "attempt_no", required = false) String attemptNo,
            @Parameter(hidden = true) @RequestParam(value = "duration_ms", required = false) String durationMs,
            @Parameter(hidden = true) @RequestParam(value = "transcript_source", required = false) String transcriptSource,
            @Parameter(hidden = true) @RequestParam(value = "transcript", required = false) String transcript,
            @Parameter(hidden = true) @RequestParam(value = "matched", required = false) String matched,
            @Parameter(hidden = true) @RequestPart(value = "audio", required = false) MultipartFile audio,
            HttpServletRequest request) throws IOException {
        AuthenticatedUser user = auth.gatedUser(request);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("request_id", requestId);
        fields.put("line_id", lineId);
        fields.put("attempt_no", attemptNo);
        fields.put("duration_ms", durationMs);
        fields.put("transcript_source", transcriptSource);
        fields.put("transcript", transcript);
        fields.put("matched", matched);
        UUID parsedRequestId = uuid("request_id", requestId, fields);
        UUID parsedLineId = uuid("line_id", lineId, fields);
        int parsedAttemptNo = integer("attempt_no", attemptNo, 1, fields);
        int parsedDurationMs = integer("duration_ms", durationMs, 0, fields);
        String source = transcriptSource(transcriptSource, fields);
        Boolean parsedMatched = matched(matched, fields);
        if ("none".equals(source) && (transcript != null || parsedMatched != null)) {
            throw ApiValidationException.valueError(
                    List.of("body", "transcript_source"),
                    "Value error, transcript and matched must be absent when transcript_source is none",
                    source);
        }
        if (audio == null || audio.isEmpty()) {
            throw ApiValidationException.missing(List.of("body", "audio"), fields);
        }
        RequestIdHeader.requireMatching(requestIdHeader, parsedRequestId);

        // 파일은 임시 자리에 받아 두고 서비스가 변환·올린 뒤 여기서 지운다.
        Path temporary = Files.createTempFile("acttub-recording-", ".upload");
        try {
            audio.transferTo(temporary);
            RecordingService.Uploaded uploaded = recordings.upload(user.id(), user.guest(), sessionId,
                    new RecordingService.Upload(
                            parsedRequestId, parsedLineId, parsedAttemptNo, audio.getContentType(), temporary,
                            audio.getSize(), parsedDurationMs, transcript, source, parsedMatched));
            return ResponseEntity.status(uploaded.created() ? 201 : 200).body(recording(uploaded.recording()));
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    @Operation(
            summary = "Delete Recording",
            description = "그 녹음의 행과 객체를 지운다. 회차 진행·암기 상태는 그대로다. 없는 것과 남의 것은 같은 404 다.",
            operationId = "delete_reading_recording_v2_reading_recordings__recording_id__delete",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/recordings/{recording_id}")
    ResponseEntity<Void> delete(@PathVariable("recording_id") UUID recordingId, HttpServletRequest request) {
        recordings.delete(auth.gatedUser(request).id(), recordingId);
        return ResponseEntity.noContent().build();
    }

    static RecordingResponse recording(RecordingView view) {
        return new RecordingResponse(
                view.id(), view.lineId(), view.attemptNo(), view.durationMs(), view.contentType(), view.byteSize(),
                view.transcript(), view.transcriptSource(), view.matched(), view.playbackUrl(), view.playbackExpiresAt());
    }

    private static UUID uuid(String field, String value, Map<String, Object> fields) {
        if (value == null) {
            throw ApiValidationException.missing(List.of("body", field), fields);
        }
        try {
            return UUID.fromString(value.strip());
        } catch (IllegalArgumentException malformed) {
            throw ApiValidationException.valueError(List.of("body", field), "Value error, " + field + " must be a UUID", value);
        }
    }

    private static int integer(String field, String value, int minimum, Map<String, Object> fields) {
        if (value == null) {
            throw ApiValidationException.missing(List.of("body", field), fields);
        }
        int parsed;
        try {
            parsed = Integer.parseInt(value.strip());
        } catch (NumberFormatException malformed) {
            throw ApiValidationException.valueError(List.of("body", field), "Value error, " + field + " must be an integer", value);
        }
        if (parsed < minimum) {
            throw ApiValidationException.valueError(
                    List.of("body", field), "Value error, " + field + " must be at least " + minimum, value);
        }
        return parsed;
    }

    private static String transcriptSource(String value, Map<String, Object> fields) {
        if (value == null) {
            throw ApiValidationException.missing(List.of("body", "transcript_source"), fields);
        }
        String source = value.strip();
        if (!source.equals("stt") && !source.equals("none")) {
            throw ApiValidationException.valueError(
                    List.of("body", "transcript_source"), "Value error, transcript_source must be stt or none", value);
        }
        return source;
    }

    private static Boolean matched(String value, Map<String, Object> fields) {
        if (value == null) {
            return null;
        }
        String flag = value.strip();
        if (flag.equals("true")) {
            return true;
        }
        if (flag.equals("false")) {
            return false;
        }
        throw ApiValidationException.valueError(List.of("body", "matched"), "Value error, matched must be true or false", value);
    }
}
