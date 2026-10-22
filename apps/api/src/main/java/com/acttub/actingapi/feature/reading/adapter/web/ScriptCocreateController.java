package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ScriptCocreateDtos.CreateRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptCocreateDtos.RestoreRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptCocreateDtos.RevisionRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptCocreateDtos.SampleScriptResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptCocreateDtos.SavedResponse;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Experience;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 찍을 대사 같이 만들기 (SOMA-721). 감정·상황·원하는 방향으로 AI 가 생성 대본을 만들고, 고치고(성공한 수정만 무료 3회),
 * 확정하면 「내 대본」(reading.script)에 저장한다. 회원 전용이다 — 경로가 {@code /v2/reading/**} 밖이다.
 */
@RestController
@RequestMapping("/v2/sample-scripts")
class ScriptCocreateController {
    private final ScriptCocreateService cocreations;
    private final AccessGate auth;

    ScriptCocreateController(ScriptCocreateService cocreations, AccessGate auth) {
        this.cocreations = cocreations;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Sample Script",
            description = """
                    감정·상황·원하는 방향과 배역 수(1~4, 1은 독백)·분량(1·3·10분, 추정)으로 생성 대본을 만든다. 새로 만들면 201,
                    같은 request_id 로 다시 오면 먼저 만든 것을 200 으로 준다. 같은 request_id 가 아직 만드는 중이면 409
                    sample_script_in_progress, 24시간 20개 초과 429 sample_script_daily_limit, 배역 수·분량이 범위 밖이면 422
                    sample_script_invalid_options, 모델이 실패하거나 검사를 통과하지 못하면 502 sample_script_failed.""",
            operationId = "create_sample_script_v2_sample_scripts_post",
            tags = "v2-sample-scripts",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "만들었다",
            content = @Content(schema = @Schema(implementation = SampleScriptResponse.class)))
    @ApiResponse(responseCode = "200", description = "같은 request_id 의 재전송",
            content = @Content(schema = @Schema(implementation = SampleScriptResponse.class)))
    @ApiResponse(responseCode = "422", description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping
    ResponseEntity<SampleScriptResponse> create(@Valid @RequestBody CreateRequest body, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        ScriptCocreateService.View view = cocreations.generate(userId, body.requestId(), new ScriptCocreateService.Request(
                experience(body.experience()), body.age(), body.gender() == null ? null : body.gender().name(),
                body.goal() == null ? null : body.goal().name(), body.emotion(), body.situation(), body.direction(),
                body.characterCount() == null ? 1 : body.characterCount(),
                body.lengthMinutes() == null ? 1 : body.lengthMinutes()));
        return ResponseEntity.status(view.created() ? 201 : 200).body(SampleScriptResponse.of(view));
    }

    @Operation(
            summary = "Get Sample Script",
            description = "생성 대본의 지금 버전. 없는 것과 남의 것은 같은 404 sample_script_not_found 다.",
            operationId = "get_sample_script_v2_sample_scripts__sample_script_id__get",
            tags = "v2-sample-scripts",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = SampleScriptResponse.class)))
    @GetMapping("/{sample_script_id}")
    SampleScriptResponse get(@PathVariable("sample_script_id") UUID id, HttpServletRequest request) {
        return SampleScriptResponse.of(cocreations.find(auth.gatedUser(request).id(), id));
    }

    @Operation(
            summary = "Revise Sample Script",
            description = """
                    지금 버전(base_version)을 자유 요청·배역 수·분량으로 한 번에 고친다. 성공한 수정만 세고 무료 3회다(버전을 되돌려도
                    돌려주지 않는다). 다 쓰면 429 sample_script_revision_limit, 지금 버전이 아니면 409 sample_script_version_conflict,
                    다른 수정 중이면 409 sample_script_busy, 확정한 대본이면 409 sample_script_saved, 바꿀 것이 없으면 422
                    sample_script_no_change, 고치지 못하면 502 sample_script_revision_failed(원본·횟수 그대로).""",
            operationId = "revise_sample_script_v2_sample_scripts__sample_script_id__revisions_post",
            tags = "v2-sample-scripts",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = SampleScriptResponse.class)))
    @PostMapping("/{sample_script_id}/revisions")
    SampleScriptResponse revise(
            @PathVariable("sample_script_id") UUID id, @Valid @RequestBody RevisionRequest body, HttpServletRequest request) {
        return SampleScriptResponse.of(cocreations.revise(auth.gatedUser(request).id(), id,
                new ScriptCocreateService.Revision(body.baseVersion(), body.text(), body.characterCount(), body.lengthMinutes())));
    }

    @Operation(
            summary = "Restore Sample Script Version",
            description = "지난 버전을 지금 버전으로 되돌린다. 사용한 수정 횟수는 그대로다. 없는 버전 422 sample_script_version_not_found.",
            operationId = "restore_sample_script_v2_sample_scripts__sample_script_id__restore_post",
            tags = "v2-sample-scripts",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = SampleScriptResponse.class)))
    @PostMapping("/{sample_script_id}/restore")
    SampleScriptResponse restore(
            @PathVariable("sample_script_id") UUID id, @Valid @RequestBody RestoreRequest body, HttpServletRequest request) {
        return SampleScriptResponse.of(cocreations.restore(auth.gatedUser(request).id(), id, body.version()));
    }

    @Operation(
            summary = "Save Sample Script",
            description = """
                    확정 — 지금 버전을 「내 대본」(reading.script)에 저장하고 script_id 를 준다. 처음이면 201, 이미 저장했으면 200 으로
                    같은 script_id 다. 대본 수 한도는 리딩과 같다(422 script_limit).""",
            operationId = "save_sample_script_v2_sample_scripts__sample_script_id__save_post",
            tags = "v2-sample-scripts",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "저장했다",
            content = @Content(schema = @Schema(implementation = SavedResponse.class)))
    @ApiResponse(responseCode = "200", description = "이미 저장했다",
            content = @Content(schema = @Schema(implementation = SavedResponse.class)))
    @PostMapping("/{sample_script_id}/save")
    ResponseEntity<SavedResponse> save(@PathVariable("sample_script_id") UUID id, HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        ScriptCocreateService.Saved saved = cocreations.save(user.id(), user.guest(), id);
        return ResponseEntity.status(saved.created() ? 201 : 200).body(new SavedResponse(saved.id(), saved.scriptId()));
    }

    private static Experience experience(ScriptCocreateDtos.ExperienceInput input) {
        if (input == null) {
            return Experience.BEGINNER;
        }
        return switch (input) {
            case beginner -> Experience.BEGINNER;
            case exam -> Experience.EXAM;
            case experienced -> Experience.EXPERIENCED;
        };
    }
}
