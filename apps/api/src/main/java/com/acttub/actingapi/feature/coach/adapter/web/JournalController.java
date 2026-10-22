package com.acttub.actingapi.feature.coach.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.web.JournalDtos.CreateRequest;
import com.acttub.actingapi.feature.coach.adapter.web.JournalDtos.JournalResponse;
import com.acttub.actingapi.feature.coach.adapter.web.JournalDtos.UpdateRequest;
import com.acttub.actingapi.feature.coach.app.JournalService;
import com.acttub.actingapi.platform.security.AccessGate;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회차의 배우 일지(practice.journal, SOMA-720). 노트처럼 화면이 찾는 자리가 회차라 경로가 회차 밑에 있다. 본인 것만 읽고 고친다 —
 * 없는 회차·남의 회차는 같은 404 다.
 */
@RestController
@RequestMapping("/v2/practices")
class JournalController {
    private final JournalService journals;
    private final AccessGate auth;

    JournalController(JournalService journals, AccessGate auth) {
        this.journals = journals;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Practice Journal",
            description = """
                    고정 질문 4개의 답으로 그 회차의 배우 일지를 만든다. 서버가 코칭 대화로 자동 칸(오늘 한 연습·장면과 인물·받은 피드백)을
                    만들고 배우의 답은 고치지 않고 그대로 둔다. 자동 칸을 만들지 못하면 배우의 답만으로 저장한다(draft_status=failed).
                    새로 만들면 201, 이미 있으면 다시 만들지 않고 그 일지를 200 으로 준다. 없는 회차·남의 회차는 404 practice_not_found.""",
            operationId = "create_practice_journal_v2_practices__practice_id__journal_post",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "만들었다",
            content = @Content(schema = @Schema(implementation = JournalResponse.class)))
    @ApiResponse(responseCode = "200", description = "이미 있다",
            content = @Content(schema = @Schema(implementation = JournalResponse.class)))
    @ApiResponse(responseCode = "422", description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/{practice_id}/journal")
    ResponseEntity<JournalResponse> create(
            @PathVariable("practice_id") UUID practiceId, @Valid @RequestBody CreateRequest body, HttpServletRequest request) {
        JournalService.Created created = journals.create(auth.gatedUser(request).id(), practiceId, body.answers().toDomain());
        return ResponseEntity.status(created.created() ? 201 : 200).body(JournalResponse.of(created.view()));
    }

    @Operation(
            summary = "Get Practice Journal",
            description = "그 회차의 배우 일지. 없으면(남의 것 포함) 404 journal_not_found 이고 화면은 노트를 대신 보인다.",
            operationId = "get_practice_journal_v2_practices__practice_id__journal_get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = JournalResponse.class)))
    @GetMapping("/{practice_id}/journal")
    JournalResponse get(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return JournalResponse.of(journals.find(auth.gatedUser(request).id(), practiceId));
    }

    @Operation(
            summary = "Update Practice Journal",
            description = """
                    배우가 고친 일지를 저장한다. 배우의 답 전체와 자동 칸 전체를 보내고, 글이 빈 항목은 지운다. 고친 뒤에는 자동 칸을
                    다시 만들지 않는다. 없으면(남의 것 포함) 404 journal_not_found.""",
            operationId = "update_practice_journal_v2_practices__practice_id__journal_put",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = JournalResponse.class)))
    @ApiResponse(responseCode = "422", description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/{practice_id}/journal")
    JournalResponse update(
            @PathVariable("practice_id") UUID practiceId, @Valid @RequestBody UpdateRequest body, HttpServletRequest request) {
        return JournalResponse.of(journals.update(auth.gatedUser(request).id(), practiceId,
                new JournalService.Edit(body.answers().toDomain(), body.draft())));
    }
}
