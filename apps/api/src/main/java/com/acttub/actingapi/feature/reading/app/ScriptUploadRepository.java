package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * reading 이 저장소에 요구하는 것 — 대본 원본 파일의 장부 (reading.script 「원본 파일」, V34 {@code script_uploads}).
 *
 * <p>한 행이 올린 파일 하나다. 글자를 뽑으면 {@code raw_text} 가, 그 글로 대본이 저장되면 {@code script_id} 가 찬다. 대본과 함께
 * 지워지고, 하루가 지나도 연결되지 않은 행은 객체와 함께 지운다. 읽거나 나누지 못한 행은 {@code failure} 를 남기고, 동의가 있으면
 * {@code kept_until} 까지 둔다(V39).
 */
public interface ScriptUploadRepository {

    void reserve(UUID userId, UUID uploadId, String objectKey, String fileName, long byteSize, Instant expiresAt, Instant now);

    /** 없으면 {@code null}. 남의 것도 없는 것이다. */
    Upload find(UUID userId, UUID uploadId);

    /**
     * @param rawText 뽑은 글. 대본에 연결돼 원본 행에서 비웠으면 그 대본의 원문이다(같은 글). 아직 읽지 않았으면 {@code null}
     * @param linked 대본에 연결됐다
     * @param linkedRequestId 연결한 나누기 요청의 request_id. 연결 전이면 {@code null}
     */
    record Upload(UUID id, String objectKey, long byteSize, String rawText, boolean linked, UUID linkedRequestId) {
    }

    /** 뽑은 글을 둔다. 앞서 읽지 못했던 기록({@code failure}·{@code kept_until})은 지운다 — 이제 읽히는 파일이다. */
    void saveText(UUID uploadId, String rawText, Instant now);

    /**
     * 읽거나 나누지 못한 이유를 남긴다. 그 사용자의 {@code script_split} 현재 판 결정이 granted 면 {@code keptUntil} 까지 둔다.
     * 대본에 연결된 원본은 건드리지 않는다.
     */
    void recordFailure(UUID uploadId, String failure, Instant keptUntil, Instant now);

    /**
     * 어느 대본에도 연결되지 않은 행 가운데 보관하지 않는 것은 {@code before} 전에 만든 것을, 보관하는 것은 {@code kept_until} 이
     * 지났거나 판과 상관없이 가장 최근 {@code script_split} 결정이 granted 가 아닌 것을 지우고 객체 삭제를 같은 트랜잭션에서 정리 장부에 올린다.
     * 진행 중인 나누기 작업이 쓰는 원본은 남긴다.
     *
     * @return 장부의 id
     */
    List<UUID> sweepUnlinked(Instant before, Instant now);
}
