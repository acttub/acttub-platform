package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.MemorizationDtos.MemorizationResponse;
import com.acttub.actingapi.feature.reading.adapter.web.MemorizationDtos.SetRequest;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository.MemorizationView;
import com.acttub.actingapi.feature.reading.app.MemorizationService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 암기 표시 — 줄마다 두고 대본 단위로 읽는다 (reading.memorization). 전부 보호 기능이고 웹 게스트도 쓴다(게스트의 기능 표
 * {@code READING}). 값의 형태(값 목록·필수)는 여기서 422 배열로, 규칙(대사 줄·주인)은 서비스가 사유 코드 하나로 답한다.
 */
@RestController
@RequestMapping("/v2/reading")
class MemorizationController {
    private final MemorizationService memorization;
    private final AccessGate auth;

    MemorizationController(MemorizationService memorization, AccessGate auth) {
        this.memorization = memorization;
        this.auth = auth;
    }

    @Operation(
            summary = "Set Line Memorization",
            description = """
                    줄 하나의 표시를 두거나 바꾼다. 그 대본의 대사 줄이면 배역과 무관하게 받고(상대역 대사 줄도 200), 지문·장면
                    줄은 422 invalid_line, 없는 줄과 남의 줄은 404 line_not_found. 같은 상태의 재전송은 updated_at 을 바꾸지
                    않는다. 마지막 요청이 남는다.""",
            operationId = "set_line_memorization_v2_reading_lines__line_id__memorization_put",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = MemorizationResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/lines/{line_id}/memorization")
    MemorizationResponse set(
            @PathVariable("line_id") UUID lineId,
            @Valid @RequestBody SetRequest body,
            HttpServletRequest request) {
        return response(memorization.set(auth.gatedUser(request).id(), lineId, body.status().name()));
    }

    @Operation(
            summary = "List Script Memorization",
            description = "그 대본의 줄에 남긴 표시를 줄 순서로. 행이 없는 줄은 아직 표시하지 않은 줄이다. 없는 대본과 남의 대본은 404 script_not_found.",
            operationId = "list_script_memorization_v2_reading_scripts__script_id__memorization_get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(array = @ArraySchema(schema = @Schema(implementation = MemorizationResponse.class))))
    @GetMapping("/scripts/{script_id}/memorization")
    List<MemorizationResponse> list(@PathVariable("script_id") UUID scriptId, HttpServletRequest request) {
        return memorization.list(auth.gatedUser(request).id(), scriptId).stream()
                .map(MemorizationController::response)
                .toList();
    }

    private static MemorizationResponse response(MemorizationView view) {
        return new MemorizationResponse(view.lineId(), view.status(), view.updatedAt());
    }
}
