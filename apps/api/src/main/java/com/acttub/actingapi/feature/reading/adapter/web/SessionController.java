package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.CardResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.CreateRequest;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.DetailResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.LineResultInput;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.LineResultResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ListResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ProgressRequest;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ProgressResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RangeResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RecordingResponse;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressChange;
import com.acttub.actingapi.feature.reading.app.SessionService;
import com.acttub.actingapi.feature.reading.app.SessionViews;
import com.acttub.actingapi.feature.reading.domain.LineResult;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리딩 회차 — 시작·목록·상세·진행 저장·삭제 (reading.cast · reading.session). 전부 보호 기능이고 웹 게스트도 쓴다
 * (게스트의 기능 표 {@code READING}).
 *
 * <p>값의 형태(필수 키·타입·값 목록)는 여기서 보고 422 배열로 답한다. 규칙(내 배역·구간·순번·닫힌 회차)은 서비스가 사유
 * 코드 하나로 답한다.
 */
@RestController
@RequestMapping("/v2/reading")
class SessionController {
    private final SessionService sessions;
    private final AccessGate auth;

    SessionController(SessionService sessions, AccessGate auth) {
        this.sessions = sessions;
        this.auth = auth;
    }

    @Operation(
            summary = "Start Reading Session",
            description = """
                    내 배역·방식·구간·넘김·녹음을 정해 회차를 시작한다. 열린 회차가 있으면 같은 트랜잭션에서 stopped 로
                    바꾸고 새 회차를 만든다. 같은 request_id 가 다시 오면 먼저 만든 회차를 200 으로 돌려주고, 속성이 다르면
                    422 request_fingerprint_mismatch. 내 배역이 없거나 그 대본의 배역이 아니면 422 invalid_characters,
                    구간의 줄이 그 대본의 대사 줄이 아니면 422 invalid_line, 시작 줄이 끝 줄 뒤이거나 구간 안에 내 대사가
                    없으면 422 empty_range. current_line_id 는 구간의 첫 대사 줄이다.""",
            operationId = "start_reading_session_v2_reading_scripts__script_id__sessions_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = DetailResponse.class)))
    @ApiResponse(
            responseCode = "200",
            description = "같은 요청의 재전송 — 먼저 만든 회차",
            content = @Content(schema = @Schema(implementation = DetailResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/scripts/{script_id}/sessions")
    ResponseEntity<DetailResponse> start(
            @PathVariable("script_id") UUID scriptId,
            @Parameter(description = "본문의 request_id 와 같은 값. 실으면 같아야 하고 다르면 422 다")
            @RequestHeader(name = RequestIdHeader.NAME, required = false) String requestIdHeader,
            @Valid @RequestBody CreateRequest body,
            HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        SessionPlan plan = new SessionPlan(
                body.myCharacterIds(), body.mode().name(), body.startLineId(), body.endLineId(),
                body.advance().name(), body.record());
        SessionService.Started started = sessions.start(userId, scriptId, body.requestId(), plan);
        return ResponseEntity.status(started.created() ? 201 : 200).body(detail(started.session()));
    }

    @Operation(
            summary = "List Reading Sessions",
            description = "그 대본의 회차를 최근순으로. 없는 대본과 남의 대본은 같은 404 script_not_found 다.",
            operationId = "list_reading_sessions_v2_reading_scripts__script_id__sessions_get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ListResponse.class)))
    @GetMapping("/scripts/{script_id}/sessions")
    ListResponse list(@PathVariable("script_id") UUID scriptId, HttpServletRequest request) {
        return new ListResponse(sessions.list(auth.gatedUser(request).id(), scriptId).stream()
                .map(SessionController::card)
                .toList());
    }

    @Operation(
            summary = "Get Reading Session",
            description = "없는 것과 남의 것은 같은 404 session_not_found 다.",
            operationId = "get_reading_session_v2_reading_sessions__session_id__get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = DetailResponse.class)))
    @GetMapping("/sessions/{session_id}")
    DetailResponse get(@PathVariable("session_id") UUID sessionId, HttpServletRequest request) {
        return detail(sessions.find(auth.gatedUser(request).id(), sessionId));
    }

    @Operation(
            summary = "Save Reading Progress",
            description = """
                    진행 위치·흐른 시간·줄 결과를 저장한다. progress_seq 가 저장된 값보다 클 때만 반영하고, 작거나 같으면
                    무시하고 200 으로 현재 값을 돌려준다. 위치와 줄 결과는 구간 안 대사 줄만 받는다(아니면 422 invalid_line).
                    시간은 줄지 않는다. complete=true 면 completed 가 되고 ended_at 이 찍히며 current_line_id 는 null 이다.
                    completed·stopped 회차에는 409 session_closed.""",
            operationId = "save_reading_progress_v2_reading_sessions__session_id__progress_patch",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ProgressResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/sessions/{session_id}/progress")
    ProgressResponse saveProgress(
            @PathVariable("session_id") UUID sessionId,
            @Valid @RequestBody ProgressRequest body,
            HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        List<LineResult> results = new ArrayList<>();
        if (body.lineResults() != null) {
            for (LineResultInput result : body.lineResults()) {
                results.add(new LineResult(result.lineId(), result.outcome().name(), result.misses()));
            }
        }
        SessionViews.ProgressView progress = sessions.saveProgress(userId, sessionId, new ProgressChange(
                body.progressSeq(),
                body.currentLineId(),
                body.elapsedSeconds(),
                results,
                Boolean.TRUE.equals(body.complete())));
        return new ProgressResponse(
                progress.currentLineId(), progress.elapsedSeconds(), progress.progressSeq(), progress.status());
    }

    @Operation(
            summary = "Delete Reading Session",
            description = "회차와 그 녹음(파일 포함)을 지운다. 암기 상태는 남는다. 없는 것과 남의 것은 같은 404 다.",
            operationId = "delete_reading_session_v2_reading_sessions__session_id__delete",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/sessions/{session_id}")
    ResponseEntity<Void> delete(@PathVariable("session_id") UUID sessionId, HttpServletRequest request) {
        sessions.delete(auth.gatedUser(request).id(), sessionId);
        return ResponseEntity.noContent().build();
    }

    private static CardResponse card(SessionViews.SessionCardView card) {
        return new CardResponse(
                card.id(),
                card.ordinal(),
                card.status(),
                card.myCharacterIds(),
                card.myCharacterNames(),
                new RangeResponse(card.startDialogueNo(), card.endDialogueNo()),
                card.myDialogueCount(),
                card.recordedLineCount(),
                card.elapsedSeconds(),
                card.startedAt(),
                card.endedAt());
    }

    private static DetailResponse detail(SessionViews.SessionDetailView view) {
        SessionViews.SessionCardView card = view.card();
        return new DetailResponse(
                card.id(),
                card.ordinal(),
                card.status(),
                card.myCharacterIds(),
                card.myCharacterNames(),
                new RangeResponse(card.startDialogueNo(), card.endDialogueNo()),
                card.myDialogueCount(),
                card.recordedLineCount(),
                card.elapsedSeconds(),
                card.startedAt(),
                card.endedAt(),
                view.scriptId(),
                view.mode(),
                view.advance(),
                view.record(),
                view.startLineId(),
                view.endLineId(),
                view.currentLineId(),
                view.progressSeq(),
                view.lineResults().stream()
                        .map(result -> new LineResultResponse(result.lineId(), result.outcome(), result.misses()))
                        .toList(),
                view.recordings().stream()
                        .map(recording -> new RecordingResponse(
                                recording.id(), recording.lineId(), recording.attemptNo(), recording.durationMs(),
                                recording.contentType(), recording.byteSize(), recording.transcript(),
                                recording.transcriptSource(), recording.matched(), recording.playbackUrl(),
                                recording.playbackExpiresAt()))
                        .toList());
    }
}
