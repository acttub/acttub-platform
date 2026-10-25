package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.ReadingExample;
import com.acttub.actingapi.feature.reading.domain.ReadingExampleAudio;
import com.acttub.actingapi.feature.reading.domain.ScriptText;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 예시 대본 고르기 (reading.script 「예시 대본」). 서버에 미리 나눠 둔 예시를 보이고, 고르면 그 사람의 대본으로 복사한다.
 *
 * <p>모델을 부르지 않으므로 script_split 동의·하루 나누기 한도를 보지 않는다. 대본 수 한도({@code script_limit})와 탈퇴와 겹친
 * 쓰기({@code account_deactivated})는 대본 저장({@link ScriptService#create})이 그대로 본다. 같은 글의 대본이 이미 있으면 새로
 * 만들지 않고 그 대본을 준다 — 지웠으면 다시 복사한다.
 */
public class ReadingExampleService {

    private final ReadingExampleRepository examples;
    private final ScriptService scripts;
    private final VoiceModelStorage storage;

    public ReadingExampleService(ReadingExampleRepository examples, ScriptService scripts, VoiceModelStorage storage) {
        this.examples = examples;
        this.scripts = scripts;
        this.storage = storage;
    }

    public List<ReadingExample> list() {
        return examples.listActive();
    }

    public Started start(UUID userId, boolean guest, UUID requestId, String exampleId) {
        ReadingExample example = examples.findActive(exampleId);
        if (example == null) {
            throw new ApiException(404, "reading_example_not_found");
        }
        String hash = ScriptText.hash(example.rawText());
        return examples.withOwnerLock(userId, () -> {
            UUID existing = examples.sameText(userId, hash);
            if (existing != null) {
                return new Started(existing, false);
            }
            ScriptService.Created created = scripts.create(userId, guest, requestId, example.draft());
            return new Started(created.script().id(), created.created());
        });
    }

    /**
     * 예시를 복사한 대본의 미리 만든 상대역 음성(V62). 원문 해시가 켜진 예시의 원문과 같고 그 예시에 음성이 있어야 한다 — 아니면 404
     * {@code reading_example_audio_not_found}. 줄은 같은 자리·같은 배역·같은 글인 대사만 주고(고친 줄은 뺀다), 주소는 기기 목소리
     * 모델과 같은 1시간 임시 주소다. 상대역이 없는 예시(독백)는 줄이 비어 있다.
     */
    public ExampleAudio audio(UUID userId, UUID scriptId) {
        ScriptView script = scripts.find(userId, scriptId);
        String hash = examples.rawHash(userId, scriptId);
        ReadingExample example = hash == null ? null : examples.listActive().stream()
                .filter(candidate -> candidate.audio() != null && hash.equals(ScriptText.hash(candidate.rawText())))
                .findFirst().orElse(null);
        if (example == null) {
            throw new ApiException(404, "reading_example_audio_not_found");
        }
        Map<UUID, String> names = new java.util.HashMap<>();
        for (CharacterView character : script.characters()) {
            names.put(character.id(), character.name());
        }
        List<ReadingExampleAudio.CopiedLine> copied = script.lines().stream()
                .map(line -> new ReadingExampleAudio.CopiedLine(line.id(), line.ordinal(), line.kind(),
                        line.characterId() == null ? null : names.get(line.characterId()), line.text(), line.speech()))
                .toList();
        List<AudioLine> lines = example.audio().match(example, copied).stream()
                .map(matched -> new AudioLine(matched.lineId(),
                        storage.downloadUrl(matched.objectKey(), VoiceModelService.EXPIRES_IN_SECONDS), matched.durationMs()))
                .toList();
        return new ExampleAudio(example.id(), example.audio().voices(), lines);
    }

    /** @param voices 배역 이름 → 음성을 만든 프리셋. 앱은 지금 목소리가 같은 배역만 이 음성으로 읽는다 */
    public record ExampleAudio(String exampleId, Map<String, String> voices, List<AudioLine> lines) {
    }

    public record AudioLine(UUID lineId, String url, int durationMs) {
    }

    /** @param created 이번에 복사했으면 {@code true}, 같은 글의 대본이 이미 있었거나 같은 요청의 재전송이면 {@code false} */
    public record Started(UUID scriptId, boolean created) {
    }
}
