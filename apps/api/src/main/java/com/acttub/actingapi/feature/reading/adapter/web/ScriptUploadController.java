package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.UploadRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ImportDtos.UploadResponse;
import com.acttub.actingapi.feature.reading.app.ScriptUploadService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 대본 원본 파일 — 올릴 자리를 내주고, 올라온 파일에서 글자를 뽑아 둔다 (reading.script 「원본 파일」). 나누기 요청은
 * {@code upload_id} 로 그 글을 쓴다({@link ScriptImportController}).
 */
@RestController
@RequestMapping("/v2/reading/uploads")
class ScriptUploadController {
    private final ScriptUploadService uploads;
    private final AccessGate auth;

    ScriptUploadController(ScriptUploadService uploads, AccessGate auth) {
        this.uploads = uploads;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Script Upload",
            description = """
                    대본 원본 파일을 올릴 자리를 내준다. 기기는 upload_url 에 Content-Type: content_type 으로 파일을 PUT 하고
                    (주소는 15분, 크기는 byte_size 로 서명에 묶인다) complete 를 부른다. 50,000,000바이트 초과 422
                    script_file_too_large, 확장자가 txt·docx·pdf·hwp·hwpx 밖이면 422 script_file_unreadable, 동의 없음 403
                    script_split_consent_required, 스토리지 없음 503 storage_not_configured.""",
            operationId = "create_script_upload_v2_reading_uploads_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = UploadResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    UploadResponse create(@Valid @RequestBody UploadRequest body, HttpServletRequest request) {
        ScriptUploadService.NewUpload created = uploads.reserve(auth.gatedUser(request).id(), body.fileName(), body.byteSize());
        return new UploadResponse(created.uploadId(), created.uploadUrl(), created.contentType(), created.expiresAt());
    }

    @Operation(
            summary = "Complete Script Upload",
            description = """
                    올라온 파일을 받아 글자를 뽑아 둔다. 끝나면 204 이고 다시 불러도(대본에 연결된 뒤에도) 204 다. 그 뒤
                    POST /v2/reading/imports 에 upload_id 를 싣는다. 아직 안 올라왔으면 422 script_upload_not_ready, 글자를 못
                    뽑으면(형식 밖·한글 97·스캔한 PDF·암호·깨진 파일·빈 문서·받기와 뽑기 45초 초과) 422 script_file_unreadable,
                    뽑은 글이 100,000자를 넘으면 422 script_too_long, 서버의 읽기 자리(동시 둘)가 10초 안에 나지 않으면 429
                    script_upload_busy, 없는 것과 남의 것은 404 script_upload_not_found.""",
            operationId = "complete_script_upload_v2_reading_uploads__upload_id__complete_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @PostMapping("/{upload_id}/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void complete(@PathVariable("upload_id") UUID uploadId, HttpServletRequest request) {
        uploads.read(auth.gatedUser(request).id(), uploadId);
    }
}
