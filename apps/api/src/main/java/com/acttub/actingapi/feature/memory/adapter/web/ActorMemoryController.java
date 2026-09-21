package com.acttub.actingapi.feature.memory.adapter.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.memory.adapter.web.ActorMemoryDtos.ActorMemoryItem;
import com.acttub.actingapi.feature.memory.adapter.web.ActorMemoryDtos.ActorMemoryResponse;
import com.acttub.actingapi.feature.memory.adapter.web.ActorMemoryDtos.UpdateActorMemoryRequest;
import com.acttub.actingapi.feature.memory.app.ActorMemory;
import com.acttub.actingapi.feature.memory.app.ActorMemoryService;
import com.acttub.actingapi.feature.memory.app.BlankMemoryValue;
import com.acttub.actingapi.feature.memory.domain.ActorMemoryFields;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 코치가 배우에 대해 기억하는 네 칸 — 조회·수정·삭제 (practice.memory).
 *
 * <p>워커가 채우고 배우가 나중에 고친다. <b>그래서 이 화면이 이 기능의 안전판이다</b> — 워커가 잘못 적은 것을
 * 되돌릴 경로가 여기밖에 없다.
 *
 * <p><b>성별·나이 칸은 없다</b> — 프로필로 옮겼다(account.profile). 옛 여섯 칸 화면은
 * {@code /v2/legacy-me/memory} 에 남아 있고 옛 표를 읽는다.
 */
@RestController
@RequestMapping("/v2/me/memory")
class ActorMemoryController {
    /** pydantic Literal 오류 메시지 형식: 마지막 항목만 or 로 잇는다. */
    private static final String EXPECTED_FIELDS = "'goal', 'blockage', 'speech_self' or 'speech_actual'";

    private final ActorMemoryService memory;
    private final AccessGate auth;

    ActorMemoryController(ActorMemoryService memory, AccessGate auth) {
        this.memory = memory;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Actor Memory",
            description = "기억을 전부 읽는다. 아직 채워지지 않은 칸은 빠진 채로 온다.",
            operationId = "get_actor_memory_v2_me_memory_get",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ActorMemoryResponse.class)))
    @GetMapping
    ActorMemoryResponse getMemory(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return new ActorMemoryResponse(
                memory.list(user.id()).stream().map(ActorMemoryController::item).toList());
    }

    @Operation(
            summary = "Update Actor Memory",
            description = """
                    배우가 한 칸을 쓰거나 고친다.

                    여기서 쓴 칸은 이후 워커가 덮지 않는다. 되돌리려면 지우면 되고, 지우면 다음 갱신
                    대상 회차부터 다시 채워진다.""",
            operationId = "update_actor_memory_v2_me_memory__field__put",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = ActorMemoryItem.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PutMapping("/{field}")
    ActorMemoryItem updateMemory(
            @io.swagger.v3.oas.annotations.Parameter(
                    name = "field",
                    schema = @Schema(
                            title = "Field",
                            type = "string",
                            allowableValues = {"goal", "blockage", "speech_self", "speech_actual"}))
            @PathVariable String field,
            @Valid @RequestBody UpdateActorMemoryRequest body,
            HttpServletRequest request) {
        requireKnown(field);
        var user = auth.rateLimitedUser(request);
        try {
            return item(memory.write(user.id(), field, body.value()));
        } catch (BlankMemoryValue blank) {
            throw ApiValidationException.valueError(
                    List.of("body", "value"), "Value error, value must not be blank", body.value());
        }
    }

    @Operation(
            summary = "Delete Actor Memory Field",
            description = "한 칸을 지운다. 이미 없으면 404 대신 204 — 지우려는 결과는 같다.",
            operationId = "delete_actor_memory_field_v2_me_memory__field__delete",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/{field}")
    ResponseEntity<Void> deleteMemoryField(
            @io.swagger.v3.oas.annotations.Parameter(
                    name = "field",
                    schema = @Schema(
                            title = "Field",
                            type = "string",
                            allowableValues = {"goal", "blockage", "speech_self", "speech_actual"}))
            @PathVariable String field,
            HttpServletRequest request) {
        requireKnown(field);
        var user = auth.rateLimitedUser(request);
        memory.delete(user.id(), field);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Delete Actor Memory",
            description = "기억을 통째로 지운다. 다음 갱신 대상 회차부터 다시 쌓인다.",
            operationId = "delete_actor_memory_v2_me_memory_delete",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping
    ResponseEntity<Void> deleteMemory(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        memory.deleteAll(user.id());
        return ResponseEntity.noContent().build();
    }

    /** 경로 변수는 인증보다 먼저 판정한다 — FastAPI 도 Literal 을 의존성보다 앞에서 본다. */
    private static void requireKnown(String raw) {
        if (ActorMemoryFields.contains(raw)) {
            return;
        }
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "literal_error");
        error.put("loc", List.of("path", "field"));
        error.put("msg", "Input should be " + EXPECTED_FIELDS);
        error.put("input", raw);
        error.put("ctx", Map.of("expected", EXPECTED_FIELDS));
        throw new ApiValidationException(List.of(error));
    }

    private static ActorMemoryItem item(ActorMemory row) {
        return new ActorMemoryItem(
                row.field(), row.value(), row.writtenByActor(), row.sourcePracticeId(), row.updatedAt());
    }
}
