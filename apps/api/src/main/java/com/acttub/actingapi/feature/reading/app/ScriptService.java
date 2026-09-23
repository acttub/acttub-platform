package com.acttub.actingapi.feature.reading.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.app.ScriptRepository.CharacterPatch;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.Creation;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.UpdateOutcome;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptListView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJson;

/**
 * 대본의 규칙 — 기기가 나눈 대본을 한 요청으로 저장하고, 목록·상세를 보이고, 제목·배역 이름만 고치고, 행째
 * 지운다 (reading.script, ADR-031).
 *
 * <p>값의 형태(필수 키·타입·값 목록·배역 자리)는 요청을 받는 자리가 보고 422 배열로 답한다. 여기서 거절하는
 * 것은 <b>규칙</b>이고 본문은 사유 코드 하나다: 배역 없음({@code no_characters}), 비거나 겹치는 이름
 * ({@code invalid_characters}), 한도({@code script_too_long}·{@code script_limit}), 같은 요청 id 에 다른 본문
 * ({@code request_fingerprint_mismatch}), 없는 것과 남의 것({@code script_not_found}).
 *
 * <p>재전송은 지문으로 가른다. 생성 요청의 정규화한 본문 지문을 만들 때 저장하고 뒤에 제목·배역 이름을 고쳐도
 * 바꾸지 않으므로, 수정 뒤에 원래 요청이 다시 와도 같은 대본이다.
 */
public class ScriptService {

    private final ScriptRepository scripts;
    private final ReadingRecordingCleanup cleanup;
    private final CanonicalJson canonical;
    private final Clock clock;

    public ScriptService(ScriptRepository scripts, ReadingRecordingCleanup cleanup, CanonicalJson canonical, Clock clock) {
        this.scripts = scripts;
        this.cleanup = cleanup;
        this.canonical = canonical;
        this.clock = clock;
    }

    /**
     * 한 요청으로 저장한다. 연결이 끊겨 같은 요청이 다시 오면 먼저 만든 대본을 돌려준다({@code created=false}).
     * 재전송은 개수 검사보다 먼저라 마지막 허용 대본의 재시도가 실패하지 않는다.
     */
    public Created create(UUID userId, boolean guest, UUID requestId, ScriptDraft draft) {
        ScriptRules.Rejection rejection = ScriptRules.check(draft);
        if (rejection != null) {
            throw switch (rejection) {
                case NO_CHARACTERS -> new ApiException(422, "no_characters");
                case INVALID_CHARACTERS -> invalidCharacters();
                case TOO_LONG -> new ApiException(422, "script_too_long");
            };
        }
        Creation creation = activeOnly(() -> scripts.create(
                userId, requestId, fingerprint(draft), draft, ScriptRules.scriptLimit(guest)));
        switch (creation.outcome()) {
            case FINGERPRINT_MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case OVER_LIMIT -> throw new ApiException(422, "script_limit");
            default -> { }
        }
        return new Created(find(userId, creation.scriptId()), creation.created());
    }

    public ScriptView find(UUID userId, UUID scriptId) {
        ScriptView script = scripts.find(userId, scriptId);
        if (script == null) {
            throw notFound();
        }
        return script;
    }

    public ScriptListView list(UUID userId, String query) {
        return scripts.list(userId, query == null ? "" : query.strip());
    }

    /**
     * 제목과 배역의 이름·목소리만 고친다. 이름은 앞뒤 공백을 정리하고, 비어 있거나 같은 대본 안에서 겹치면 422
     * {@code invalid_characters} 다. 배역 id 와 줄의 연결, 목소리, 지문은 그대로다.
     */
    public ScriptView update(UUID userId, UUID scriptId, String title, List<CharacterPatch> characters) {
        List<CharacterPatch> normalized = new ArrayList<>();
        for (CharacterPatch patch : characters) {
            String name = patch.name() == null ? null : ScriptRules.normalizedName(patch.name());
            if (patch.name() != null && name == null) {
                throw invalidCharacters();
            }
            if (patch.voicePresetSet() && !ScriptRules.voicePresetAllowed(patch.voicePreset())) {
                throw invalidCharacters();
            }
            normalized.add(new CharacterPatch(patch.id(), name, patch.voicePresetSet(), patch.voicePreset()));
        }
        UpdateOutcome outcome = activeOnly(() -> scripts.update(
                userId, scriptId, title == null ? null : title.strip(), normalized));
        if (outcome == null) {
            throw notFound();
        }
        if (outcome == UpdateOutcome.INVALID_CHARACTERS) {
            throw invalidCharacters();
        }
        return find(userId, scriptId);
    }

    /**
     * 배역·줄·회차·녹음·암기 상태와 함께 행째 지운다. 되돌릴 수 없다. 녹음 객체의 삭제는 행을 지운 트랜잭션이
     * 정리 장부에 올려 두었다 — 저장소가 실패해도 요청은 끝나고 장부가 다시 시도한다.
     */
    public void delete(UUID userId, UUID scriptId) {
        List<UUID> scheduled = scripts.delete(userId, scriptId, clock.instant());
        if (scheduled == null) {
            throw notFound();
        }
        cleanup.attempt(scheduled);
    }

    /**
     * 생성 요청의 정규화한 본문 지문 — 제목·입력 경로·원문·배역 이름·줄의 SHA-256. 키 순서를 고정한 JSON
     * 바이트가 입력이라 같은 요청은 언제나 같은 지문이다.
     */
    String fingerprint(ScriptDraft draft) {
        List<Map<String, Object>> lines = new ArrayList<>();
        for (ScriptDraft.Line line : draft.lines()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("ordinal", line.ordinal());
            entry.put("kind", line.kind());
            entry.put("character_index", line.characterIndex());
            entry.put("text", line.text());
            lines.add(entry);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", draft.title());
        payload.put("source", draft.source());
        payload.put("raw_text", draft.rawText());
        payload.put("characters", draft.characterNames());
        payload.put("lines", lines);
        byte[] bytes = canonical.bytes(Map.of("kind", "script_create", "payload", payload));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /**
     * 게이트를 지난 뒤에 다른 기기의 탈퇴·이관이 먼저 끝났으면 저장소가 쓰지 않고 알린다. 게이트가 했을 답을
     * 그대로 준다 — 기기는 그 사유로 옛 계정의 쓰기와 재시도를 멈춘다.
     */
    private static <T> T activeOnly(Supplier<T> write) {
        try {
            return write.get();
        } catch (ScriptRepository.OwnerNotActive closed) {
            throw new ApiException(403, "account_deactivated", closed);
        }
    }

    private static ApiException invalidCharacters() {
        return new ApiException(422, "invalid_characters");
    }

    private static ApiException notFound() {
        return new ApiException(404, "script_not_found");
    }

    /** @param created 이번에 만들었으면 {@code true}, 같은 요청의 재전송이면 {@code false} */
    public record Created(ScriptView script, boolean created) {
    }
}
