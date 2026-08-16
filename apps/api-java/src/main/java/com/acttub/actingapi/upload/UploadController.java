package com.acttub.actingapi.upload;

import java.math.BigInteger;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.schema.UploadStatus;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.upload.UploadDtos.UploadCompleteResponse;
import com.acttub.actingapi.upload.UploadDtos.UploadIntentRequest;
import com.acttub.actingapi.upload.UploadDtos.UploadIntentResponse;
import com.acttub.actingapi.platform.web.ApiException;
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
    static final long MAX_UPLOAD_BYTES = 100L * 1024 * 1024;
    static final Duration UPLOAD_INTENT_TTL = Duration.ofMinutes(30);

    private final UploadStore store;
    private final Optional<ObjectStorage> configuredStorage;
    private final AccessGate auth;
    private final Clock clock;

    UploadController(
            UploadStore store,
            Optional<ObjectStorage> configuredStorage,
            AccessGate auth,
            Clock clock) {
        this.store = store;
        this.configuredStorage = configuredStorage;
        this.auth = auth;
        this.clock = clock;
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
        String mimeType = body.mimeType().strip().toLowerCase(Locale.ROOT);
        if (!mimeType.startsWith("video/")) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (body.sizeBytes().compareTo(BigInteger.valueOf(MAX_UPLOAD_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        long sizeBytes = body.sizeBytes().longValueExact();
        ObjectStorage storage = requireStorage();
        Instant expiresAt = clock.instant().plus(UPLOAD_INTENT_TTL);
        String objectKey = objectKey(user.id(), mimeType);
        String uploadUrl = storage.presignUpload(
                objectKey,
                mimeType,
                sizeBytes,
                Math.toIntExact(UPLOAD_INTENT_TTL.toSeconds()));
        UploadStore.UploadIntentRow intent = store.create(
                user.id(),
                objectKey,
                mimeType,
                sizeBytes,
                body.durationMs() == null ? null : body.durationMs().intValueExact(),
                expiresAt);
        return new UploadIntentResponse(intent.id(), uploadUrl, expiresAt);
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
        ObjectStorage storage = requireStorage();
        UploadStore.UploadIntentRow intent = store.find(user.id(), intentId);
        if (intent == null) {
            throw new ApiException(404, "upload_intent_not_found");
        }
        if (intent.status() == UploadStatus.FINALIZED) {
            return completed(intent.id());
        }
        Instant now = clock.instant();
        if (intent.status() != UploadStatus.PENDING || !intent.expiresAt().isAfter(now)) {
            throw new ApiException(409, "upload_intent_expired");
        }
        if (intent.sizeBytes() > MAX_UPLOAD_BYTES) {
            throw new ApiException(413, "upload_too_large");
        }
        StoredObjectMetadata metadata = storage.head(intent.objectKey());
        if (metadata == null) {
            throw new ApiException(409, "upload_not_found");
        }
        if (metadata.sizeBytes() != intent.sizeBytes()) {
            throw new ApiException(409, "upload_size_mismatch");
        }
        UploadStore.UploadIntentRow finalized =
                store.finalizeIntent(user.id(), intent.id(), metadata.etag(), now);
        if (finalized == null) {
            UploadStore.UploadIntentRow latest = store.find(user.id(), intent.id());
            if (latest != null && latest.status() == UploadStatus.FINALIZED) {
                return completed(latest.id());
            }
            throw new ApiException(409, "upload_intent_expired");
        }
        return completed(finalized.id());
    }

    private ObjectStorage requireStorage() {
        return configuredStorage.orElseThrow(
                () -> new NoCredentialsError("storage is not configured"));
    }

    private static UploadCompleteResponse completed(UUID intentId) {
        return new UploadCompleteResponse(intentId, "finalized");
    }

    private static String objectKey(UUID userId, String mimeType) {
        String filename = UUID.randomUUID().toString().replace("-", "") + objectSuffix(mimeType);
        return "users/" + userId + "/uploads/" + filename;
    }

    private static String objectSuffix(String mimeType) {
        String subtype = mimeType.split("/", 2)[1].split(";", 2)[0].toLowerCase(Locale.ROOT);
        return switch (subtype) {
            case "mp4" -> ".mp4";
            case "quicktime" -> ".mov";
            case "webm" -> ".webm";
            default -> {
                String safe = subtype.codePoints()
                        .filter(Character::isLetterOrDigit)
                        .limit(12)
                        .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
                        .toString();
                yield safe.isEmpty() ? ".video" : "." + safe;
            }
        };
    }
}
