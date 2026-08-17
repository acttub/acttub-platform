package com.acttub.actingapi.feature.upload.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.feature.upload.adapter.web.UploadDtos.UploadCompleteResponse;
import com.acttub.actingapi.feature.upload.adapter.web.UploadDtos.UploadIntentRequest;
import com.acttub.actingapi.feature.upload.adapter.web.UploadDtos.UploadIntentResponse;
import com.acttub.actingapi.feature.upload.app.UploadService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
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

@RestController
@RequestMapping("/v2/uploads")
class UploadController {
    private final UploadService uploads;
    private final AccessGate auth;

    UploadController(UploadService uploads, AccessGate auth) {
        this.uploads = uploads;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Intent",
            operationId = "create_intent_v2_uploads_intents_post",
            tags = "v2-uploads",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = UploadIntentResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/intents")
    @ResponseStatus(HttpStatus.CREATED)
    UploadIntentResponse createIntent(
            @Valid @RequestBody UploadIntentRequest body,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        UploadService.NewUpload created = uploads.createIntent(
                user.id(), body.mimeType(), body.sizeBytes(), body.durationMs());
        return new UploadIntentResponse(
                created.intentId(), created.uploadUrl(), created.expiresAt());
    }

    @Operation(
            summary = "Complete Intent",
            operationId = "complete_intent_v2_uploads_intents__intent_id__complete_post",
            tags = "v2-uploads",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = UploadCompleteResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/intents/{intent_id}/complete")
    UploadCompleteResponse completeIntent(
            @PathVariable("intent_id") UUID intentId,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        return new UploadCompleteResponse(uploads.completeIntent(user.id(), intentId), "finalized");
    }
}
