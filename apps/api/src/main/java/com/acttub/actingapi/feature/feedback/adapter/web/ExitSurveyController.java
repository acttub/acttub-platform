package com.acttub.actingapi.feature.feedback.adapter.web;

import com.acttub.actingapi.feature.feedback.adapter.web.ExitSurveyDtos.PracticeFeedbackRequest;
import com.acttub.actingapi.feature.feedback.adapter.web.ExitSurveyDtos.PracticeFeedbackResponse;
import com.acttub.actingapi.feature.feedback.adapter.web.ExitSurveyDtos.PracticeFeedbackStatus;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyService;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.Accepted;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.NewSurvey;
import com.acttub.actingapi.feature.feedback.app.ExitSurveySync;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 코치·노트 화면에서 나갈 때의 한 줄 소감 (practice.feedback).
 *
 * <p>자리는 셋이다. 접수({@code POST /v2/practice-feedback}), 이미 물어봤는지 조회
 * ({@code GET /v2/me/practice-feedback/status}), 그리고 자동 노출 직전의 <b>선점</b>
 * ({@code POST /v2/me/practice-feedback/claim}) — 선점에서 참을 받은 기기만 시트를 띄운다.
 *
 * <p>조회와 선점을 나눈 것은 화면이 "보여 줄까" 와 "내가 보여 준다" 를 다른 순간에 묻기 때문이다. 조회만
 * 두면 두 기기가 같은 답을 받아 둘 다 뜨고, 선점만 두면 화면이 상태를 미리 알 수 없다.
 */
@RestController
class ExitSurveyController {

    private final ExitSurveyService surveys;
    private final ExitSurveySync sync;
    private final AccessGate auth;

    ExitSurveyController(ExitSurveyService surveys, ExitSurveySync sync, AccessGate auth) {
        this.surveys = surveys;
        this.sync = sync;
        this.auth = auth;
    }

    @Operation(
            summary = "Submit Practice Feedback",
            description = """
                    나가기 직전의 소감을 접수한다.

                    저장은 DB 커밋으로 끝난다. 시트 복제는 뒤의 일이라 실패해도 접수는 유지되고 매일 도는
                    일이 다시 보낸다. 같은 request_id 의 재전송은 행을 늘리지 않고 같은 id 를 돌려준다.""",
            operationId = "submit_practice_feedback_v2_practice_feedback_post",
            tags = "v2-practice-feedback",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeFeedbackResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/v2/practice-feedback")
    ResponseEntity<PracticeFeedbackResponse> submit(
            @Valid @RequestBody PracticeFeedbackRequest body, HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        Accepted accepted = surveys.submit(
                new NewSurvey(
                        user.id(),
                        body.requestId(),
                        body.practiceId(),
                        body.screen(),
                        body.trigger(),
                        body.body(),
                        body.contactEmail(),
                        body.contactPhone()),
                body.body() == null);
        if (accepted.created()) {
            // 접수 직후에 한 번 보낸다. 실패해도 여기서는 아무 일도 일어나지 않는다.
            sync.attempt();
        }
        return ResponseEntity.status(accepted.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(new PracticeFeedbackResponse(accepted.id()));
    }

    @Operation(
            summary = "Get Practice Feedback Status",
            description = "이 계정에 이미 물어봤는지. 표식을 건드리지 않는다.",
            operationId = "get_practice_feedback_status_v2_me_practice_feedback_status_get",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeFeedbackStatus.class)))
    @GetMapping("/v2/me/practice-feedback/status")
    PracticeFeedbackStatus status(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return new PracticeFeedbackStatus(surveys.asked(user.id()), false);
    }

    @Operation(
            summary = "Claim Practice Feedback Prompt",
            description = """
                    자동 노출 직전에 부른다. asked_now 가 참인 기기만 시트를 띄운다.

                    두 기기가 동시에 불러도 하나만 참을 받는다. 오프라인에서는 부르지 않는다 —
                    새 자동 노출은 하지 않고 이미 쓴 제출만 다시 보낸다.""",
            operationId = "claim_practice_feedback_v2_me_practice_feedback_claim_post",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeFeedbackStatus.class)))
    @PostMapping("/v2/me/practice-feedback/claim")
    PracticeFeedbackStatus claim(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        boolean claimed = surveys.claim(user.id());
        return new PracticeFeedbackStatus(true, claimed);
    }
}
