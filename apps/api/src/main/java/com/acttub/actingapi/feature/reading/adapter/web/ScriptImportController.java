package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.ImportRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.ImportResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.ProgressResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.TicketResponse;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.ImportView;
import com.acttub.actingapi.feature.reading.app.ScriptImportService;
import com.acttub.actingapi.feature.reading.domain.ScriptText;
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
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 대본 나누기 요청 — 글을 받아 작업을 접수하고 상태를 보인다 (reading.script 「나누기 작업」). 리딩 경로라 게스트도 지나지만,
 * 선택 동의 {@code script_split} 은 회원만 결정할 수 있어 게스트는 서비스에서 403 이다.
 */
@RestController
@RequestMapping("/v2/reading/imports")
class ScriptImportController {
    private final ScriptImportService imports;
    private final AccessGate auth;

    ScriptImportController(ScriptImportService imports, AccessGate auth) {
        this.imports = imports;
        this.auth = auth;
    }

    @Operation(
            summary = "Import Script",
            description = """
                    대본 글을 받아 서버가 배역·대사로 나누는 작업을 접수한다. 새 요청은 202, 같은 request_id 의 재전송과 같은
                    글로 진행 중인 요청은 200 으로 같은 import_id 를 돌려준다. 같은 글이 이미 내 대본이면 200 duplicate_script_id.
                    예시 대본과 같은 글은 모델 없이 바로 저장돼 상태가 곧 succeeded 다. 동의 없음 403 script_split_consent_required,
                    원문 100,000자 초과 422 script_too_long, 대본 수 한도 422 script_limit, 하루 20개 초과 429
                    script_split_daily_limit, 같은 request_id 에 다른 본문 422 request_fingerprint_mismatch. allow_duplicate(R2.7
                    「새로 넣기」)는 같은 글의 대본이 있어도 새로 나누고, skip_script_check(R2.8 「그래도 나누기」)는 대본 여부
                    판정을 묻지 않는다. 둘 다 요청 지문에 든다.""",
            operationId = "import_script_v2_reading_imports_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "202",
            description = "접수됨 — import_id 로 상태를 묻는다",
            content = @Content(schema = @Schema(implementation = TicketResponse.class)))
    @ApiResponse(
            responseCode = "200",
            description = "재전송·진행 중(import_id) 또는 같은 글의 대본이 이미 있음(duplicate_script_id)",
            content = @Content(schema = @Schema(implementation = TicketResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping
    ResponseEntity<TicketResponse> request(@Valid @RequestBody ImportRequest body, HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        if (ScriptText.normalized(body.rawText()).isEmpty()) {
            throw ApiValidationException.valueError(
                    List.of("body", "raw_text"), "Value error, raw_text must contain visible characters", body.rawText());
        }
        ScriptImportService.Ticket ticket = imports.request(user.id(), user.guest(), body.requestId(),
                new ScriptImportService.Submission(body.title(), body.rawText(), body.source().name(),
                        Boolean.TRUE.equals(body.allowDuplicate()), Boolean.TRUE.equals(body.skipScriptCheck())));
        return ResponseEntity.status(ticket.accepted() ? 202 : 200)
                .body(new TicketResponse(ticket.importId(), ticket.duplicateScriptId()));
    }

    @Operation(
            summary = "Get Import",
            description = "나누기 요청의 상태. 1초 간격으로 묻는다. 없는 것과 남의 것은 같은 404 import_not_found 다.",
            operationId = "get_import_v2_reading_imports__import_id__get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ImportResponse.class)))
    @GetMapping("/{import_id}")
    ImportResponse get(@PathVariable("import_id") UUID importId, HttpServletRequest request) {
        ImportView view = imports.find(auth.gatedUser(request).id(), importId);
        return new ImportResponse(view.id(), view.status(), new ProgressResponse(view.doneLines(), view.totalLines()),
                view.scriptId(), view.failure() == null ? null : view.failure().dbValue());
    }
}
