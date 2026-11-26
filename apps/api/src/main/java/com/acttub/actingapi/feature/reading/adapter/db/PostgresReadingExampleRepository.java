package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.reading.app.ReadingExampleRepository;
import com.acttub.actingapi.feature.reading.domain.ReadingExample;
import com.acttub.actingapi.feature.reading.domain.ReadingExampleAudio;
import com.acttub.actingapi.feature.reading.schema.ReadingExampleEntity;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 예시 대본의 Postgres 구현 — {@code reading_examples} (V61, 미리 만든 음성 audio 는 V62). draft 는 jsonb 를 글로
 * 읽어 여기서 푼다: {@code {"characters": [...], "lines": [{"kind","character","text"}...]}}. {@code users} 는 auth 의 표라 그
 * 잠금만 native SQL 로 둔다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresReadingExampleRepository implements ReadingExampleRepository {
    private static final Logger log = LoggerFactory.getLogger(PostgresReadingExampleRepository.class);

    private final EntityManager entityManager;
    private final ReadingExampleJpaRepository examples;
    private final ScriptJpaRepository scripts;
    private final TransactionTemplate transaction;
    private final ObjectMapper mapper;

    private final AccountRowLock accountRows;

    PostgresReadingExampleRepository(EntityManager entityManager, ReadingExampleJpaRepository examples, ScriptJpaRepository scripts,
            PlatformTransactionManager transactionManager, ObjectMapper mapper,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.entityManager = entityManager;
        this.examples = examples;
        this.scripts = scripts;
        this.transaction = new TransactionTemplate(transactionManager);
        this.mapper = mapper;
    }

    @Override
    public List<ReadingExample> listActive() {
        return examples.active().stream().map(this::example).toList();
    }

    @Override
    public List<ReadingExample> listActive(String language) {
        return examples.active(language).stream().map(this::example).toList();
    }

    @Override
    public ReadingExample findActive(String id) {
        return examples.findActive(id).map(this::example).orElse(null);
    }

    @Override
    public UUID sameText(UUID userId, String rawHash) {
        List<UUID> oldest = scripts.sameText(userId, rawHash, Limit.of(1));
        return oldest.isEmpty() ? null : oldest.getFirst();
    }

    @Override
    public String rawHash(UUID userId, UUID scriptId) {
        return scripts.rawHash(userId, scriptId).orElse(null);
    }

    @Override
    public <T> T withOwnerLock(UUID userId, Supplier<T> work) {
        return transaction.execute(status -> {
            // ScriptRepository·탈퇴와 같은 순서로 users 행을 먼저 잡는다. 활성 여부는 대본 저장이 본다.
            accountRows.lockRow(userId);
            return work.get();
        });
    }

    private ReadingExample example(ReadingExampleEntity row) {
        JsonNode draft;
        try {
            draft = mapper.readTree(row.getDraft());
        } catch (JacksonException e) {
            throw new IllegalStateException("reading_examples.draft is not JSON: " + row.getId(), e);
        }
        List<String> characters = new ArrayList<>();
        draft.path("characters").forEach(name -> characters.add(name.stringValue(null)));
        List<ReadingExample.Line> lines = new ArrayList<>();
        draft.path("lines").forEach(line -> lines.add(new ReadingExample.Line(
                line.path("kind").stringValue(null),
                line.path("character").isIntegralNumber() ? LenientJson.intValue(line.path("character")) : null,
                line.path("text").stringValue(null))));
        return new ReadingExample(row.getId(), row.getTitle(), row.getSummary(), row.getRawText(), characters, lines, audio(row));
    }

    /** 깨진 audio 칸은 음성이 없는 것으로 다룬다 — 목록·복사까지 막지 않고, 앱은 예전처럼 모델로 읽는다. */
    private ReadingExampleAudio audio(ReadingExampleEntity row) {
        try {
            return ReadingExampleAudioJson.parse(mapper, row.getAudio());
        } catch (IllegalArgumentException e) {
            log.warn("reading_examples.audio is malformed: id={}", row.getId(), e);
            return null;
        }
    }
}
