package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.CharacterPatch;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.Creation;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.LineEditOutcome;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.LinePatch;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.LineRemoval;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.Outcome;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.UpdateOutcome;
import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LineView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptCardView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptListView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.CharacterTraits;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptText;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 대본 저장소가 내는 결과·잠금·경합·문장을 고정한다. 등록·목록·상세·고치기·줄 편집·삭제의 HTTP 흐름과 화면에 보이는 값은
 * {@link ReadingScriptIT} 가 본다. 여기서는 저장소 한 번의 부름이 적는 칸 전체, 카드와 상세의 집계를 세는 법, 찾기의 글자 그대로
 * 견주기, 줄을 지우고 나누고 넣을 때 순번·회차·녹음·암기에 남기는 것, 사람 → 대본 → 줄 순서의 잠금, 겹친 등록, 요청 하나가
 * 보내는 문장을 본다 — 대본 목록·상세는 요청이 많은 경로라 문장 수가 늘면 안 된다. *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 줄을 지울 때 그 줄의 녹음
 * {@code DELETE … RETURNING} 을 잠가 읽기와 id 로 지우기로 나눠, 녹음이 있는 줄을 지울 때 문장이 하나 늘었다. 목록·상세·등록·
 * 고치기·줄 넣기·나누기·대본 지우기의 문장 수는 그대로이고 결과·잠금·경합 테스트는 고치지 않았다.
 */
class ScriptRepositoryIT extends ReadingRepositoryFixture {

    private static final String FINGERPRINT = "f".repeat(64);

    @Autowired
    ScriptRepository scripts;

