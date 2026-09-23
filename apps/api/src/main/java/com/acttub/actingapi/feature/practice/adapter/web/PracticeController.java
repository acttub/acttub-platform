package com.acttub.actingapi.feature.practice.adapter.web;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.AnalyzeRequest;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.BlockageInput;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.ContinueRequest;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.CreateRequest;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.GroupListResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.GroupPatchRequest;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.GroupResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.PracticeResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.SceneInput;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeDtos.StatusResponse;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import com.acttub.actingapi.feature.practice.domain.BlockageBranch;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 연습 회차·묶음 (practice.start, practice.resume, practice.analyze, practice.library). 전부 보호 기능이고 웹
 * 게스트도 쓴다(기능 표 {@code PRACTICE}, 문서 셋).
 *
 * <p>값의 모양(필수·길이·막힘 조합·필터 이름)은 여기서 422 <b>배열</b>로, 규칙(영상 상태·진행 중 회차·하루 한도)은
 * 서비스가 사유 코드 하나로 답한다(CONTRACT §6-2).
 */
@RestController
@RequestMapping("/v2/practices")
class PracticeController {
    private static final Set<String> FILTERS = Set.of("all", "favorite", "recent30");

    private final PracticeService practices;
    private final AccessGate auth;

    @Operation(summary = "Get Practice Analysis", tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Public analysis summary",
            content = @Content(schema = @Schema(implementation = PracticeDtos.AnalysisResponse.class)))
    @GetMapping("/{practice_id}/analysis")
    PracticeDtos.AnalysisResponse analysis(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return PracticeDtos.AnalysisResponse.of(practices.analysis(auth.gatedUser(request).id(), practiceId));
    }

    PracticeController(PracticeService practices, AccessGate auth) {
        this.practices = practices;
        this.auth = auth;
    }

