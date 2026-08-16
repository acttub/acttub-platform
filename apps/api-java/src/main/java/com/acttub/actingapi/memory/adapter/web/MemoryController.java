package com.acttub.actingapi.memory.adapter.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.acttub.actingapi.memory.adapter.web.MemoryDtos.MemoryItem;
import com.acttub.actingapi.memory.adapter.web.MemoryDtos.MemoryResponse;
import com.acttub.actingapi.memory.adapter.web.MemoryDtos.UpdateMemoryRequest;
import com.acttub.actingapi.memory.app.BlankMemoryValue;
import com.acttub.actingapi.memory.app.MemoryEntry;
import com.acttub.actingapi.memory.app.MemoryService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.schema.ActorMemoryField;
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
 * 코치가 배우를 기억하는 6칸 — 조회·수정·삭제 (`actor_memory.py`).
 *
 * <p>에이전트가 채우고 배우가 나중에 고친다. <b>그래서 이 화면이 이 기능의 안전판이다</b> —
 * 에이전트가 잘못 적은 것을 되돌릴 경로가 여기밖에 없다.
 *
 * <p>성별·나이는 배우만 쓴다. 영상이나 목소리에서 추론하지 않는다 — 저장 계층이 막고
 * DB 제약이 최종 방어선이다.
 */
@RestController
@RequestMapping("/v2/me/memory")
class MemoryController {
    /** pydantic Literal 오류 메시지 형식: 마지막 항목만 or 로 잇는다. */
    private static final String EXPECTED_FIELDS =
            "'gender', 'age', 'goal', 'blockage', 'speech_self' or 'speech_actual'";

    private final MemoryService memory;
    private final AccessGate auth;

    MemoryController(MemoryService memory, AccessGate auth) {
        this.memory = memory;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Memory",
            description = "기억을 전부 읽는다. 아직 채워지지 않은 칸은 빠진 채로 온다.",
            operationId = "get_memory_v2_me_memory_get",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = MemoryResponse.class)))
    @GetMapping
    MemoryResponse getMemory(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return new MemoryResponse(memory.list(user.id()).stream().map(MemoryController::item).toList());
    }

    @Operation(
            summary = "Update Memory",
            description = """
                    배우가 한 칸을 쓰거나 고친다.

                    여기서 쓴 칸은 이후 에이전트가 덮지 않는다. 되돌리려면 지우면 되고,
                    지우면 다음 연습부터 에이전트가 다시 채운다.""",
            operationId = "update_memory_v2_me_memory__field__put",
            tags = "v2-me",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = MemoryItem.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PutMapping("/{field}")
    MemoryItem updateMemory(
            @io.swagger.v3.oas.annotations.Parameter(
                    name = "field",
                    schema = @Schema(
                            title = "Field",
                            type = "string",
                            allowableValues = {
                                "gender", "age", "goal", "blockage", "speech_self", "speech_actual"
                            }))
            @PathVariable String field,
            @Valid @RequestBody UpdateMemoryRequest body,
            HttpServletRequest request) {
        ActorMemoryField target = field(field);
        var user = auth.rateLimitedUser(request);
        try {
            return item(memory.write(user.id(), target, body.value()));
        } catch (BlankMemoryValue blank) {
            throw ApiValidationException.valueError(
                    List.of("body", "value"), "Value error, value must not be blank", body.value());
        }
    }

    @Operation(
            summary = "Delete Memory Field",
            description = "한 칸을 지운다. 이미 없으면 404 대신 204 — 지우려는 결과는 같다.",
            operationId = "delete_memory_field_v2_me_memory__field__delete",
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
                            allowableValues = {
                                "gender", "age", "goal", "blockage", "speech_self", "speech_actual"
                            }))
            @PathVariable String field,
            HttpServletRequest request) {
        ActorMemoryField target = field(field);
        var user = auth.rateLimitedUser(request);
        memory.delete(user.id(), target);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Delete Memory",
            description = "기억을 통째로 지운다. 다음 연습부터 다시 쌓인다.",
            operationId = "delete_memory_v2_me_memory_delete",
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
    private static ActorMemoryField field(String raw) {
        if (!MemoryDtos.FIELD_NAMES.contains(raw)) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("type", "literal_error");
            error.put("loc", List.of("path", "field"));
            error.put("msg", "Input should be " + EXPECTED_FIELDS);
            error.put("input", raw);
            error.put("ctx", Map.of("expected", EXPECTED_FIELDS));
            throw new ApiValidationException(List.of(error));
        }
        return ActorMemoryField.valueOf(raw.toUpperCase(Locale.ROOT));
    }

    private static MemoryItem item(MemoryEntry row) {
        return new MemoryItem(
                row.field(), row.value(), row.writtenByActor(), row.sourcePracticeSessionId());
    }
}
