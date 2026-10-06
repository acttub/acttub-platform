package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.ImportView;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Requested;
import com.acttub.actingapi.feature.reading.domain.SampleScript;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.ScriptText;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.acttub.actingapi.platform.web.Hashing;

/**
 * 대본 나누기 요청의 규칙 — 글을 받아 작업을 접수하고 상태를 보인다 (reading.script 「나누기 작업」).
 *
 * <p>LLM 을 부르기 전에 끝낼 수 있는 것은 여기서 끝낸다: 동의 없음(403 {@code script_split_consent_required}), 원문 한도
 * (422 {@code script_too_long}), 대본 수 한도(422 {@code script_limit}), 같은 글의 대본(200 중복), 예시 대본(모델 없이 바로
 * 저장), 하루 한도(429 {@code script_split_daily_limit}). 나누기는 {@link ScriptSplitWorker} 가 뒤에서 한다.
 */
public class ScriptImportService {

    private final ScriptImportRepository imports;
    private final ScriptUploadService uploads;
    private final CanonicalJson canonical;
    private final Clock clock;

    public ScriptImportService(ScriptImportRepository imports, ScriptUploadService uploads, CanonicalJson canonical, Clock clock) {
        this.imports = imports;
        this.uploads = uploads;
        this.canonical = canonical;
        this.clock = clock;
    }

    public Ticket request(UUID userId, boolean guest, UUID requestId, Submission submission) {
        // PDF 추출기가 매핑 없는 글자로 내는 NUL 은 Postgres text 가 담지 못한다(22021) — 저장·지문·같은 글 판정 전에 뺀다.
        String title = submission.title() == null ? null : submission.title().replace("\u0000", "");
        String rawText = (submission.uploadId() == null ? submission.rawText() : uploads.text(userId, submission.uploadId()))
                .replace("\u0000", "");
        String source = submission.source();
        if (ScriptRules.length(rawText) > ScriptRules.TEXT_MAX) {
            throw new ApiException(422, "script_too_long");
        }
        if (!"granted".equals(imports.consent(userId))) {
            throw new ApiException(403, "script_split_consent_required");
        }
        String normalizedTitle = title == null || title.isBlank() ? null : title.strip();
        ScriptDraft sample = SampleScript.matches(rawText) ? SampleScript.draft(normalizedTitle, rawText, source) : null;
        Requested requested;
        try {
            requested = imports.request(userId, requestId,
                    fingerprint(normalizedTitle, rawText, source, submission.allowDuplicate(), submission.skipScriptCheck()),
                    new ScriptImportRepository.Submission(normalizedTitle, rawText, ScriptText.hash(rawText), source,
                            submission.allowDuplicate(), submission.skipScriptCheck(), submission.uploadId()),
                    sample, ScriptRules.scriptLimit(guest), ScriptSplitRules.DAILY_IMPORTS, clock.instant());
        } catch (ScriptRepository.OwnerNotActive closed) {
            throw new ApiException(403, "account_deactivated", closed);
        }
        return switch (requested.outcome()) {
            case FINGERPRINT_MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case OVER_SCRIPT_LIMIT -> throw new ApiException(422, "script_limit");
            case OVER_DAILY_LIMIT -> throw new ApiException(429, "script_split_daily_limit");
            case DUPLICATE -> new Ticket(null, requested.duplicateScriptId(), false);
            case REPLAYED, IN_FLIGHT -> new Ticket(requested.importId(), null, false);
            case ACCEPTED -> new Ticket(requested.importId(), null, true);
        };
    }

    public ImportView find(UUID userId, UUID importId) {
        ImportView view = imports.find(userId, importId);
        if (view == null) {
            throw new ApiException(404, "import_not_found");
        }
        return view;
    }

    /** 요청 본문(제목·입력 경로·원문·두 플래그)의 지문. 같은 request_id 에 다른 글이 오면 422 다. */
    String fingerprint(String title, String rawText, String source, boolean allowDuplicate, boolean skipScriptCheck) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", title);
        payload.put("source", source);
        payload.put("raw_text", rawText);
        payload.put("allow_duplicate", allowDuplicate);
        payload.put("skip_script_check", skipScriptCheck);
        return Hashing.sha256Hex(canonical.bytes(Map.of("kind", "script_import", "payload", payload)));
    }

    /**
     * 요청이 실어 온 것.
     *
     * @param allowDuplicate R2.7 「새로 넣기」 — 같은 글의 대본·진행 중 요청이 있어도 새로 나눈다
     * @param skipScriptCheck R2.8 「그래도 나누기」 — 첫 호출의 대본 여부 판정을 묻지 않는다
     * @param uploadId 원본 파일로 넣으면 그 파일에서 뽑은 글을 쓴다({@code rawText} 는 {@code null})
     */
    public record Submission(String title, String rawText, String source, boolean allowDuplicate, boolean skipScriptCheck,
            UUID uploadId) {
    }

    /**
     * @param importId 접수한 요청. 중복이면 {@code null}
     * @param duplicateScriptId 같은 글인 기존 대본. 중복일 때만
     * @param accepted 이번에 새로 접수했으면 참(202), 재전송·진행 중·중복이면 거짓(200)
     */
    public record Ticket(UUID importId, UUID duplicateScriptId, boolean accepted) {
    }
}
