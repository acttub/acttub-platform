package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;

/**
 * reading 이 저장소에 요구하는 것 — 나누기 요청 (reading.script 「나누기 작업」).
 *
 * <p>요청 하나가 {@code script_imports} 한 행이다. LLM 을 부르는 요청만 {@code ai_jobs} 에 작업 행을 함께 두고, 하루 한도는
 * 그 작업 행의 수로 센다. 쓰기는 대본과 같이 {@code users} 행을 잡고 계정이 활성인지 다시 본다({@link ScriptRepository.OwnerNotActive}).
 */
public interface ScriptImportRepository {

    /** 현재 판 {@code script_split} 문서에 대한 결정 — {@code granted}·{@code denied}·{@code undecided}. 문서가 없어도 {@code undecided}. */
    String consent(UUID userId);

    /**
     * 접수한다. 한 트랜잭션에서 {@code users} 행을 잡고 차례로 본다: 같은 (user_id, request_id) 재전송 → 같은 글의 대본(중복)
     * → 같은 글의 진행 중 요청(두 번 누름) → 대본 수 한도 → 하루 한도(LLM 길만) → 행 만들기.
     *
     * @param sample 글이 예시 대본과 같으면 미리 나눈 결과. 그러면 LLM 없이 같은 트랜잭션에서 대본까지 만든다
     * @throws ScriptRepository.OwnerNotActive 계정이 활성이 아니다 — 아무것도 쓰지 않았다
     */
    Requested request(UUID userId, UUID requestId, String fingerprint, Submission submission, ScriptDraft sample,
            int scriptLimit, int dailyLimit, Instant now);

    /**
     * @param allowDuplicate 같은 글의 대본·진행 중 요청을 보지 않는다(R2.7 「새로 넣기」)
     * @param skipScriptCheck 워커가 대본 여부 판정을 묻지 않는다(R2.8 「그래도 나누기」). 행에 남긴다
     * @param uploadId 원본 파일. 대본이 저장되면 그 대본에 연결한다. 글로 넣었으면 {@code null}
     */
    record Submission(String title, String rawText, String rawHash, String source, boolean allowDuplicate, boolean skipScriptCheck,
            UUID uploadId) {
    }

    /**
     * @param importId 만들었거나 먼저 만들어 둔 요청. 중복·거절이면 {@code null}
     * @param duplicateScriptId 같은 글인 기존 대본. 중복일 때만
     */
    record Requested(UUID importId, UUID duplicateScriptId, Outcome outcome) {
    }

    enum Outcome {
        ACCEPTED,
        REPLAYED,
        IN_FLIGHT,
        DUPLICATE,
        FINGERPRINT_MISMATCH,
        OVER_SCRIPT_LIMIT,
        OVER_DAILY_LIMIT
    }

    /** 없으면 {@code null}. 남의 것도 없는 것이다. */
    ImportView find(UUID userId, UUID importId);

    /**
     * @param status {@code pending}·{@code running}·{@code succeeded}·{@code failed}
     * @param scriptId 성공했을 때 만든 대본. 아니면 {@code null}
     * @param failure 실패했을 때 그 이유. 아니면 {@code null}
     */
    record ImportView(UUID id, String status, int doneLines, int totalLines, UUID scriptId, ScriptImportFailure failure) {
    }

    /** 워커가 나눌 재료. 요청이 이미 끝났거나 계정이 활성이 아니면 {@code null}. */
    Material material(UUID jobId, UUID importId);

    record Material(UUID userId, boolean guest, UUID requestId, String fingerprint, String title, String rawText, String source,
            boolean skipScriptCheck) {
    }

    /** 화면의 「N / M줄」. 자기 트랜잭션에서 바로 쓴다. */
    void progress(UUID importId, int doneLines, int totalLines);

    /**
     * 나눈 대본을 저장하고 요청과 작업을 성공으로 닫는다. 대본은 요청의 request_id 로 만들어 같은 작업이 다시 돌아도 같은
     * 대본이다.
     *
     * 끝난 요청의 원문은 비운다 — 글은 대본에 있고, 같은 글 판정은 해시만 쓴다.
     *
     * @return 대본 수 한도에 걸렸으면 {@link Completion#SCRIPT_LIMIT}, 같은 request_id 의 대본이 다른 지문으로 이미 있으면
     *         {@link Completion#FINGERPRINT_MISMATCH}, 그사이 계정이 닫혔으면 {@link Completion#CANCELLED}
     */
    Completion complete(UUID jobId, UUID leaseToken, UUID importId, ScriptDraft draft, Instant now);

    enum Completion {
        SAVED,
        SCRIPT_LIMIT,
        FINGERPRINT_MISMATCH,
        CANCELLED
    }

    /** 요청과 작업을 실패로 닫고 원문을 비운다. */
    void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, Instant now);

    /**
     * 집은 워커가 죽어 lease 가 지났고 시도 수도 소진한 작업을 {@code failed} 로 닫는다 — 앱이 끝없이 기다리지 않게.
     *
     * @return 닫은 요청 수
     */
    int sweepExpired(Instant now);
}
