package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.feature.reading.adapter.db.JoinedColumn.SEPARATOR;
import static com.acttub.actingapi.feature.reading.adapter.db.JoinedColumn.split;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptFileCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LastSessionView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LineView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptCardView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptListView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.ReadingLayout;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.feature.reading.domain.ScriptText;
import com.acttub.actingapi.feature.reading.domain.CharacterTraits;
import com.acttub.actingapi.feature.reading.domain.VoiceAssignment;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import com.acttub.actingapi.feature.reading.schema.ScriptCharacterEntity;
import com.acttub.actingapi.feature.reading.schema.ScriptEntity;
import com.acttub.actingapi.feature.reading.schema.ScriptLineEntity;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ScriptSource;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 대본의 쓰기는 <b>탈퇴·이관과 같은 {@code users} 행을 {@code FOR UPDATE} 로 잡은 채</b> 한다
 * (apps/api/CONTRACT.md §6-8, specs/reading 「리딩 자료의 이관·삭제·탈퇴」). 그 행이 활성이 아니면 아무것도
 * 쓰지 않는다 — 게이트를 지난 뒤에 끝난 탈퇴·이관 뒤로 옛 계정에 대본이 생기지 않는다. 같은 회원의 등록이
 * 겹쳐도 여기서 줄을 서므로 개수 한도가 정확하다.
 *
 * <p>집계(대사 수·녹음 수·마지막 회차·상태 칩)는 컬럼을 두지 않고 조회할 때 센다. 배열 컬럼과 이름 목록은
 * 구분자로 이어 붙여 읽는다 — Hibernate 의 네이티브 결과가 Postgres 배열을 어떻게 돌려주는지에 기대지 않는다.
 */
@Repository
class PostgresScriptRepository implements ScriptRepository {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;
    private final ScriptFileCleanup sources;

    PostgresScriptRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            ReadingRecordingCleanup cleanup,
            ScriptFileCleanup sources) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
        this.sources = sources;
    }

    @Override
    public Creation create(UUID userId, UUID requestId, String fingerprint, ScriptDraft draft, int limit) {
        return transaction.execute(status -> {
            lockActive(userId);
            // 재전송은 개수 검사보다 먼저다 — 마지막 허용 대본의 재시도가 실패하지 않는다.
            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,request_fingerprint
                    FROM scripts
                    WHERE user_id=:userId
                      AND request_id=:requestId
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("requestId", requestId));
            if (!existing.isEmpty()) {
                Tuple row = existing.getFirst();
                boolean same = fingerprint.equals(row.get("request_fingerprint", String.class));
                return same
                        ? new Creation(row.get("id", UUID.class), false, Outcome.REPLAYED)
                        : new Creation(null, false, Outcome.FINGERPRINT_MISMATCH);
            }
            Number count = (Number) entityManager.createNativeQuery(
                    "SELECT count(*) FROM scripts WHERE user_id=:userId")
                    .setParameter("userId", userId)
                    .getSingleResult();
            if (count.intValue() >= limit) {
                return new Creation(null, false, Outcome.OVER_LIMIT);
            }
            UUID scriptId = UUID.randomUUID();
            entityManager.persist(new ScriptEntity(
                    scriptId, userId, draft.title(), draft.rawText(), ScriptText.hash(draft.rawText()), source(draft.source()),
                    requestId, fingerprint));
            List<UUID> characterIds = new ArrayList<>();
            for (int order = 0; order < draft.characterNames().size(); order++) {
                characterIds.add(UUID.randomUUID());
            }
            for (int order = 0; order < draft.characterNames().size(); order++) {
                CharacterTraits traits = draft.characterTraits().get(order);
                List<Integer> members = draft.characterMembers().get(order);
                entityManager.persist(new ScriptCharacterEntity(characterIds.get(order), scriptId, draft.characterNames().get(order), order, null,
                        traits.gender(), traits.ageBand(), members.isEmpty() ? null : members.stream().map(characterIds::get).toArray(UUID[]::new),
                        draft.unnamedCast()));
            }
            for (ScriptDraft.Line line : draft.lines()) {
                entityManager.persist(new ScriptLineEntity(
                        UUID.randomUUID(),
                        scriptId,
                        line.ordinal(),
                        kind(line.kind()),
                        line.characterIndex() == null ? null : characterIds.get(line.characterIndex()),
                        line.text(),
                        line.lang(),
                        line.speech()));
            }
            entityManager.flush();
            return new Creation(scriptId, true, Outcome.CREATED);
        });
    }

    @Override
    public ScriptView find(UUID userId, UUID scriptId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT s.id,s.title,s.source,s.created_at,s.updated_at,
                       (SELECT count(*) FROM reading_recordings r
                        JOIN reading_sessions rs ON rs.id=r.reading_session_id
                        WHERE rs.script_id=s.id) AS recording_count,
                       (SELECT rs.id FROM reading_sessions rs
                        WHERE rs.script_id=s.id AND rs.status='in_progress'
                        ORDER BY rs.started_at DESC,rs.id DESC
                        LIMIT 1) AS open_session_id,
                       ls.id AS last_session_id,ls.status AS last_status,ls.started_at AS last_started_at,
                       ls.ended_at AS last_ended_at,
                       (SELECT string_agg(CAST(c.id AS text),:sep ORDER BY c.sort_order) FROM script_characters c
                        WHERE c.id=ANY(ls.my_character_ids)) AS my_character_ids,
                       (SELECT string_agg(c.name,:sep ORDER BY c.sort_order) FROM script_characters c
                        WHERE c.id=ANY(ls.my_character_ids)) AS my_character_names
                FROM scripts s
                LEFT JOIN LATERAL (
                    SELECT rs.id,rs.status,rs.started_at,rs.ended_at,rs.my_character_ids
                    FROM reading_sessions rs
                    WHERE rs.script_id=s.id
                    ORDER BY rs.started_at DESC,rs.id DESC
                    LIMIT 1
                ) ls ON true
                WHERE s.id=:scriptId
                  AND s.user_id=:userId
                """, Tuple.class)
                .setParameter("sep", SEPARATOR)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        List<LineView> lines = lines(scriptId);
        return new ScriptView(
                scriptId,
                row.get("title", String.class),
                ScriptSource.valueOf(row.get("source", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                characters(scriptId),
                lines,
                ReadingLayout.of(lines.stream()
                        .map(line -> new ReadingLayout.Line(line.id(), line.kind(), line.text()))
                        .toList()).scenes(),
                row.get("recording_count", Number.class).intValue(),
                row.get("open_session_id", UUID.class),
                lastSession(row),
                row.get("created_at", Instant.class),
                row.get("updated_at", Instant.class));
    }

    @Override
    public ScriptListView list(UUID userId, String query) {
        String pattern = query.isEmpty() ? null : "%" + escapeLike(query) + "%";
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT s.id,s.title,s.created_at,s.updated_at,
                       (SELECT count(*) FROM script_lines l WHERE l.script_id=s.id AND l.kind='dialogue') AS dialogue_count,
                       (SELECT count(*) FROM reading_recordings r
                        JOIN reading_sessions rs ON rs.id=r.reading_session_id
                        WHERE rs.script_id=s.id) AS recording_count,
                       (SELECT max(rs.updated_at) FROM reading_sessions rs WHERE rs.script_id=s.id) AS last_practiced_at,
                       EXISTS (SELECT 1 FROM reading_sessions rs
                               WHERE rs.script_id=s.id AND rs.status='in_progress') AS open,
                       ls.status AS last_status,
                       (SELECT string_agg(c.name,:sep ORDER BY c.sort_order) FROM script_characters c
                        WHERE c.id=ANY(ls.my_character_ids)) AS my_character_names
                FROM scripts s
                LEFT JOIN LATERAL (
                    SELECT rs.status,rs.my_character_ids
                    FROM reading_sessions rs
                    WHERE rs.script_id=s.id
                    ORDER BY rs.started_at DESC,rs.id DESC
                    LIMIT 1
                ) ls ON true
                WHERE s.user_id=:userId
                  AND (CAST(:pattern AS text) IS NULL
                       OR s.title ILIKE CAST(:pattern AS text) ESCAPE '\\'
                       OR EXISTS (SELECT 1 FROM script_characters c
                                  WHERE c.script_id=s.id AND c.name ILIKE CAST(:pattern AS text) ESCAPE '\\'))
                ORDER BY s.updated_at DESC,s.id DESC
                """, Tuple.class)
                .setParameter("sep", SEPARATOR)
                .setParameter("userId", userId)
                .setParameter("pattern", pattern));
        List<ScriptCardView> cards = new ArrayList<>();
        for (Tuple row : rows) {
            boolean open = Boolean.TRUE.equals(row.get("open", Boolean.class));
            String lastStatus = row.get("last_status", String.class);
            Instant lastPracticedAt = row.get("last_practiced_at", Instant.class);
            Instant createdAt = row.get("created_at", Instant.class);
            cards.add(new ScriptCardView(
                    row.get("id", UUID.class),
                    row.get("title", String.class),
                    split(row.get("my_character_names", String.class)),
                    row.get("dialogue_count", Number.class).intValue(),
                    row.get("recording_count", Number.class).intValue(),
                    lastPracticedAt,
                    lastPracticedAt == null ? createdAt : lastPracticedAt,
                    chip(open, lastStatus),
                    createdAt,
                    row.get("updated_at", Instant.class)));
        }
        Tuple totals = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reading_sessions rs
                                                      WHERE rs.script_id=s.id AND rs.status='in_progress')) AS in_progress
                FROM scripts s
                WHERE s.user_id=:userId
                """, Tuple.class)
                .setParameter("userId", userId)).getFirst();
        return new ScriptListView(
                cards,
                totals.get("total", Number.class).intValue(),
                totals.get("in_progress", Number.class).intValue());
    }

    @Override
    public UpdateOutcome update(UUID userId, UUID scriptId, String title, List<CharacterPatch> characters) {
        return transaction.execute(status -> {
            lockActive(userId);
            boolean owned = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)
                    .setParameter("userId", userId)).isEmpty();
            if (!owned) {
                return null;
            }
            Map<UUID, String> names = new LinkedHashMap<>();
            for (Tuple row : NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,name FROM script_characters WHERE script_id=:scriptId ORDER BY sort_order
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId))) {
                names.put(row.get("id", UUID.class), row.get("name", String.class));
            }
            Set<UUID> patched = new HashSet<>();
            for (CharacterPatch patch : characters) {
                if (!names.containsKey(patch.id()) || !patched.add(patch.id())) {
                    return UpdateOutcome.INVALID_CHARACTERS;
                }
                if (patch.name() != null) {
                    names.put(patch.id(), patch.name());
                }
            }
            if (!ScriptRules.namesAllowed(names.values())) {
                return UpdateOutcome.INVALID_CHARACTERS;
            }
            // 두 배역의 이름을 맞바꾸면 문장 사이에서 잠시 겹친다 — 유일 제약을 커밋까지 미룬다.
            entityManager.createNativeQuery("SET CONSTRAINTS uq_script_characters_script_name DEFERRED").executeUpdate();
            for (CharacterPatch patch : characters) {
                entityManager.createNativeQuery("""
                        UPDATE script_characters
                        SET name=COALESCE(CAST(:name AS text),name),
                            unnamed=unnamed AND CAST(:name AS text) IS NULL,
                            voice_preset=CASE WHEN :voiceSet THEN CAST(:voice AS text) ELSE voice_preset END,
                            updated_at=now()
                        WHERE id=:id
                          AND script_id=:scriptId
                        """)
                        .setParameter("name", patch.name())
                        .setParameter("voiceSet", patch.voicePresetSet())
                        .setParameter("voice", patch.voicePreset())
                        .setParameter("id", patch.id())
                        .setParameter("scriptId", scriptId)
                        .executeUpdate();
            }
            entityManager.createNativeQuery("""
                    UPDATE scripts
                    SET title=COALESCE(CAST(:title AS text),title),updated_at=now()
                    WHERE id=:scriptId
                    """)
                    .setParameter("title", title)
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            return UpdateOutcome.UPDATED;
        });
    }

    @Override
    public LineEditOutcome editLine(UUID userId, UUID scriptId, UUID lineId, LinePatch patch) {
        return transaction.execute(status -> {
            lockActive(userId);
            boolean owned = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)
                    .setParameter("userId", userId)).isEmpty();
            if (!owned) {
                return null;
            }
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT kind,character_id FROM script_lines WHERE id=:lineId AND script_id=:scriptId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("lineId", lineId)
                    .setParameter("scriptId", scriptId));
            if (rows.isEmpty()) {
                return LineEditOutcome.LINE_NOT_FOUND;
            }
            String kind = patch.kind() == null ? rows.get(0).get("kind", String.class) : patch.kind();
            boolean dialogue = ScriptLineKind.DIALOGUE.dbValue().equals(kind);
            UUID character;
            if (!dialogue) {
                if (patch.characterId() != null) {
                    return LineEditOutcome.INVALID_LINE;
                }
                character = null;
            } else {
                character = patch.characterId() != null ? patch.characterId() : rows.get(0).get("character_id", UUID.class);
                if (character == null || NativeTuples.list(entityManager.createNativeQuery("""
                        SELECT id FROM script_characters WHERE id=:characterId AND script_id=:scriptId
                        """, Tuple.class)
                        .setParameter("characterId", character)
                        .setParameter("scriptId", scriptId)).isEmpty()) {
                    return LineEditOutcome.INVALID_LINE;
                }
            }
            entityManager.createNativeQuery("""
                    UPDATE script_lines
                    SET kind=:kind,character_id=:characterId,text=COALESCE(CAST(:text AS text),text),
                        lang=CASE WHEN CAST(:text AS text) IS NULL OR CAST(:text AS text)=text THEN lang END,
                        speech=CASE WHEN CAST(:text AS text) IS NULL OR CAST(:text AS text)=text THEN speech END
                    WHERE id=:lineId
                    """)
                    .setParameter("kind", kind)
                    .setParameter("characterId", character)
                    .setParameter("text", patch.text())
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            entityManager.createNativeQuery("UPDATE scripts SET updated_at=now() WHERE id=:scriptId")
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            return LineEditOutcome.UPDATED;
        });
    }

    @Override
    public LineRemoval deleteLine(UUID userId, UUID scriptId, UUID lineId, Instant now) {
        return transaction.execute(status -> {
            lockActive(userId);
            if (!lockOwnedScript(userId, scriptId)) {
                return null;
            }
            List<Tuple> target = lockLine(scriptId, lineId);
            if (target.isEmpty()) {
                return new LineRemoval(LineEditOutcome.LINE_NOT_FOUND, null);
            }
            int ordinal = target.get(0).get("ordinal", Integer.class);
            long remaining = ((Number) entityManager.createNativeQuery(
                            "SELECT count(*) FROM script_lines WHERE script_id=:scriptId AND id<>:lineId")
                    .setParameter("scriptId", scriptId)
                    .setParameter("lineId", lineId)
                    .getSingleResult()).longValue();
            if (remaining == 0) {
                return new LineRemoval(LineEditOutcome.INVALID_LINE, null);
            }
            // 이 줄을 구간 시작·끝·진행 위치로 가리키는 회차마다, 구간 안에 남는 대사로 옮길 자리를 먼저 다 정한다 —
            // 하나라도 비면 아무것도 바꾸지 않는다.
            List<Tuple> sessions = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT rs.id,rs.start_line_id,rs.end_line_id,rs.current_line_id,s.ordinal AS start_ordinal,e.ordinal AS end_ordinal
                    FROM reading_sessions rs
                    JOIN script_lines s ON s.id=rs.start_line_id
                    JOIN script_lines e ON e.id=rs.end_line_id
                    WHERE rs.script_id=:scriptId
                      AND :lineId IN (rs.start_line_id,rs.end_line_id,rs.current_line_id)
                    FOR UPDATE OF rs
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)
                    .setParameter("lineId", lineId));
            List<UUID[]> moves = new ArrayList<>();
            for (Tuple session : sessions) {
                List<Tuple> dialogues = NativeTuples.list(entityManager.createNativeQuery("""
                        SELECT id,ordinal FROM script_lines
                        WHERE script_id=:scriptId AND kind='dialogue' AND id<>:lineId AND ordinal BETWEEN :from AND :to
                        ORDER BY ordinal
                        """, Tuple.class)
                        .setParameter("scriptId", scriptId)
                        .setParameter("lineId", lineId)
                        .setParameter("from", session.get("start_ordinal", Integer.class))
                        .setParameter("to", session.get("end_ordinal", Integer.class)));
                if (dialogues.isEmpty()) {
                    return new LineRemoval(LineEditOutcome.EMPTY_RANGE, null);
                }
                UUID first = dialogues.get(0).get("id", UUID.class);
                UUID last = dialogues.get(dialogues.size() - 1).get("id", UUID.class);
                UUID after = dialogues.stream()
                        .filter(line -> line.get("ordinal", Integer.class) > ordinal)
                        .map(line -> line.get("id", UUID.class))
                        .findFirst()
                        .orElse(last);
                moves.add(new UUID[] {
                    session.get("id", UUID.class),
                    lineId.equals(session.get("start_line_id", UUID.class)) ? first : session.get("start_line_id", UUID.class),
                    lineId.equals(session.get("end_line_id", UUID.class)) ? last : session.get("end_line_id", UUID.class),
                    lineId.equals(session.get("current_line_id", UUID.class)) ? after : session.get("current_line_id", UUID.class),
                });
            }
            for (UUID[] move : moves) {
                entityManager.createNativeQuery("""
                        UPDATE reading_sessions SET start_line_id=:start,end_line_id=:end,current_line_id=:current WHERE id=:id
                        """)
                        .setParameter("id", move[0])
                        .setParameter("start", move[1])
                        .setParameter("end", move[2])
                        .setParameter("current", move[3])
                        .executeUpdate();
            }
            entityManager.createNativeQuery("""
                    UPDATE reading_sessions
                    SET line_results=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(line_results) e
                                               WHERE e->>'line_id'<>CAST(:lineId AS text)), '[]'::jsonb),
                        line_said=line_said-CAST(:lineId AS text)
                    WHERE script_id=:scriptId
                    """)
                    .setParameter("scriptId", scriptId)
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            // 녹음 행을 지우면서 객체 키를 같은 트랜잭션에서 장부에 남긴다(대본 지우기와 같다).
            List<String> objectKeys = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH removed AS (DELETE FROM reading_recordings WHERE line_id=:lineId RETURNING object_key)
                    SELECT object_key FROM removed
                    """, Tuple.class)
                    .setParameter("lineId", lineId)).stream()
                    .map(row -> row.get("object_key", String.class))
                    .toList();
            entityManager.createNativeQuery("DELETE FROM line_memorization WHERE line_id=:lineId")
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            entityManager.createNativeQuery("DELETE FROM script_lines WHERE id=:lineId")
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            touch(scriptId);
            return new LineRemoval(LineEditOutcome.UPDATED, objectKeys.isEmpty() ? null : cleanup.schedule(userId, objectKeys, now));
        });
    }

    @Override
    public LineEditOutcome splitLine(UUID userId, UUID scriptId, UUID lineId, String first, String second) {
        return transaction.execute(status -> {
            lockActive(userId);
            if (!lockOwnedScript(userId, scriptId)) {
                return null;
            }
            List<Tuple> target = lockLine(scriptId, lineId);
            if (target.isEmpty()) {
                return LineEditOutcome.LINE_NOT_FOUND;
            }
            Tuple line = target.get(0);
            int ordinal = line.get("ordinal", Integer.class);
            // 순서 유일 제약은 줄마다 바로 검사돼 +1 을 한 번에 못 한다 — 음수로 비켜 두었다가 되돌린다.
            entityManager.createNativeQuery("UPDATE script_lines SET ordinal=-(ordinal+1) WHERE script_id=:scriptId AND ordinal>:ordinal")
                    .setParameter("scriptId", scriptId)
                    .setParameter("ordinal", ordinal)
                    .executeUpdate();
            entityManager.createNativeQuery("UPDATE script_lines SET ordinal=-ordinal WHERE script_id=:scriptId AND ordinal<0")
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            UUID secondId = UUID.randomUUID();
            entityManager.createNativeQuery("""
                    INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text)
                    VALUES (:id,:scriptId,:ordinal,:kind,:characterId,:text)
                    """)
                    .setParameter("id", secondId)
                    .setParameter("scriptId", scriptId)
                    .setParameter("ordinal", ordinal + 1)
                    .setParameter("kind", line.get("kind", String.class))
                    .setParameter("characterId", line.get("character_id", UUID.class))
                    .setParameter("text", second)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE script_lines
                    SET text=:text,
                        lang=CASE WHEN :text=text THEN lang END,
                        speech=CASE WHEN :text=text THEN speech END
                    WHERE id=:lineId
                    """)
                    .setParameter("text", first)
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            // 구간이 그 줄로 끝나던 회차는 나눈 뒤 조각까지 품는다 — 구간에 있던 글이 빠지지 않게.
            entityManager.createNativeQuery("UPDATE reading_sessions SET end_line_id=:secondId WHERE script_id=:scriptId AND end_line_id=:lineId")
                    .setParameter("secondId", secondId)
                    .setParameter("scriptId", scriptId)
                    .setParameter("lineId", lineId)
                    .executeUpdate();
            touch(scriptId);
            return LineEditOutcome.UPDATED;
        });
    }

    private boolean lockOwnedScript(UUID userId, UUID scriptId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId FOR UPDATE
                """, Tuple.class)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId)).isEmpty();
    }

    private List<Tuple> lockLine(UUID scriptId, UUID lineId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT ordinal,kind,character_id FROM script_lines WHERE id=:lineId AND script_id=:scriptId FOR UPDATE
                """, Tuple.class)
                .setParameter("lineId", lineId)
                .setParameter("scriptId", scriptId));
    }

    private void touch(UUID scriptId) {
        entityManager.createNativeQuery("UPDATE scripts SET updated_at=now() WHERE id=:scriptId")
                .setParameter("scriptId", scriptId)
                .executeUpdate();
    }

    @Override
    public List<UUID> delete(UUID userId, UUID scriptId, Instant now) {
        return transaction.execute(status -> {
            boolean owned = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)
                    .setParameter("userId", userId)).isEmpty();
            if (!owned) {
                return null;
            }
            // 녹음 행을 지우면서 객체 키를 같은 트랜잭션에서 장부에 남긴다 — 커밋 뒤 저장소가 실패해도 키를 잃지 않는다.
            List<String> objectKeys = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH removed AS (
                        DELETE FROM reading_recordings r
                        USING reading_sessions rs
                        WHERE rs.id=r.reading_session_id
                          AND rs.script_id=:scriptId
                        RETURNING r.object_key
                    )
                    SELECT object_key FROM removed
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)).stream()
                    .map(row -> row.get("object_key", String.class))
                    .toList();
            // 원본 파일도 대본과 같은 수명이다(reading.script 「원본 파일」).
            List<UUID> scheduled = new ArrayList<>();
            List<Tuple> removedSources = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH removed AS (DELETE FROM script_uploads WHERE script_id=:scriptId RETURNING object_key,expires_at)
                    SELECT object_key,expires_at FROM removed
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId));
            if (!removedSources.isEmpty()) {
                scheduled.add(sources.schedule(userId, removedSources.stream().map(row -> row.get("object_key", String.class)).toList(),
                        now, removedSources.stream().map(row -> row.get("expires_at", Instant.class)).max(Instant::compareTo).orElseThrow()));
            }
            entityManager.createNativeQuery("""
                    DELETE FROM line_memorization m
                    USING script_lines l
                    WHERE l.id=m.line_id
                      AND l.script_id=:scriptId
                    """)
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            // 회차 평가(V40)는 회차보다 먼저 지운다. 평가의 쓰기도 이 대본 행을 잡으므로 겹쳐도 남지 않는다.
            entityManager.createNativeQuery("""
                    DELETE FROM reading_session_ratings r
                    USING reading_sessions rs
                    WHERE rs.id=r.session_id
                      AND rs.script_id=:scriptId
                    """)
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            for (String table : List.of("reading_sessions", "script_lines", "script_characters")) {
                entityManager.createNativeQuery("DELETE FROM " + table + " WHERE script_id=:scriptId")
                        .setParameter("scriptId", scriptId)
                        .executeUpdate();
            }
            entityManager.createNativeQuery("DELETE FROM scripts WHERE id=:scriptId")
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            if (!objectKeys.isEmpty()) scheduled.add(cleanup.schedule(userId, objectKeys, now));
            return scheduled;
        });
    }

    /**
     * 탈퇴·이관과 같은 {@code users} 행을 잡고 활성인지 본다. ⚠ {@code users} 의 주인은 {@code auth} 지만 이
     * 확인은 쓰는 트랜잭션 안에 있어야 뜻이 있어 native SQL 로 잠금만 잡는다(Schema Entity 를 import 하지 않는다).
     */
    private void lockActive(UUID userId) {
        boolean active = !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id
                FROM users
                WHERE id=:userId
                  AND status='active'
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
        if (!active) {
            throw new OwnerNotActive();
        }
    }

    private List<CharacterView> characters(UUID scriptId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.id,c.name,c.sort_order,c.voice_preset,c.gender,c.age_band,array_to_string(c.member_ids,',') AS member_ids,c.unnamed,
                       (SELECT count(*) FROM script_lines l WHERE l.character_id=c.id) AS dialogue_count
                FROM script_characters c
                WHERE c.script_id=:scriptId
                ORDER BY c.sort_order
                """, Tuple.class)
                .setParameter("scriptId", scriptId));
        List<String> voices = VoiceAssignment.assign(rows.stream().map(row -> new VoiceAssignment.Cast(
                row.get("voice_preset", String.class),
                CharacterGender.of(row.get("gender", String.class)),
                CharacterAgeBand.of(row.get("age_band", String.class)))).toList());
        List<CharacterView> characters = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            Tuple row = rows.get(i);
            characters.add(new CharacterView(
                    row.get("id", UUID.class),
                    row.get("name", String.class),
                    row.get("sort_order", Integer.class),
                    row.get("voice_preset", String.class),
                    voices.get(i),
                    row.get("gender", String.class),
                    row.get("age_band", String.class),
                    row.get("dialogue_count", Number.class).intValue(),
                    row.get("member_ids", String.class) == null ? List.of()
                            : Stream.of(row.get("member_ids", String.class).split(",")).map(UUID::fromString).toList(),
                    row.get("unnamed", Boolean.class)));
        }
        return characters;
    }

    /** 대사 번호는 저장하지 않고 순서에서 센다 — 대사 줄만, 1부터. */
    private List<LineView> lines(UUID scriptId) {
        List<LineView> lines = new ArrayList<>();
        int dialogueNo = 0;
        for (Tuple row : NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,ordinal,kind,character_id,text,lang,speech
                FROM script_lines
                WHERE script_id=:scriptId
                ORDER BY ordinal
                """, Tuple.class)
                .setParameter("scriptId", scriptId))) {
            String kind = ScriptLineKind.valueOf(row.get("kind", String.class).toUpperCase(Locale.ROOT)).dbValue();
            boolean dialogue = ScriptLineKind.DIALOGUE.dbValue().equals(kind);
            lines.add(new LineView(
                    row.get("id", UUID.class),
                    row.get("ordinal", Integer.class),
                    kind,
                    row.get("character_id", UUID.class),
                    row.get("text", String.class),
                    dialogue ? ++dialogueNo : null,
                    row.get("lang", String.class),
                    row.get("speech", String.class)));
        }
        return lines;
    }

    private static LastSessionView lastSession(Tuple row) {
        UUID id = row.get("last_session_id", UUID.class);
        if (id == null) {
            return null;
        }
        return new LastSessionView(
                id,
                ReadingSessionStatus.valueOf(row.get("last_status", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                split(row.get("my_character_ids", String.class)).stream().map(UUID::fromString).toList(),
                split(row.get("my_character_names", String.class)),
                row.get("last_started_at", Instant.class),
                row.get("last_ended_at", Instant.class));
    }

    /** 진행 중 회차가 하나라도 있으면 연습 중, 없고 마지막 회차가 완료면 연습 완료, 회차가 없으면 배역 선택. */
    private static String chip(boolean open, String lastStatus) {
        if (open) {
            return "reading";
        }
        if (ReadingSessionStatus.COMPLETED.dbValue().equals(lastStatus)) {
            return "completed";
        }
        return "no_cast";
    }


    /** {@code %}·{@code _}·{@code \} 를 글자 그대로 찾는다. */
    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static ScriptSource source(String value) {
        return ScriptSource.valueOf(value.toUpperCase(Locale.ROOT));
    }

    private static ScriptLineKind kind(String value) {
        return ScriptLineKind.valueOf(value.toUpperCase(Locale.ROOT));
    }
}
