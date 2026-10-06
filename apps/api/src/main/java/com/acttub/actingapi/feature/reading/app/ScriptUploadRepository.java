package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * reading 이 저장소에 요구하는 것 — 대본 원본 파일의 장부 (reading.script 「원본 파일」, V34 {@code script_uploads}).
 *
 * <p>한 행이 올린 파일 하나다. 글자를 뽑으면 {@code raw_text} 가, 그 글로 대본이 저장되면 {@code script_id} 가 찬다. 대본과 함께
 * 지워지고, 하루가 지나도 연결되지 않은 행은 객체와 함께 지운다.
 */
public interface ScriptUploadRepository {

    void reserve(UUID userId, UUID uploadId, String objectKey, long byteSize, Instant expiresAt, Instant now);

    /** 없으면 {@code null}. 남의 것도 없는 것이다. */
    Upload find(UUID userId, UUID uploadId);

    /**
     * @param rawText 뽑은 글. 아직 읽지 않았거나 대본에 연결돼 비웠으면 {@code null}
     * @param linked 대본에 연결됐다
     */
    record Upload(UUID id, String objectKey, long byteSize, String rawText, boolean linked) {
    }

    void saveText(UUID uploadId, String rawText, Instant now);

    /**
     * {@code before} 전에 만들었는데 어느 대본에도 연결되지 않은 행을 지우고 객체 삭제를 같은 트랜잭션에서 정리 장부에 올린다.
     * 진행 중인 나누기 작업이 쓰는 원본은 남긴다.
     *
     * @return 장부의 id
     */
    List<UUID> sweepUnlinked(Instant before, Instant now);
}
