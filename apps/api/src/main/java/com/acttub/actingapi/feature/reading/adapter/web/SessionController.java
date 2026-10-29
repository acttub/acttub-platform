package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.CardResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.CreateRequest;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.DetailResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.DifferentLineResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.DifferentWordResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.LineResultInput;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.LineResultResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ListResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ProgressCountResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ProgressRequest;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.ProgressResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RangeNameResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RangeResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionDtos.RecordingResponse;
import com.acttub.actingapi.feature.reading.adapter.web.SessionRatingDtos.SessionRatingRequest;
import com.acttub.actingapi.feature.reading.adapter.web.SessionRatingDtos.SessionRatingResponse;
import com.acttub.actingapi.feature.reading.app.SessionRatingService;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressChange;
import com.acttub.actingapi.feature.reading.app.SessionService;
import com.acttub.actingapi.feature.reading.app.SessionViews;
import com.acttub.actingapi.feature.reading.domain.DifferentLine;
import com.acttub.actingapi.feature.reading.domain.LineReport;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.RequestIdHeader;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리딩 회차 — 시작·목록·상세·진행 저장·삭제·평가 (reading.cast · reading.session). 전부 보호 기능이고 웹 게스트도 쓴다
 * (게스트의 기능 표 {@code READING}).
 *
 * <p>회차 평가({@code PUT …/rating}, SOMA-661)도 같은 자리다 — 게이트·소유권이 회차 조회와 같아야 하기 때문이다.
 *
 * <p>값의 형태(필수 키·타입·값 목록)는 여기서 보고 422 배열로 답한다. 규칙(내 배역·구간·순번·닫힌 회차)은 서비스가 사유
 * 코드 하나로 답한다.
 */
@RestController
@RequestMapping("/v2/reading")
class SessionController {
    static final int DEFAULT_CHUNK_LINES = 10;

    private final SessionService sessions;
    private final SessionRatingService ratings;
    private final AccessGate auth;

    /** 말풍선 하나에 담는 대사 수(SOMA-938). 앱 출시 없이 바꾸려고 서버 설정으로 둔다. 1보다 작으면 기본 10. */
    private final int chunkLines;

    SessionController(SessionService sessions, SessionRatingService ratings, AccessGate auth,
            @Value("${READING_CHUNK_LINES:10}") int chunkLines) {
        this.chunkLines = chunkLines >= 1 ? chunkLines : DEFAULT_CHUNK_LINES;
        this.sessions = sessions;
        this.ratings = ratings;
        this.auth = auth;
    }