    @Operation(
            summary = "Start Practice",
            description = """
                    보관함의 영상으로 새 묶음의 첫 회차를 만든다 — 회차 하나와 분석 작업 하나가 한 트랜잭션이다.
                    상황·인물·목표와 막힘은 모두 선택이고 시작 뒤에는 바꾸지 않는다. 영상이 없거나 남의 것이거나
                    파일이 파기됐으면 422 video_not_ready, 게스트가 하루 세 번을 넘기면 429
                    guest_daily_analysis_limit, 같은 요청 id 에 다른 본문이면 422 request_fingerprint_mismatch 다.""",
            operationId = "start_practice_v2_practices_post",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    PracticeResponse start(
            @Valid @RequestBody CreateRequest body,
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            @RequestHeader(name = "X-Acttub-Contract", required = false) String contract,
            HttpServletRequest request) {
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        requireBlockagePair(body.blockage());
        AuthenticatedUser user = auth.gatedUser(request);
        return PracticeResponse.of(practices.start(
                user.id(), user.guest(), contract, draft(body.requestId(), body.videoId(), body.scene(), body.blockage())));
    }

    @Operation(
            summary = "Continue Practice",
            description = """
                    같은 묶음의 다음 회차. 영상을 보내지 않으면 이어받을 회차의 영상을 그대로 쓴다(그 영상이 파기됐으면
                    422 video_not_ready 이고 새 영상으로는 된다). 묶음에 닫히지 않은 회차가 있으면 409
                    practice_in_progress 이고, 그 회차 id 는 묶음 조회의 in_progress_practice_id 로 얻는다.""",
            operationId = "continue_practice_v2_practices__practice_id__continue_post",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/{practice_id}/continue")
    @ResponseStatus(HttpStatus.CREATED)
    PracticeResponse continuePractice(
            @PathVariable("practice_id") UUID practiceId,
            @Valid @RequestBody ContinueRequest body,
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            @RequestHeader(name = "X-Acttub-Contract", required = false) String contract,
            HttpServletRequest request) {
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        requireBlockagePair(body.blockage());
        AuthenticatedUser user = auth.gatedUser(request);
        return PracticeResponse.of(practices.continueGroup(
                user.id(), user.guest(), contract, practiceId,
                draft(body.requestId(), body.videoId(), body.scene(), body.blockage())));
    }

    @Operation(
            summary = "Retry Practice Analysis",
            description = """
                    실패로 닫힌 회차의 분석을 다시 건다 — 새 작업과 함께 analyzing 으로 돌아간다. 묶음에 다른 진행 중
                    회차가 있으면 409 practice_in_progress 이고, 아직 실패하지 않은 회차면 409 analysis_not_failed 다.
                    게스트의 하루 세 번을 한 번 쓴다.""",
            operationId = "retry_practice_analysis_v2_practices__practice_id__analyze_post",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/{practice_id}/analyze")
    @ResponseStatus(HttpStatus.CREATED)
    PracticeResponse analyze(
            @PathVariable("practice_id") UUID practiceId,
            @Valid @RequestBody AnalyzeRequest body,
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        AuthenticatedUser user = auth.gatedUser(request);
        return PracticeResponse.of(practices.retryAnalysis(user.id(), user.guest(), practiceId, body.requestId()));
    }

    @Operation(
            summary = "List Practice Groups",
            description = """
                    연습 기록 — 묶음 단위다. 숨긴 묶음은 빠지고 필터는 all·favorite·recent30 이다. 묶음마다 회차 요약과
                    진행 중 회차 id 가 함께 온다.""",
            operationId = "list_practice_groups_v2_practices_get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = GroupListResponse.class)))
    @GetMapping
    GroupListResponse groups(
            @RequestParam(name = "filter", required = false, defaultValue = "all") String filter,
            HttpServletRequest request) {
        if (!FILTERS.contains(filter)) {
            throw ApiValidationException.valueError(
                    List.of("query", "filter"), "Value error, filter must be all, favorite or recent30", filter);
        }
        return new GroupListResponse(practices.groups(auth.gatedUser(request).id(), filter).stream()
                .map(GroupResponse::of)
                .toList());
    }

    @Operation(
            summary = "Get Practice",
            description = "회차 하나 — 장면·막힘과 분석·대화·노트의 현재 상태. 없는 것과 남의 것은 같은 404 practice_not_found.",
            operationId = "get_practice_v2_practices__practice_id__get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeResponse.class)))
    @GetMapping("/{practice_id}")
    PracticeResponse find(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return PracticeResponse.of(practices.find(auth.gatedUser(request).id(), practiceId));
    }

    @Operation(
            summary = "Get Practice Status",
            description = "폴링이 읽는 것 — 회차의 진행(stage)과 작업 상태·실패 분류, 관찰 기록의 상태. 앱은 4초, 웹은 10초 간격이다.",
            operationId = "get_practice_status_v2_practices__practice_id__status_get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = StatusResponse.class)))
    @GetMapping("/{practice_id}/status")
    StatusResponse status(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return StatusResponse.of(practices.status(auth.gatedUser(request).id(), practiceId));
    }

    @Operation(
            summary = "Cancel Practice Analysis",
            description = """
                    "그만두기" — 작업을 failed/cancelled 로 닫고 lease 를 지워 늦은 완료와 재큐를 막는다. 회차는 closed 다.
                    화면을 떠나는 것은 취소가 아니다. 이미 끝난 분석에는 409 analysis_already_finished.""",
            operationId = "cancel_practice_analysis_v2_practices__practice_id__cancel_post",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = StatusResponse.class)))
    @PostMapping("/{practice_id}/cancel")
    StatusResponse cancel(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return StatusResponse.of(practices.cancel(auth.gatedUser(request).id(), practiceId));
    }

    @Operation(
            summary = "Update Practice Group",
            description = """
                    묶음 속성 — 즐겨찾기·숨김·제목. 보낸 것만 바꾼다. 숨김은 묶음 전체이고(개별 회차 숨김은 없다) 노트·대화·
                    기억은 지우지 않으며 영상은 보관함에 남는다.""",
            operationId = "update_practice_group_v2_practices__root_id__group_patch",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = GroupResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/{root_id}/group")
    GroupResponse updateGroup(
            @PathVariable("root_id") UUID rootId,
            @Valid @RequestBody GroupPatchRequest body,
            HttpServletRequest request) {
        return GroupResponse.of(practices.updateGroup(
                auth.gatedUser(request).id(), rootId, body.favorite(), body.hidden(), body.title()));
    }

    private static PracticeService.Draft draft(
            UUID requestId, UUID videoId, SceneInput scene, BlockageInput blockage) {
        return new PracticeService.Draft(
                requestId,
                videoId,
                scene == null ? null : scene.situation(),
                scene == null ? null : scene.character(),
                scene == null ? null : scene.goal(),
                blockage == null ? null : blockage.category(),
                blockage == null ? null : blockage.detail(),
                blockage == null ? null : blockage.note());
    }

    /** 막힘의 큰 갈래와 세부는 조합이 맞아야 한다 — DB 가 거부할 값을 먼저 422 배열로 답한다. */
    private static void requireBlockagePair(BlockageInput blockage) {
        if (blockage == null) {
            return;
        }
        String category = blockage.category();
        String detail = blockage.detail();
        if (category != null && !BlockageBranch.KINDS.contains(category)) {
            throw ApiValidationException.valueError(
                    List.of("body", "blockage", "category"),
                    "Value error, category must be one of " + String.join(", ", BlockageBranch.KINDS),
                    category);
        }
        if (detail != null && !BlockageBranch.SUB_BRANCHES.contains(detail)) {
            throw ApiValidationException.valueError(
                    List.of("body", "blockage", "detail"),
                    "Value error, detail must be one of " + String.join(", ", BlockageBranch.SUB_BRANCHES),
                    detail);
        }
        if (!BlockageBranch.pairs(category, detail)) {
            throw ApiValidationException.valueError(
                    List.of("body", "blockage", "detail"),
                    "Value error, detail does not belong to category " + category,
                    detail);
        }
    }
}
