package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 찍을 대사 같이 만들기(SOMA-721)가 저장소에 요구하는 것 — {@code script_cocreations} 한 줄이 생성 요청 하나다.
 *
 * <p>조건과 버전은 JSON 글로 들고 다닌다(모양은 서비스가 정한다). 모든 읽기·쓰기는 그 사람의 줄만 본다 — 없는 것과
 * 남의 것을 가르지 않는다.
 */
public interface ScriptCocreateRepository {

    /** 없으면 {@code null}. */
    Row find(UUID userId, UUID id);

    /** 사용자·생성 행을 잠그고 저장 및 연결을 같은 트랜잭션에서 실행한다. 외부 호출 금지. */
    <T> T withSaveLock(UUID userId, UUID id, java.util.function.Function<Row, T> save);

    /** 같은 생성 요청 id 의 줄. 없으면 {@code null}. */
    Row findByRequest(UUID userId, UUID requestId);

    /**
     * 만드는 중인 줄을 먼저 넣는다(versions 없음). 같은 (사람, 요청 id) 가 이미 있으면 넣지 않고 {@code false} 다 —
     * 겹친 요청이 모델을 두 번 부르지 않게 한다.
     */
    boolean insertPending(UUID id, UUID userId, UUID requestId, Instant now);

    /** 만들지 못했으면 만드는 중인 줄을 지운다 — 같은 요청 id 로 다시 시도할 수 있다. */
    void deletePending(UUID id);

    /** 만든 대본을 첫 버전으로 넣는다. */
    void complete(UUID id, String conditions, String versions, String model, Instant now);

    /** {@code since} 뒤에 만든(만드는 중 포함) 줄 수 — 하루 상한. */
    int countSince(UUID userId, Instant since);

    /** 최근에 다 만든 줄의 조건 JSON, 최근 순. 결말·소품이 겹치지 않게 고르는 데 쓴다. */
    List<String> recentConditions(UUID userId, int limit);

    /**
     * 수정을 시작한다 — 지금 버전이 {@code version} 이고, 확정 전이고, 무료 수정이 남았고, 다른 수정이 없거나
     * {@code staleBefore} 전에 멈춘 것일 때만 표시를 남기고 {@code true} 다.
     */
    boolean claim(UUID userId, UUID id, int version, int revisionLimit, Instant now, Instant staleBefore);

    /** 수정 표시를 푼다(실패). 횟수는 그대로다. */
    void release(UUID id);

    /** 수정에 성공했다 — 버전을 더하고 지금 버전으로 삼고, 수정 횟수를 하나 늘리고, 표시를 푼다. */
    void appendVersion(UUID id, String versions, int currentVersion, Instant now);

    /** 지난 버전을 지금 버전으로 되돌린다. 수정 중이거나 확정했으면 {@code false}. 횟수는 그대로다. */
    boolean restore(UUID userId, UUID id, int version, Instant now);

    /** 확정해 「내 대본」에 저장한 대본을 잇는다. */
    void linkScript(UUID userId, UUID id, UUID scriptId, Instant now);

    /**
     * @param versions 버전 배열 JSON. {@code null} 이면 아직 만드는 중이다
     * @param currentVersion 1부터 센 지금 버전
     * @param scriptId 확정해 저장한 대본. 대본이 지워지면 {@code null} 로 돌아간다
     */
    record Row(
            UUID id,
            UUID requestId,
            String conditions,
            String versions,
            int currentVersion,
            int revisionsUsed,
            String model,
            Instant busySince,
            UUID scriptId,
            Instant createdAt) {

        public boolean ready() {
            return versions != null;
        }
    }
}