    @Operation(
            summary = "Start Reading Session",
            description = """
                    내 배역·방식·구간·넘김·녹음을 정해 회차를 시작한다. 같은 대본의 진행 중 회차는 그대로 남는다(여럿일 수
                    있다). 같은 request_id 가 다시 오면 먼저 만든 회차를 200 으로 돌려주고, 속성이 다르면
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
        return ResponseEntity.status(started.created() ? 201 : 200)
                .body(detail(started.session(), ratings.mine(userId, started.session().card().id())));
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
            description = """
                    없는 것과 남의 것은 같은 404 session_not_found 다. my_rating 은 이 사람이 이 회차에 남긴 평가이고
                    없으면 null 이다.""",
            operationId = "get_reading_session_v2_reading_sessions__session_id__get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = DetailResponse.class)))
    @GetMapping("/sessions/{session_id}")
    DetailResponse get(@PathVariable("session_id") UUID sessionId, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        return detail(sessions.find(userId, sessionId), ratings.mine(userId, sessionId));
    }

    @Operation(
            summary = "Rate Reading Session",
            description = """
                    회차에 "좋았어요(good)·아쉬웠어요(bad)" 와 한 줄(선택)을 남긴다. 회차 하나에 한 행이고 다시 보내면
                    덮어쓴다 — comment 를 빼면 한 줄도 비운다. 한 줄은 앞뒤 공백을 걷은 1~100자이고 넘으면 422
                    comment_too_long 이다. 진행 중 회차도 받고, 평가는 회차 상태를 바꾸지 않는다.

                    같은 request_id·같은 본문의 재전송은 200 같은 응답이고, 같은 id 에 다른 본문이면 422
                    request_fingerprint_mismatch 다. 없는 회차·남의 회차는 같은 404 session_not_found 다(회차 조회와
                    같다).""",
            operationId = "rate_reading_session_v2_reading_sessions__session_id__rating_put",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = SessionRatingResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/sessions/{session_id}/rating")
    SessionRatingResponse rate(
            @PathVariable("session_id") UUID sessionId,
            @Valid @RequestBody SessionRatingRequest body,
            HttpServletRequest request) {
        return SessionRatingResponse.of(ratings.rate(
                auth.gatedUser(request).id(), sessionId, body.requestId(), body.rating(), body.comment()));
    }

    @Operation(
            summary = "Save Reading Progress",
            description = """
                    진행 위치·흐른 시간·줄 결과를 저장한다. progress_seq 가 저장된 값보다 클 때만 반영하고, 작거나 같으면
                    무시하고 200 으로 현재 값을 돌려준다. 위치와 줄 결과는 구간 안 대사 줄만 받는다(아니면 422 invalid_line).
                    시간은 줄지 않는다. complete=true 면 completed 가 되고 ended_at 이 찍히며 current_line_id 는 null 이다.
                    completed 회차에는 409 session_closed. 줄 결과에 said 를 실으면 서버가 원문과 비교해 outcome·misses 를
                    정한다(통과 passed·0, 미달 unmatched·1, 무발화·1,000자 초과는 남기지 않음). said 가 없으면 outcome·misses 가
                    필수다. different_lines 는 원문과 다르게 말한 대사의 현재 값이다.""",
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
        List<LineReport> results = new ArrayList<>();
        List<LineResultInput> inputs = body.lineResults() == null ? List.of() : body.lineResults();
        for (int index = 0; index < inputs.size(); index++) {
            results.add(report(inputs.get(index), index));
        }
        SessionViews.ProgressView progress = sessions.saveProgress(userId, sessionId, new ProgressChange(
                body.progressSeq(),
                body.currentLineId(),
                body.elapsedSeconds(),
                results,
                Boolean.TRUE.equals(body.complete())));
        return new ProgressResponse(
                progress.currentLineId(), progress.elapsedSeconds(), progress.progressSeq(), progress.status(),
                differentLines(progress.differentLines()));
    }

    private static LineReport report(LineResultInput input, int index) {
        if (input.said() != null) {
            return new LineReport.Said(input.lineId(), input.said());
        }
        String missing = input.outcome() == null ? "outcome" : input.misses() == null ? "misses" : null;
        if (missing != null) {
            Map<String, Object> given = new LinkedHashMap<>();
            given.put("line_id", input.lineId().toString());
            if (input.outcome() != null) {
                given.put("outcome", input.outcome().name());
            }
            if (input.misses() != null) {
                given.put("misses", input.misses());
            }
            throw ApiValidationException.missing(List.of("body", "line_results", index, missing), given);
        }
        return new LineReport.Reported(input.lineId(), input.outcome().name(), input.misses());
    }

    private static List<DifferentLineResponse> differentLines(List<DifferentLine> lines) {
        return lines.stream()
                .map(line -> new DifferentLineResponse(line.lineId(), line.dialogueNo(), line.said(), line.words().stream()
                        .map(word -> new DifferentWordResponse(word.text(), word.differs()))
                        .toList()))
                .toList();
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
                rangeName(card),
                progress(card),
                card.myDialogueCount(),
                card.recordedLineCount(),
                card.elapsedSeconds(),
                card.startedAt(),
                card.endedAt());
    }

    private static RangeNameResponse rangeName(SessionViews.SessionCardView card) {
        var name = card.rangeName();
        return new RangeNameResponse(name.kind(), name.sceneNo(), name.sceneTitle(), name.start(), name.end());
    }

    private static ProgressCountResponse progress(SessionViews.SessionCardView card) {
        return card.progress() == null ? null : new ProgressCountResponse(card.progress().done(), card.progress().total());
    }

    private DetailResponse detail(SessionViews.SessionDetailView view, SessionRatingStore.Rating rating) {
        SessionViews.SessionCardView card = view.card();
        return new DetailResponse(
                card.id(),
                card.ordinal(),
                card.status(),
                card.myCharacterIds(),
                card.myCharacterNames(),
                new RangeResponse(card.startDialogueNo(), card.endDialogueNo()),
                rangeName(card),
                progress(card),
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
                        .toList(),
                differentLines(view.differentLines()),
                SessionRatingResponse.of(rating),
                chunkLines);
    }
}
