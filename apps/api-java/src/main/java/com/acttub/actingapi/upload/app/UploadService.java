package com.acttub.actingapi.upload.app;

import java.math.BigInteger;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.upload.domain.UploadIntent;
import com.acttub.actingapi.upload.domain.UploadMediaType;
import org.springframework.stereotype.Service;

/**
 * 업로드 의도의 규칙. HTTP 도 SQL 도 모르며, 요청 하나가 어떤 순서로 무엇을 확인하는지만 안다.
 *
 * <p>없음·충돌을 {@link ApiException} 으로 던진다 — {@code practice} 와 같은 형태이며, 그것을
 * 상태코드와 본문으로 옮기는 일은 {@code platform/web/ApiErrorAdvice} 하나가 맡는다.
 */
@Service
public class UploadService {

    /** 파이썬과 같은 100MiB. 하네스가 이 경계로 413 을 대조한다. */
    public static final long MAX_UPLOAD_BYTES = 100L * 1024 * 1024;

    /** 서명 주소와 의도의 수명. 둘이 같은 값이어야 주소가 살아 있는 동안만 확정된다. */
    public static final Duration UPLOAD_INTENT_TTL = Duration.ofMinutes(30);

    private final UploadIntentRepository intents;
    private final UploadTarget target;
    private final Clock clock;

    public UploadService(UploadIntentRepository intents, UploadTarget target, Clock clock) {
        this.intents = intents;
        this.target = target;
        this.clock = clock;
    }

    /**
     * 올릴 자리를 내주고 의도를 남긴다.
     *
     * <p>거르는 순서가 응답을 가른다 — 영상이 아니면 415 가 크기 검사보다 먼저 나온다.
     */
    public NewUpload createIntent(
            UUID userId,
            String rawMimeType,
            BigInteger sizeBytes,
            BigInteger durationMs) {
        UploadMediaType mediaType = UploadMediaType.of(rawMimeType);
        if (!mediaType.video()) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(MAX_UPLOAD_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        long size = sizeBytes.longValueExact();
        target.requireConfigured();
        Instant expiresAt = clock.instant().plus(UPLOAD_INTENT_TTL);
        String objectKey = objectKey(userId, mediaType);
        String uploadUrl = target.presignUpload(
                objectKey,
                mediaType.value(),
                size,
                Math.toIntExact(UPLOAD_INTENT_TTL.toSeconds()));
        UploadIntent intent = intents.create(
                userId,
                objectKey,
                mediaType.value(),
                size,
                durationMs == null ? null : durationMs.intValueExact(),
                expiresAt);
        return new NewUpload(intent.id(), uploadUrl, expiresAt);
    }

    /**
     * 올라온 것을 확인하고 의도를 확정한다. 확정된 의도의 식별자를 돌려준다.
     *
     * <p>이미 확정된 의도에 다시 걸면 같은 답이 나온다 — 클라이언트의 재시도가 409 가 되지
     * 않게 하려는 것이며, 그 멱등성은 두 자리에서 성립한다(조회 직후, 그리고 확정 경합 뒤).
     */
    public UUID completeIntent(UUID userId, UUID intentId) {
        // ⚠ 조회보다 먼저다. 미루면 스토리지가 없는 기동에서 응답이 404 로 바뀐다.
        target.requireConfigured();
        UploadIntent intent = intents.find(userId, intentId);
        if (intent == null) {
            throw new ApiException(404, "upload_intent_not_found");
        }
        if (intent.finalized()) {
            return intent.id();
        }
        Instant now = clock.instant();
        if (!intent.pending() || !intent.usableAt(now)) {
            throw new ApiException(409, "upload_intent_expired");
        }
        if (intent.oversized(MAX_UPLOAD_BYTES)) {
            throw new ApiException(413, "upload_too_large");
        }
        StoredUpload stored = target.head(intent.objectKey());
        if (stored == null) {
            throw new ApiException(409, "upload_not_found");
        }
        if (stored.sizeBytes() != intent.sizeBytes()) {
            throw new ApiException(409, "upload_size_mismatch");
        }
        UploadIntent finalized = intents.finalizeIntent(userId, intent.id(), stored.etag(), now);
        if (finalized != null) {
            return finalized.id();
        }
        // 확정에 실패한 이유는 하나가 아니다. 같은 의도를 두 요청이 함께 완료했다면 이미
        // 확정돼 있고, 그때는 경합에서 진 쪽도 같은 응답을 받아야 한다.
        UploadIntent latest = intents.find(userId, intent.id());
        if (latest != null && latest.finalized()) {
            return latest.id();
        }
        throw new ApiException(409, "upload_intent_expired");
    }

    /** {@code users/{사용자}/uploads/{무작위}{확장자}}. 확장자 규칙만 Domain Model 이 안다. */
    private static String objectKey(UUID userId, UploadMediaType mediaType) {
        String filename = UUID.randomUUID().toString().replace("-", "") + mediaType.objectSuffix();
        return "users/" + userId + "/uploads/" + filename;
    }

    /** 새로 낸 업로드 자리. 응답으로 옮기는 일은 web 어댑터가 한다. */
    public record NewUpload(UUID intentId, String uploadUrl, Instant expiresAt) {
    }
}