    private UUID owner;
    private UUID script;
    private UUID nina;
    private UUID kostya;
    private UUID chorus;
    private UUID scene;
    private UUID first;
    private UUID second;
    private UUID together;
    private UUID last;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        nina = character(script, "니나", 0);
        kostya = character(script, "코스챠", 1);
        chorus = character(script, "니나·코스챠", 2);
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("UPDATE script_characters SET member_ids=? WHERE id=?");
            statement.setArray(1, connection.createArrayOf("uuid", new UUID[] {nina, kostya}));
            statement.setObject(2, chorus);
            return statement;
        });
        scene = line(script, 1, "scene", null, "호숫가");
        first = line(script, 2, "dialogue", nina, "안녕하세요");
        second = line(script, 3, "dialogue", kostya, "왔구나");
        together = line(script, 4, "dialogue", chorus, "함께 말해요");
        last = line(script, 5, "dialogue", nina, "잘 가요");
    }

    // ---- 등록 ----

    @Test
    @DisplayName("create: 대본과 배역(순서·특성·묶음 멤버)과 줄(순번·종류·배역·글·말·읽을 글)을 넣는다. 원문 해시를 함께 적는다")
    void createWritesTheScriptWithItsCastAndLines() {
        UUID author = member();
        UUID request = UUID.randomUUID();
        ScriptDraft draft = new ScriptDraft("갈매기", "원문 글", "paste", List.of("니나", "코스챠", "둘이서"),
                List.of(new ScriptDraft.Line(1, "scene", null, "호숫가"),
                        new ScriptDraft.Line(2, "dialogue", 0, "Hello 니나", "en", "⟦en⟧Hello⟦ko⟧니나"),
                        new ScriptDraft.Line(3, "dialogue", 2, "함께")),
                List.of(new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG), CharacterTraits.UNKNOWN, CharacterTraits.UNKNOWN),
                List.of(List.of(), List.of(), List.of(0, 1)), true);

        Creation created = scripts.create(author, request, FINGERPRINT, draft, 10);

        assertThat(created).isEqualTo(new Creation(created.scriptId(), true, Outcome.CREATED));
        assertThat(jdbc.queryForMap("SELECT user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint FROM scripts WHERE id=?",
                created.scriptId()))
                .containsEntry("user_id", author).containsEntry("title", "갈매기").containsEntry("raw_text", "원문 글")
                .containsEntry("raw_hash", ScriptText.hash("원문 글")).containsEntry("source", "paste")
                .containsEntry("request_id", request).containsEntry("request_fingerprint", FINGERPRINT);
        assertThat(jdbc.queryForObject("SELECT created_at=updated_at FROM scripts WHERE id=?", Boolean.class, created.scriptId()))
                .as("다시 쓰기가 고치지 않은 대본을 이것으로 알아본다").isTrue();
        assertThat(jdbc.queryForList("""
                SELECT name||'/'||sort_order||'/'||COALESCE(gender,'-')||'/'||COALESCE(age_band,'-')||'/'||unnamed||'/'||
                       COALESCE((SELECT string_agg(m.name,'+' ORDER BY m.sort_order) FROM script_characters m WHERE m.id=ANY(c.member_ids)),'-')
                FROM script_characters c WHERE script_id=? ORDER BY sort_order
                """, String.class, created.scriptId()))
                .containsExactly("니나/0/f/young/true/-", "코스챠/1/-/-/true/-", "둘이서/2/-/-/true/니나+코스챠");
        assertThat(jdbc.queryForList("""
                SELECT l.ordinal||'/'||l.kind||'/'||COALESCE(c.name,'-')||'/'||l.text||'/'||COALESCE(l.lang,'-')||'/'||COALESCE(l.speech,'-')
                FROM script_lines l LEFT JOIN script_characters c ON c.id=l.character_id WHERE l.script_id=? ORDER BY l.ordinal
                """, String.class, created.scriptId()))
                .containsExactly("1/scene/-/호숫가/-/-", "2/dialogue/니나/Hello 니나/en/⟦en⟧Hello⟦ko⟧니나", "3/dialogue/둘이서/함께/-/-");
    }

    @Test
    @DisplayName("create: 같은 요청 id 는 지문이 같으면 REPLAYED 로 그 대본을, 다르면 FINGERPRINT_MISMATCH 를 낸다. 대본 수가 한도에 닿았으면 OVER_LIMIT 인데 재전송은 그보다 먼저다. 활성이 아닌 계정은 OwnerNotActive 다")
    void createReplaysAndEnforcesTheLimit() {
        UUID request = UUID.randomUUID();
        Creation created = scripts.create(owner, request, FINGERPRINT, draft("둘째"), 2);

        assertThat(scripts.create(owner, request, FINGERPRINT, draft("둘째"), 2))
                .as("한도에 닿았어도 재전송이 먼저다").isEqualTo(new Creation(created.scriptId(), false, Outcome.REPLAYED));
        assertThat(scripts.create(owner, request, "e".repeat(64), draft("둘째"), 2))
                .isEqualTo(new Creation(null, false, Outcome.FINGERPRINT_MISMATCH));
        assertThat(scripts.create(owner, UUID.randomUUID(), FINGERPRINT, draft("셋째"), 2))
                .isEqualTo(new Creation(null, false, Outcome.OVER_LIMIT));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, owner)).isEqualTo(2);

        UUID closed = member();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);
        assertThatThrownBy(() -> scripts.create(closed, UUID.randomUUID(), FINGERPRINT, draft("닫힌 계정"), 10))
                .isInstanceOf(ScriptRepository.OwnerNotActive.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, closed)).isZero();
    }

    // ---- 읽기 ----

    @Test
    @DisplayName("find: 배역(대사 수는 묶음 배역의 줄까지, 묶음의 멤버)과 줄(대사 번호는 대사 줄만 1부터)과 장면, 녹음 수, 진행 중인 가장 최근 회차, 마지막 회차(내 배역은 배역 순서)를 낸다")
    void findReadsTheScriptWithItsCounts() {
        UUID done = session(owner, script, first, last, kostya, nina);
        jdbc.update("UPDATE reading_sessions SET status='completed', started_at=?, ended_at=? WHERE id=?",
                utc(now.plusSeconds(30)), utc(now.plusSeconds(90)), done);
        UUID open = session(owner, script, first, last, nina);
        jdbc.update("UPDATE reading_sessions SET started_at=? WHERE id=?", utc(now.plusSeconds(10)), open);
        UUID olderOpen = session(owner, script, first, last, nina);
        jdbc.update("UPDATE reading_sessions SET started_at=? WHERE id=?", utc(now.minusSeconds(10)), olderOpen);
        recording(owner, done, first, 1, "reading/a.m4a");
        recording(owner, open, first, 1, "reading/b.m4a");
        recording(owner, open, last, 1, "reading/c.m4a");

        ScriptView view = scripts.find(owner, script);

        assertThat(view.id()).isEqualTo(script);
        assertThat(List.of(view.title(), view.source())).containsExactly("대본", "paste");
        assertThat(view.characters()).extracting(CharacterView::name, CharacterView::order, CharacterView::dialogueCount,
                CharacterView::memberIds, CharacterView::unnamed).containsExactly(
                org.assertj.core.groups.Tuple.tuple("니나", 0, 3, List.of(), false),
                org.assertj.core.groups.Tuple.tuple("코스챠", 1, 2, List.of(), false),
                org.assertj.core.groups.Tuple.tuple("니나·코스챠", 2, 1, List.of(nina, kostya), false));
        assertThat(view.characters()).extracting(CharacterView::voice).as("목소리는 배역마다 배정된다").doesNotContainNull();
        assertThat(view.lines()).containsExactly(
                new LineView(scene, 1, "scene", null, "호숫가", null, null, null),
                new LineView(first, 2, "dialogue", nina, "안녕하세요", 1, null, null),
                new LineView(second, 3, "dialogue", kostya, "왔구나", 2, null, null),
                new LineView(together, 4, "dialogue", chorus, "함께 말해요", 3, null, null),
                new LineView(last, 5, "dialogue", nina, "잘 가요", 4, null, null));
        assertThat(view.scenes()).singleElement().satisfies(found -> {
            assertThat(found.title()).isEqualTo("호숫가");
            assertThat(found.dialogueCount()).isEqualTo(4);
        });
        assertThat(view.recordingCount()).isEqualTo(3);
        assertThat(view.openSessionId()).isEqualTo(open);
        assertThat(view.lastSession().id()).isEqualTo(done);
        assertThat(view.lastSession().status()).isEqualTo("completed");
        assertThat(view.lastSession().myCharacterIds()).as("배역 순서").containsExactly(nina, kostya);
        assertThat(view.lastSession().myCharacterNames()).containsExactly("니나", "코스챠");
        assertThat(view.lastSession().startedAt()).isEqualTo(now.plusSeconds(30));
        assertThat(view.lastSession().endedAt()).isEqualTo(now.plusSeconds(90));
        assertThat(view.createdAt()).isEqualTo(now);
        assertThat(view.updatedAt()).isEqualTo(now);
    }

    @Test
    @DisplayName("find: 회차가 없으면 마지막 회차와 진행 중 회차가 비어 있고 녹음 수는 0 이다. 남의 대본·없는 대본은 null 이다")
    void findWithoutSessions() {
        ScriptView view = scripts.find(owner, script);

        assertThat(view.lastSession()).isNull();
        assertThat(view.openSessionId()).isNull();
        assertThat(view.recordingCount()).isZero();
        assertThat(scripts.find(member(), script)).isNull();
        assertThat(scripts.find(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("list: 내 대본을 고친 시각이 최근인 것부터(같으면 id 가 큰 것부터) 카드로 낸다 — 대사 수, 녹음 수, 마지막 연습 시각(회차가 없으면 만든 시각이 마지막 활동), 상태, 마지막 회차의 내 배역 이름. 전체 수와 진행 중인 대본 수를 함께 낸다")
    void listReturnsCardsAndTotals() {
        UUID reading = script;
        UUID open = session(owner, reading, first, last, kostya, nina);
        jdbc.update("UPDATE reading_sessions SET updated_at=? WHERE id=?", utc(now.plusSeconds(300)), open);
        recording(owner, open, first, 1, "reading/a.m4a");
        UUID completed = scriptAt(owner, "끝낸 대본", now.plusSeconds(20));
        UUID completedLine = line(completed, 1, "dialogue", character(completed, "아르카지나", 0), "끝");
        UUID doneSession = session(owner, completed, completedLine, completedLine);
        jdbc.update("UPDATE reading_sessions SET status='completed', updated_at=? WHERE id=?", utc(now.plusSeconds(100)), doneSession);
        UUID fresh = scriptAt(owner, "새 대본", now.plusSeconds(10));
        scriptAt(member(), "남의 대본", now.plusSeconds(99));

        ScriptListView list = scripts.list(owner, "");

        assertThat(list.scripts()).extracting(ScriptCardView::id).containsExactly(completed, fresh, reading);
        assertThat(list.scripts()).extracting(ScriptCardView::status).containsExactly("completed", "no_cast", "reading");
        assertThat(list.scripts().getLast()).isEqualTo(new ScriptCardView(reading, "대본", List.of("니나", "코스챠"), 4, 1,
                now.plusSeconds(300), now.plusSeconds(300), "reading", now, now));
        assertThat(list.scripts().get(1)).isEqualTo(new ScriptCardView(fresh, "새 대본", List.of(), 0, 0,
                null, now.plusSeconds(10), "no_cast", now.plusSeconds(10), now.plusSeconds(10)));
        assertThat(list.scripts().getFirst().myCharacterNames()).as("전체 듣기 회차").isEmpty();
        assertThat(List.of(list.totalCount(), list.inProgressCount())).containsExactly(3, 1);
        assertThat(scripts.list(member(), "")).isEqualTo(new ScriptListView(List.of(), 0, 0));
    }

    @Test
    @DisplayName("list: 찾는 말은 제목이나 배역 이름에 든 것을 대소문자 없이 고른다. %·_·\\ 는 글자 그대로 찾는다. 전체 수와 진행 중 수는 찾기와 상관없이 내 대본 전체다")
    void listSearchesTitlesAndCharacterNames() {
        UUID percent = scriptAt(owner, "100% Hamlet", now.plusSeconds(10));
        UUID underscore = scriptAt(owner, "a_b", now.plusSeconds(20));
        UUID backslash = scriptAt(owner, "back\\slash", now.plusSeconds(30));
        scriptAt(owner, "axb", now.plusSeconds(40));

        assertThat(scripts.list(owner, "hamlet").scripts()).extracting(ScriptCardView::id).containsExactly(percent);
        assertThat(scripts.list(owner, "코스").scripts()).as("배역 이름").extracting(ScriptCardView::id).containsExactly(script);
        assertThat(scripts.list(owner, "0%").scripts()).extracting(ScriptCardView::id).containsExactly(percent);
        assertThat(scripts.list(owner, "%").scripts()).extracting(ScriptCardView::id).containsExactly(percent);
        assertThat(scripts.list(owner, "a_b").scripts()).as("_ 가 아무 글자로 읽히면 axb 도 나온다")
                .extracting(ScriptCardView::id).containsExactly(underscore);
        assertThat(scripts.list(owner, "k\\s").scripts()).extracting(ScriptCardView::id).containsExactly(backslash);
        assertThat(scripts.list(owner, "없는 말").scripts()).isEmpty();
        assertThat(scripts.list(owner, "없는 말").totalCount()).isEqualTo(5);
    }

    // ---- 고치기 ----

    @Test
    @DisplayName("update: 제목과 배역의 이름·목소리를 고치고 고친 시각을 DB 의 지금으로 올린다. 이름을 주면 이름 없는 배역 표시를 내린다. 두 배역의 이름을 한 번에 맞바꿀 수 있다. 보내지 않은 칸은 그대로다")
    void updateChangesTheTitleAndTheCast() {
        jdbc.update("UPDATE script_characters SET unnamed=true, voice_preset='Kore' WHERE script_id=?", script);

        assertThat(scripts.update(owner, script, "새 제목", List.of(
                new CharacterPatch(nina, "코스챠", true, "Puck"),
                new CharacterPatch(kostya, "니나", false, null)))).isEqualTo(UpdateOutcome.UPDATED);

        assertThat(jdbc.queryForList("SELECT name||'/'||COALESCE(voice_preset,'-')||'/'||unnamed FROM script_characters "
                + "WHERE script_id=? ORDER BY sort_order", String.class, script))
                .containsExactly("코스챠/Puck/false", "니나/Kore/false", "니나·코스챠/Kore/true");
        assertThat(jdbc.queryForObject("SELECT title FROM scripts WHERE id=?", String.class, script)).isEqualTo("새 제목");
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM scripts WHERE id=?", Boolean.class, utc(now.plusSeconds(1)), script))
                .isTrue();
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM script_characters WHERE id=?", Boolean.class,
                utc(now.plusSeconds(1)), nina)).isTrue();

        assertThat(scripts.update(owner, script, null, List.of(new CharacterPatch(nina, null, true, null))))
                .isEqualTo(UpdateOutcome.UPDATED);
        assertThat(jdbc.queryForMap("SELECT name,voice_preset FROM script_characters WHERE id=?", nina))
                .as("이름은 그대로, 목소리는 비운다").containsEntry("name", "코스챠").containsEntry("voice_preset", null);
        assertThat(jdbc.queryForObject("SELECT title FROM scripts WHERE id=?", String.class, script)).isEqualTo("새 제목");
    }

    @Test
    @DisplayName("update: 대본의 배역이 아니거나 같은 배역을 두 번 보내거나 고친 뒤 이름이 겹치면 INVALID_CHARACTERS 이고 아무것도 바꾸지 않는다. 남의 대본은 null, 활성이 아닌 계정은 OwnerNotActive 다")
    void updateValidatesTheCast() {
        assertThat(scripts.update(owner, script, "바뀌면 안 되는 제목", List.of(new CharacterPatch(UUID.randomUUID(), "새 이름", false, null))))
                .isEqualTo(UpdateOutcome.INVALID_CHARACTERS);
        assertThat(scripts.update(owner, script, null, List.of(new CharacterPatch(nina, "하나", false, null),
                new CharacterPatch(nina, "둘", false, null)))).isEqualTo(UpdateOutcome.INVALID_CHARACTERS);
        assertThat(scripts.update(owner, script, null, List.of(new CharacterPatch(nina, "코스챠", false, null))))
                .as("코스챠와 겹친다").isEqualTo(UpdateOutcome.INVALID_CHARACTERS);
        assertThat(jdbc.queryForObject("SELECT title FROM scripts WHERE id=?", String.class, script)).isEqualTo("대본");
        assertThat(jdbc.queryForObject("SELECT name FROM script_characters WHERE id=?", String.class, nina)).isEqualTo("니나");

        assertThat(scripts.update(member(), script, "남의 것", List.of())).isNull();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", owner);
        assertThatThrownBy(() -> scripts.update(owner, script, "닫힌 계정", List.of()))
                .isInstanceOf(ScriptRepository.OwnerNotActive.class);
    }

    @Test
    @DisplayName("editLine: 글을 바꾸면 말과 읽을 글을 비우고 같은 글이면 그대로 둔다. 대사는 이 대본의 배역이 있어야 하고 지문·장면은 배역이 없어야 한다. 대본의 고친 시각을 올린다")
    void editLineChangesTheLine() {
        jdbc.update("UPDATE script_lines SET lang='en', speech='읽을 글' WHERE id IN (?,?)", first, second);

        assertThat(scripts.editLine(owner, script, first, new LinePatch(null, null, "안녕하세요"))).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(lineRow(first)).as("같은 글").isEqualTo("dialogue/니나/안녕하세요/en/읽을 글");
        assertThat(scripts.editLine(owner, script, first, new LinePatch(null, kostya, null))).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(lineRow(first)).as("배역만 바꾼다").isEqualTo("dialogue/코스챠/안녕하세요/en/읽을 글");
        assertThat(scripts.editLine(owner, script, second, new LinePatch(null, null, "어서 와"))).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(lineRow(second)).as("글을 바꾸면 말과 읽을 글을 비운다").isEqualTo("dialogue/코스챠/어서 와/-/-");
        assertThat(scripts.editLine(owner, script, second, new LinePatch("direction", null, null))).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(lineRow(second)).isEqualTo("direction/-/어서 와/-/-");
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM scripts WHERE id=?", Boolean.class, utc(now.plusSeconds(1)), script))
                .isTrue();

        UUID foreign = character(script(owner), "다른 대본의 배역", 0);
        assertThat(scripts.editLine(owner, script, last, new LinePatch("direction", nina, null))).as("지문에 배역")
                .isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.editLine(owner, script, last, new LinePatch(null, foreign, null))).as("다른 대본의 배역")
                .isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.editLine(owner, script, scene, new LinePatch("dialogue", null, null))).as("배역 없는 대사")
                .isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.editLine(owner, script, UUID.randomUUID(), new LinePatch(null, null, "글")))
                .isEqualTo(LineEditOutcome.LINE_NOT_FOUND);
        assertThat(scripts.editLine(member(), script, first, new LinePatch(null, null, "글"))).isNull();
        assertThat(lineRow(last)).isEqualTo("dialogue/니나/잘 가요/-/-");
    }

    @Test
    @DisplayName("deleteLine: 줄과 그 줄의 녹음·암기 표시·줄 결과를 지우고 녹음의 객체를 장부에 올린다. 그 줄을 구간 끝이나 위치로 가리키던 회차는 구간에 남는 대사로 옮긴다. 순번은 당기지 않는다")
    void deleteLineRemovesTheLineAndMovesTheSessions() {
        UUID startsHere = session(owner, script, first, last, nina);
        UUID untouched = session(owner, script, second, last, kostya);
        jdbc.update("UPDATE reading_sessions SET line_results=CAST(? AS jsonb), line_said=CAST(? AS jsonb) WHERE id=?",
                "[{\"line_id\":\"" + first + "\",\"outcome\":\"passed\",\"misses\":0},"
                        + "{\"line_id\":\"" + last + "\",\"outcome\":\"unmatched\",\"misses\":1}]",
                "{\"" + first + "\":\"안녕\",\"" + last + "\":\"잘 가\"}", startsHere);
        recording(owner, startsHere, first, 1, "reading/first.m4a");
        recording(owner, startsHere, last, 1, "reading/last.m4a");
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized'),(?,?,?,'memorized')",
                UUID.randomUUID(), owner, first, UUID.randomUUID(), owner, last);

        LineRemoval removal = scripts.deleteLine(owner, script, first, now);

        assertThat(removal.outcome()).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(scheduledKeys(removal.scheduled())).containsExactly("reading/first.m4a");
        assertThat(jdbc.queryForList("SELECT ordinal FROM script_lines WHERE script_id=? ORDER BY ordinal", Integer.class, script))
                .containsExactly(1, 3, 4, 5);
        assertThat(sessionRow(startsHere)).as("시작과 위치가 다음 대사로").isEqualTo(second + "/" + last + "/" + second);
        assertThat(sessionRow(untouched)).isEqualTo(second + "/" + last + "/" + second);
        assertThat(jdbc.queryForObject("SELECT CAST(line_results AS text)||' '||CAST(line_said AS text) FROM reading_sessions WHERE id=?",
                String.class, startsHere))
                .isEqualTo("[{\"misses\": 1, \"line_id\": \"" + last + "\", \"outcome\": \"unmatched\"}] {\"" + last + "\": \"잘 가\"}");
        assertThat(jdbc.queryForList("SELECT object_key FROM reading_recordings", String.class)).containsExactly("reading/last.m4a");
        assertThat(jdbc.queryForList("SELECT line_id FROM line_memorization", UUID.class)).containsExactly(last);
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM scripts WHERE id=?", Boolean.class, utc(now.plusSeconds(1)), script))
                .isTrue();
    }

    @Test
    @DisplayName("deleteLine: 그 줄로 끝나던 구간은 앞의 대사로 끝을 옮긴다. 구간에 남는 대사가 없으면 EMPTY_RANGE, 마지막 한 줄이면 INVALID_LINE 이고 아무것도 바꾸지 않는다. 녹음이 없으면 장부에 올리지 않는다")
    void deleteLineKeepsEveryRangeNonEmpty() {
        UUID endsAtLast = session(owner, script, first, last, nina);
        jdbc.update("UPDATE reading_sessions SET current_line_id=? WHERE id=?", last, endsAtLast);

        LineRemoval removal = scripts.deleteLine(owner, script, last, now);
        assertThat(removal).isEqualTo(new LineRemoval(LineEditOutcome.UPDATED, null));
        assertThat(sessionRow(endsAtLast)).as("끝과 위치가 구간의 마지막 대사로").isEqualTo(first + "/" + together + "/" + together);

        UUID onlyTogether = session(owner, script, together, together, nina);
        assertThat(scripts.deleteLine(owner, script, together, now)).isEqualTo(new LineRemoval(LineEditOutcome.EMPTY_RANGE, null));
        assertThat(count("script_lines")).isEqualTo(4);
        assertThat(sessionRow(onlyTogether)).isEqualTo(together + "/" + together + "/" + together);
        assertThat(scripts.deleteLine(owner, script, UUID.randomUUID(), now)).isEqualTo(new LineRemoval(LineEditOutcome.LINE_NOT_FOUND, null));
        assertThat(scripts.deleteLine(member(), script, first, now)).isNull();

        UUID single = script(owner);
        UUID onlyLine = line(single, 1, "dialogue", character(single, "니나", 0), "하나뿐");
        assertThat(scripts.deleteLine(owner, single, onlyLine, now)).isEqualTo(new LineRemoval(LineEditOutcome.INVALID_LINE, null));
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("splitLine: 뒤의 줄들을 한 칸씩 밀고 같은 종류·배역의 새 줄을 바로 뒤에 넣는다. 앞 조각의 글이 바뀌면 말과 읽을 글을 비운다. 그 줄로 끝나던 회차는 새 줄까지 품는다")
    void splitLineInsertsTheSecondHalf() {
        jdbc.update("UPDATE script_lines SET lang='en', speech='읽을 글' WHERE id=?", second);
        UUID endsAtSecond = session(owner, script, first, second, nina);
        UUID endsAtLast = session(owner, script, first, last, nina);

        assertThat(scripts.splitLine(owner, script, second, "왔", "구나")).isEqualTo(LineEditOutcome.UPDATED);

        assertThat(jdbc.queryForList("""
                SELECT l.ordinal||'/'||l.kind||'/'||COALESCE(c.name,'-')||'/'||l.text||'/'||COALESCE(l.speech,'-')
                FROM script_lines l LEFT JOIN script_characters c ON c.id=l.character_id WHERE l.script_id=? ORDER BY l.ordinal
                """, String.class, script)).containsExactly("1/scene/-/호숫가/-", "2/dialogue/니나/안녕하세요/-", "3/dialogue/코스챠/왔/-",
                "4/dialogue/코스챠/구나/-", "5/dialogue/니나·코스챠/함께 말해요/-", "6/dialogue/니나/잘 가요/-");
        UUID inserted = jdbc.queryForObject("SELECT id FROM script_lines WHERE script_id=? AND ordinal=4", UUID.class, script);
        assertThat(jdbc.queryForObject("SELECT end_line_id FROM reading_sessions WHERE id=?", UUID.class, endsAtSecond)).isEqualTo(inserted);
        assertThat(jdbc.queryForObject("SELECT end_line_id FROM reading_sessions WHERE id=?", UUID.class, endsAtLast)).isEqualTo(last);
        assertThat(jdbc.queryForObject("SELECT updated_at > ? FROM scripts WHERE id=?", Boolean.class, utc(now.plusSeconds(1)), script))
                .isTrue();

        assertThat(scripts.splitLine(owner, script, UUID.randomUUID(), "가", "나")).isEqualTo(LineEditOutcome.LINE_NOT_FOUND);
        assertThat(scripts.splitLine(member(), script, first, "가", "나")).isNull();
        assertThat(count("script_lines")).isEqualTo(6);
    }

    @Test
    @DisplayName("insertLineAfter: 뒤의 줄들을 한 칸씩 밀고 새 줄을 바로 뒤에 넣는다. 대사는 이 대본의 배역이 있어야 하고 지문·장면은 배역이 없어야 한다")
    void insertLineAfterShiftsTheRest() {
        assertThat(scripts.insertLineAfter(owner, script, first, "direction", null, "사이")).isEqualTo(LineEditOutcome.UPDATED);
        assertThat(scripts.insertLineAfter(owner, script, last, "dialogue", kostya, "안녕히")).isEqualTo(LineEditOutcome.UPDATED);

        assertThat(jdbc.queryForList("""
                SELECT l.ordinal||'/'||l.kind||'/'||COALESCE(c.name,'-')||'/'||l.text
                FROM script_lines l LEFT JOIN script_characters c ON c.id=l.character_id WHERE l.script_id=? ORDER BY l.ordinal
                """, String.class, script)).containsExactly("1/scene/-/호숫가", "2/dialogue/니나/안녕하세요", "3/direction/-/사이",
                "4/dialogue/코스챠/왔구나", "5/dialogue/니나·코스챠/함께 말해요", "6/dialogue/니나/잘 가요", "7/dialogue/코스챠/안녕히");

        UUID foreign = character(script(owner), "다른 대본의 배역", 0);
        assertThat(scripts.insertLineAfter(owner, script, first, "direction", nina, "지문에 배역")).isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.insertLineAfter(owner, script, first, "dialogue", null, "배역 없는 대사")).isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.insertLineAfter(owner, script, first, "dialogue", foreign, "남의 배역")).isEqualTo(LineEditOutcome.INVALID_LINE);
        assertThat(scripts.insertLineAfter(owner, script, UUID.randomUUID(), "direction", null, "글"))
                .isEqualTo(LineEditOutcome.LINE_NOT_FOUND);
        assertThat(scripts.insertLineAfter(member(), script, first, "direction", null, "글")).isNull();
        assertThat(count("script_lines")).isEqualTo(7);
    }

    @Test
    @DisplayName("delete: 대본과 그 배역·줄·회차·녹음·암기 표시·회차 평가·원본 파일을 지우고 원본 파일과 녹음의 객체를 장부에 올린다. 다른 대본은 그대로다. 남의 대본·없는 대본은 null 이다")
    void deleteRemovesEverythingOfTheScript() {
        UUID session = session(owner, script, first, last, nina);
        recording(owner, session, first, 1, "reading/first.m4a");
        recording(owner, session, last, 1, "reading/last.m4a");
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')", UUID.randomUUID(), owner, first);
        jdbc.update("INSERT INTO reading_session_ratings(id,session_id,user_id,rating,request_id) VALUES (?,?,?,'good',?)",
                UUID.randomUUID(), session, owner, UUID.randomUUID());
        jdbc.update("INSERT INTO script_uploads(id,user_id,object_key,byte_size,script_id,expires_at) VALUES (?,?,'scripts/a.pdf',1,?,?)",
                UUID.randomUUID(), owner, script, utc(now.plusSeconds(600)));
        UUID other = script(owner);
        UUID otherLine = line(other, 1, "dialogue", character(other, "니나", 0), "다른 대본");
        UUID otherSession = session(owner, other, otherLine, otherLine);
        recording(owner, otherSession, otherLine, 1, "reading/other.m4a");

        assertThat(scripts.delete(member(), script, now)).isNull();
        assertThat(scripts.delete(owner, UUID.randomUUID(), now)).isNull();

        List<UUID> scheduled = scripts.delete(owner, script, now);

        assertThat(scheduled).hasSize(2);
        assertThat(scheduledKeys(scheduled.get(0))).as("원본 파일").containsExactly("scripts/a.pdf");
        assertThat(scheduledKeys(scheduled.get(1))).as("녹음").containsExactlyInAnyOrder("reading/first.m4a", "reading/last.m4a");
        assertThat(jdbc.queryForList("SELECT id FROM scripts WHERE user_id=?", UUID.class, owner)).containsExactly(other);
        assertThat(jdbc.queryForList("SELECT object_key FROM reading_recordings", String.class)).containsExactly("reading/other.m4a");
        assertThat(count("reading_sessions")).isEqualTo(1);
        assertThat(count("script_lines")).isEqualTo(1);
        assertThat(count("script_characters")).isEqualTo(1);
        assertThat(count("line_memorization")).isZero();
        assertThat(count("reading_session_ratings")).isZero();
        assertThat(count("script_uploads")).isZero();
        assertThat(scripts.delete(owner, other, now)).as("녹음만 있는 대본").hasSize(1);
        assertThat(scripts.delete(owner, script(owner), now)).as("아무것도 없는 대본").isEmpty();
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("대본을 고치는 쓰기는 사람 행과 대본 행을, 줄 편집은 그 줄 행까지 차례로 FOR UPDATE 로 잡는다. 대본 삭제는 대본 행을 잡는다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다")
    void writesLockTheUserThenTheScriptThenTheLine() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (String[] step : new String[][] {{"users", owner.toString()}, {"scripts", script.toString()}}) {
                run(probe, "SELECT 1 FROM " + step[0] + " WHERE id=? FOR KEY SHARE", UUID.fromString(step[1]));
                Future<UpdateOutcome> blocked = pool.submit(() -> scripts.update(owner, script, "제목", List.of()));
                String waiting = awaitWaiting("from " + step[0]);
                probe.rollback();
                assertThat(waiting).as(step[0]).startsWith("select").contains("for update");
                assertThat(blocked.get(20, TimeUnit.SECONDS)).isEqualTo(UpdateOutcome.UPDATED);
            }
            run(probe, "SELECT 1 FROM script_lines WHERE id=? FOR KEY SHARE", first);
            Future<LineEditOutcome> editing = pool.submit(() -> scripts.editLine(owner, script, first, new LinePatch(null, null, "글")));
            String onLine = awaitWaiting("from script_lines");
            probe.rollback();
            assertThat(onLine).startsWith("select").contains("for update");
            assertThat(editing.get(20, TimeUnit.SECONDS)).isEqualTo(LineEditOutcome.UPDATED);

            UUID disposable = script(owner);
            run(probe, "SELECT 1 FROM scripts WHERE id=? FOR KEY SHARE", disposable);
            Future<List<UUID>> deleting = pool.submit(() -> scripts.delete(owner, disposable, now));
            String onDelete = awaitWaiting("from scripts");
            probe.rollback();
            assertThat(onDelete).startsWith("select").contains("for update");
            assertThat(deleting.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("deleteLine 은 그 줄을 가리키는 회차 행을 FOR UPDATE 로 잡고 그 회차의 구간 끝 줄 행은 잡지 않는다 — 바깥 연결이 회차 행을 FOR KEY SHARE 로 잡고 있으면 기다리고, 끝 줄 행의 FOR NO KEY UPDATE 는 지난다")
    void deleteLineLocksTheSessionsThatPointAtTheLine() throws Exception {
        UUID session = session(owner, script, first, last, nina);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR KEY SHARE", session);
            run(probe, "SELECT 1 FROM script_lines WHERE id=? FOR NO KEY UPDATE", last);
            Future<LineRemoval> blocked = pool.submit(() -> scripts.deleteLine(owner, script, first, now));
            String waiting = awaitWaiting("from reading_sessions");
            probe.rollback();

            assertThat(waiting).startsWith("select").contains("for update");
            assertThat(blocked.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(LineEditOutcome.UPDATED);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 요청 id 의 등록 둘이 겹치면 뒤의 것이 사람 행에서 앞의 커밋을 기다렸다가 REPLAYED 다. 마지막 한 자리를 두 요청이 함께 노리면 뒤의 것은 OVER_LIMIT 다")
    void twoCreatesAtOnce() throws Exception {
        UUID request = UUID.randomUUID();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (UUID secondRequest : new UUID[] {request, UUID.randomUUID()}) {
                boolean replay = secondRequest.equals(request);
                CountDownLatch created = new CountDownLatch(1);
                CountDownLatch release = new CountDownLatch(1);
                UUID firstRequest = replay ? request : UUID.randomUUID();
                int limit = replay ? 10 : 3;
                Future<Creation> ahead = pool.submit(() -> inTransaction(() -> {
                    Creation creation = scripts.create(owner, firstRequest, FINGERPRINT, draft("앞"), limit);
                    created.countDown();
                    await(release);
                    return creation;
                }));
                await(created);
                Future<Creation> behind = pool.submit(() -> scripts.create(owner, secondRequest, FINGERPRINT, draft("뒤"), limit));
                assertThat(awaitWaiting("from users")).contains("for update");
                release.countDown();

                Creation won = ahead.get(20, TimeUnit.SECONDS);
                assertThat(won.outcome()).isEqualTo(Outcome.CREATED);
                assertThat(behind.get(20, TimeUnit.SECONDS)).isEqualTo(replay
                        ? new Creation(won.scriptId(), false, Outcome.REPLAYED)
                        : new Creation(null, false, Outcome.OVER_LIMIT));
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, owner)).isEqualTo(3);
    }

    @Test
    @DisplayName("줄 행을 잡고 있는 동안 그 줄의 새 녹음은 들어오지 못한다 — 녹음 INSERT 가 줄 행의 잠금 뒤에서 기다린다. 그래서 줄을 지울 때 읽은 녹음이 지우는 녹음의 전부다")
    void aHeldLineLockKeepsNewRecordingsOut() throws Exception {
        UUID session = session(owner, script, first, last, nina);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM script_lines WHERE id=? FOR UPDATE", first);
            Future<UUID> inserting = pool.submit(() -> recording(owner, session, first, 1, "reading/late.m4a"));
            String waiting = awaitWaiting("insert into reading_recordings");
            assertThat(count("reading_recordings")).isZero();
            probe.rollback();

            assertThat(waiting).startsWith("insert into reading_recordings");
            inserting.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 문장 ----

    @Test
    @DisplayName("요청 하나가 보내는 문장(읽기): 상세는 대본·줄·배역 셋, 목록은 카드와 전체 수 둘이다. 남의 대본의 상세는 하나다")
    void readsSendTheseStatements() {
        assertThat(statementsOf(() -> scripts.find(owner, script))).as("상세")
                .containsExactly("select scripts", "select script_lines", "select script_characters");
        assertThat(statementsOf(() -> scripts.find(member(), script))).containsExactly("select scripts");
        assertThat(statementsOf(() -> scripts.list(owner, ""))).as("목록").containsExactly("select scripts", "select scripts");
        assertThat(statementsOf(() -> scripts.list(owner, "니나"))).as("찾기").containsExactly("select scripts", "select scripts");
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장(쓰기): 등록은 사람 잠금·재전송 확인·대본 수 뒤에 대본·배역·줄을 넣는다. 고치기와 줄 편집은 사람·대본(·줄) 잠금 뒤의 문장들이다")
    void writesSendTheseStatements() {
        String usersLock = "select users for update";
        String scriptLock = "select scripts for update";
        String lineLock = "select script_lines for update";
        String touch = "update scripts";
        UUID request = UUID.randomUUID();

        assertThat(statementsOf(() -> scripts.create(owner, request, FINGERPRINT, draft("새 대본"), 10))).as("등록(배역 하나, 줄 둘)")
                .containsExactly(usersLock, "select scripts", "count scripts", "insert scripts", "insert script_characters",
                        "insert script_lines", "insert script_lines");
        assertThat(statementsOf(() -> scripts.create(owner, request, FINGERPRINT, draft("새 대본"), 10))).as("재전송")
                .containsExactly(usersLock, "select scripts");
        assertThat(statementsOf(() -> scripts.update(owner, script, "제목", List.of(new CharacterPatch(nina, "새 이름", false, null)))))
                .as("제목과 배역 하나 고치기").containsExactly(usersLock, scriptLock, "select script_characters",
                        "set constraints uq_script_characters_script_name deferred", "update script_characters", touch);
        assertThat(statementsOf(() -> scripts.editLine(owner, script, first, new LinePatch(null, null, "글"))))
                .as("줄 고치기").containsExactly(usersLock, scriptLock, lineLock, "select script_characters", "update script_lines", touch);
        assertThat(statementsOf(() -> scripts.insertLineAfter(owner, script, first, "direction", null, "사이")))
                .as("줄 넣기").containsExactly(usersLock, scriptLock, lineLock, "update script_lines", "update script_lines",
                        "insert script_lines", touch);
        assertThat(statementsOf(() -> scripts.splitLine(owner, script, first, "앞", "뒤")))
                .as("줄 나누기").containsExactly(usersLock, scriptLock, lineLock, "update script_lines", "update script_lines",
                        "insert script_lines", "update script_lines", "update reading_sessions", touch);
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장(지우기): 줄 지우기는 그 줄을 가리키는 회차마다 구간의 대사를 읽고 옮긴 뒤 줄 결과·녹음·암기·줄을 지운다. 대본 지우기는 대본 잠금 뒤에 딸린 것을 차례로 지운다")
    void deletesSendTheseStatements() {
        UUID session = session(owner, script, first, last, nina);
        recording(owner, session, first, 1, "reading/first.m4a");
        String ledger = "insert account_cleanup_operations";

        assertThat(statementsOf(() -> scripts.deleteLine(owner, script, first, now))).as("회차 하나가 가리키고 녹음이 있는 줄").containsExactly(
                "select users for update", "select scripts for update", "select script_lines for update", "count script_lines",
                "select reading_sessions for update", "select script_lines", "update reading_sessions", "update reading_sessions",
                "select reading_recordings for update", "delete reading_recordings", "delete line_memorization", "delete script_lines",
                "update scripts", ledger);
        assertThat(statementsOf(() -> scripts.deleteLine(owner, script, together, now))).as("가리키는 회차도 녹음도 없는 줄").containsExactly(
                "select users for update", "select scripts for update", "select script_lines for update", "count script_lines",
                "select reading_sessions for update", "update reading_sessions",
                "select reading_recordings for update", "delete line_memorization", "delete script_lines", "update scripts");

        recording(owner, session, last, 1, "reading/last.m4a");
        assertThat(statementsOf(() -> scripts.delete(owner, script, now))).as("녹음이 있는 대본 지우기").containsExactly(
                "select scripts for update", "delete reading_recordings returning", "delete script_uploads returning",
                "delete line_memorization", "delete reading_session_ratings", "delete reading_sessions", "delete script_lines",
                "delete script_characters", "delete scripts", ledger);
    }

    // ---- 도움 ----

    /** 배역 하나, 대사 둘. */
    private static ScriptDraft draft(String title) {
        return new ScriptDraft(title, "원문 " + title, "paste", List.of("니나"),
                List.of(new ScriptDraft.Line(1, "dialogue", 0, "안녕"), new ScriptDraft.Line(2, "dialogue", 0, "잘 가")));
    }

    private UUID scriptAt(UUID user, String title, Instant at) {
        UUID id = script(user);
        jdbc.update("UPDATE scripts SET title=?, created_at=?, updated_at=? WHERE id=?", title, utc(at), utc(at), id);
        return id;
    }

    /** "종류/배역 이름/글/말/읽을 글". */
    private String lineRow(UUID line) {
        return jdbc.queryForObject("""
                SELECT l.kind||'/'||COALESCE(c.name,'-')||'/'||l.text||'/'||COALESCE(l.lang,'-')||'/'||COALESCE(l.speech,'-')
                FROM script_lines l LEFT JOIN script_characters c ON c.id=l.character_id WHERE l.id=?
                """, String.class, line);
    }

    /** "시작 줄/끝 줄/위치". */
    private String sessionRow(UUID session) {
        return jdbc.queryForObject("SELECT start_line_id||'/'||end_line_id||'/'||current_line_id FROM reading_sessions WHERE id=?",
                String.class, session);
    }
}
