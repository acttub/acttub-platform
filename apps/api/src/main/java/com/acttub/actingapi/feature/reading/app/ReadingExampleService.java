package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingExample;
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

    public ReadingExampleService(ReadingExampleRepository examples, ScriptService scripts) {
        this.examples = examples;
        this.scripts = scripts;
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

    /** @param created 이번에 복사했으면 {@code true}, 같은 글의 대본이 이미 있었거나 같은 요청의 재전송이면 {@code false} */
    public record Started(UUID scriptId, boolean created) {
    }
}
