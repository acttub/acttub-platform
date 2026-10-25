package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.app.ReadingExampleRepository;
import com.acttub.actingapi.feature.reading.domain.ReadingExample;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 예시 대본의 Postgres 구현 — {@code reading_examples} (V61). native SQL 만 쓴다(Schema Entity 없음). draft 는 jsonb 를 글로
 * 읽어 여기서 푼다: {@code {"characters": [...], "lines": [{"kind","character","text"}...]}}.
 */
@Repository
class PostgresReadingExampleRepository implements ReadingExampleRepository {

    private static final String SELECT = "SELECT id,title,summary,raw_text,CAST(draft AS text) AS draft FROM reading_examples WHERE active";

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ObjectMapper mapper;

    PostgresReadingExampleRepository(EntityManager entityManager, PlatformTransactionManager transactionManager, ObjectMapper mapper) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.mapper = mapper;
    }

    @Override
    public List<ReadingExample> listActive() {
        return NativeTuples.list(entityManager.createNativeQuery(SELECT + " ORDER BY sort_order,id", Tuple.class))
                .stream().map(this::example).toList();
    }

    @Override
    public ReadingExample findActive(String id) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(SELECT + " AND id=:id", Tuple.class)
                .setParameter("id", id));
        return rows.isEmpty() ? null : example(rows.getFirst());
    }

    @Override
    public UUID sameText(UUID userId, String rawHash) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM scripts WHERE user_id=:userId AND raw_hash=:hash ORDER BY created_at,id LIMIT 1", Tuple.class)
                .setParameter("userId", userId)
                .setParameter("hash", rawHash));
        return rows.isEmpty() ? null : rows.getFirst().get("id", UUID.class);
    }

    @Override
    public <T> T withOwnerLock(UUID userId, Supplier<T> work) {
        return transaction.execute(status -> {
            // ScriptRepository·탈퇴와 같은 순서로 users 행을 먼저 잡는다. 활성 여부는 대본 저장이 본다.
            entityManager.createNativeQuery("SELECT id FROM users WHERE id=:userId FOR UPDATE")
                    .setParameter("userId", userId).getResultList();
            return work.get();
        });
    }

    private ReadingExample example(Tuple row) {
        JsonNode draft;
        try {
            draft = mapper.readTree(row.get("draft", String.class));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("reading_examples.draft is not JSON: " + row.get("id", String.class), e);
        }
        List<String> characters = new ArrayList<>();
        draft.path("characters").forEach(name -> characters.add(name.textValue()));
        List<ReadingExample.Line> lines = new ArrayList<>();
        draft.path("lines").forEach(line -> lines.add(new ReadingExample.Line(
                line.path("kind").textValue(),
                line.path("character").isIntegralNumber() ? line.path("character").intValue() : null,
                line.path("text").textValue())));
        return new ReadingExample(row.get("id", String.class), row.get("title", String.class), row.get("summary", String.class),
                row.get("raw_text", String.class), characters, lines);
    }
}
