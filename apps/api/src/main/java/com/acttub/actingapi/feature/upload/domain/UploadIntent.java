package com.acttub.actingapi.feature.upload.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 업로드 의도 하나. CONTEXT.md 가 말하는 Domain Model 이며 {@code upload_intents} 행을 옮겨 담는다.
 *
 * <p>{@code status} 를 {@code UploadStatus} 가 아니라 문자열로 들고 있는다. 그 열거형은
 * {@code jakarta.persistence.Converter} 를 끌고 있어 여기로 들이면 Domain Model 이
 * 프레임워크를 알게 된다 — {@code practice} 가 같은 자리에서 같은 선택을 했다.
 */
public record UploadIntent(
        UUID id,
        UUID userId,
        String status,
        String storageProvider,
        String objectKey,
        String mimeType,
        long sizeBytes,
        Integer durationMs,
        String etag,
        Instant createdAt,
        Instant expiresAt,
        Instant finalizedAt) {

    /** 이미 확정됐는가. 확정된 의도에 다시 완료를 걸면 같은 응답을 되돌려준다. */
    public boolean finalized() {
        return "finalized".equals(status);
    }

    /** 아직 확정을 기다리는가. */
    public boolean pending() {
        return "pending".equals(status);
    }

    /**
     * 아직 살아 있는가. 경계는 배타다 — 만료 시각과 정확히 같은 순간은 이미 쓸 수 없다.
     */
    public boolean usableAt(Instant now) {
        return expiresAt.isAfter(now);
    }

    /** 의도에 적힌 크기가 상한을 넘는가. 실제 업로드된 바이트가 아니라 <b>약속한</b> 크기다. */
    public boolean oversized(long maxBytes) {
        return sizeBytes > maxBytes;
    }
}
