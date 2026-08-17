package com.acttub.actingapi.upload.app;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.upload.domain.UploadIntent;

/**
 * upload 가 저장소에 요구하는 것.
 *
 * <p>없음·실패를 {@code null} 로 알린다(ADR-018) — 이 포트의 갈래가 가장 많은 연산인
 * {@link #finalizeIntent} 가 "못 했다" 하나로 충분하기 때문이다. 왜 못 했는지는 부르는 쪽이
 * 다시 조회해 가른다(이미 확정된 것과 만료된 것의 응답이 다르다).
 *
 * <p><b>소유권 검사는 구현이 진다.</b> 모든 연산이 {@code userId} 를 함께 받고 조건은 SQL 의
 * {@code WHERE} 에 들어간다 — 행을 먼저 읽어 와 자바에서 비교하면 남의 의도가 존재한다는
 * 사실이 응답 시간에 새어 나간다.
 */
public interface UploadIntentRepository {

    UploadIntent create(
            UUID userId,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Integer durationMs,
            Instant expiresAt);

    /** 없거나 남의 것이면 {@code null}. */
    UploadIntent find(UUID userId, UUID intentId);

    /**
     * 대기 중이고 아직 살아 있는 의도를 확정한다.
     *
     * <p>확정하지 못하면 {@code null} — 이미 확정됐거나, 만료됐거나, 남의 것이다. 판정은 한
     * 문장의 {@code WHERE} 안에서 나야 두 요청이 동시에 들어와도 하나만 확정된다.
     */
    UploadIntent finalizeIntent(UUID userId, UUID intentId, String etag, Instant now);
}
