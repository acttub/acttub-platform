package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateService.Request;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService.Revision;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService.View;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Experience;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 찍을 대사 같이 만들기 — 2026-10-19 인계본 회귀 테스트(test_server.py)의 서버 동작을 메모리 저장소와 가짜 모델로 옮겼다.
 * 모델 호출 수·횟수 차감·원본 유지를 본다.
 */
class ScriptCocreateServiceTest {

    static final ObjectMapper MAPPER = new ObjectMapper();
    static final String LINE = "가".repeat(25);
    static final UUID USER = UUID.randomUUID();

    MemoryRepository repo;
    FakeModel model;
    ScriptService scripts;
    Clock clock;
    ScriptCocreateService service;

    @BeforeEach
    void setUp() {
        repo = new MemoryRepository();
        model = new FakeModel();
        scripts = mock(ScriptService.class);
        clock = Clock.fixed(Instant.parse("2026-10-22T03:00:00Z"), ZoneOffset.UTC);
        service = new ScriptCocreateService(repo, model, scripts, MAPPER, clock, n -> 0);
    }

    static Request request(int count, int minutes) {
        return new Request(Experience.BEGINNER, 24, "female", "hobby", "서운함", "오랜만의 재회", "끝까지 말을 돌리면 좋겠어요",
                count, minutes);
    }

    /** 배역 {@code count}명, 대사 {@code dialogue}줄 번갈아. 내 배역은 지수. */
    static String script(int count, int dialogue) {
        return script(count, dialogue, LINE, "지수", "f");
    }

    static String script(int count, int dialogue, String line, String mine, String gender) {
        ObjectNode node = MAPPER.createObjectNode();
        node.putObject("design").put("relation", "오래된 친구, 반말").put("incident", "생일을 잊었다").put("prop", "영수증")
                .put("my_objective", "사과를 받는다").put("other_reason", "자존심").put("turn_action", "영수증을 내민다")
                .put("ending_type", "떠난다").putArray("tactics").add("묻기");
        node.put("title", "잊어버린 생일");
        node.put("scene", "옥상, 밤");
        String[] names = {mine, "민호", "서연", "태오"};
        ArrayNode characters = node.putArray("characters");
        for (int i = 0; i < count; i++) {
            characters.addObject().put("name", names[i]).put("gender", i == 0 ? gender : "M").put("age_band", "young")
                    .put("mine", i == 0);
        }
        ArrayNode lines = node.putArray("lines");
        lines.addObject().put("kind", "scene").putNull("character").put("text", "옥상, 밤");
        for (int i = 0; i < dialogue; i++) {
            lines.addObject().put("kind", "dialogue").put("character", names[count == 1 ? 0 : i % count]).put("text", line);
        }
        return node.toString();
    }

    @Test
    @DisplayName("1분 독백을 한 번에 만든다 — 프롬프트는 독백판이고 조건이 채워지며, 결과는 첫 버전·무료 수정 3회다")
    void generatesAMonologue() {
        model.replies.add(p -> script(1, 12));

        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));

        assertThat(view.created()).isTrue();
        assertThat(view.version()).isEqualTo(1);
        assertThat(view.characterCount()).isEqualTo(1);
        assertThat(view.estimatedSeconds()).isEqualTo(60);
        assertThat(view.revisionsLeft()).isEqualTo(3);
        assertThat(view.script().characters()).singleElement().matches(r -> r.mine() && "f".equals(r.gender()));
        String prompt = model.prompts.getFirst();
        assertThat(prompt).startsWith("너는 배우 연습용 1인 독백을").contains("20대 여성", "서운함", "오랜만의 재회",
                "끝까지 말을 돌리면 좋겠어요", "독백 대사 12줄", "15~28자").doesNotContain("{my_lines}", "{actor}", "{length_rules}");
        assertThat(model.tokens.getFirst()).isEqualTo(8192);
        assertThat(repo.rows.values()).singleElement().matches(r -> r.ready() && r.model().equals("fake"));
    }

    @Test
    @DisplayName("2~4인 장면은 인계본 생성 프롬프트를 쓰고, 성별은 소문자로 읽는다")
    void generatesAMultiCastScene() {
        model.replies.add(p -> script(3, 12));

        View view = service.generate(USER, UUID.randomUUID(), request(3, 1));

        assertThat(model.prompts.getFirst()).startsWith("너는 배우 연습용 3인 장면을").contains("\"mine\":false");
        assertThat(view.script().characters()).extracting(c -> c.gender()).containsExactly("f", "m", "m");
    }

    @Test
    @DisplayName("같은 요청 id 는 모델을 다시 부르지 않고 먼저 만든 것을 준다 — 만드는 중이면 409")
    void replaysTheSameRequest() {
        model.replies.add(p -> script(1, 12));
        UUID requestId = UUID.randomUUID();
        View first = service.generate(USER, requestId, request(1, 1));

        View again = service.generate(USER, requestId, request(1, 1));

        assertThat(again.created()).isFalse();
        assertThat(again.id()).isEqualTo(first.id());
        assertThat(model.prompts).hasSize(1);

        UUID pending = UUID.randomUUID();
        repo.insertPending(UUID.randomUUID(), USER, pending, clock.instant());
        assertThatThrownBy(() -> service.generate(USER, pending, request(1, 1)))
                .isInstanceOf(ApiException.class).hasMessage("sample_script_in_progress");
    }

    @Test
    @DisplayName("오래 멈춘 만드는 중 줄은 지우고 다시 만든다")
    void staleRequestIsRetried() {
        UUID requestId = UUID.randomUUID();
        repo.insertPending(UUID.randomUUID(), USER, requestId, clock.instant().minus(Duration.ofMinutes(10)));
        model.replies.add(p -> script(1, 12));

        assertThat(service.generate(USER, requestId, request(1, 1)).created()).isTrue();
        assertThat(repo.rows).hasSize(1);
    }

    @Test
    @DisplayName("잘못된 배역 수·분량과 하루 상한은 모델을 부르지 않는다")
    void rejectsBeforeCallingTheModel() {
        assertThatThrownBy(() -> service.generate(USER, UUID.randomUUID(), request(5, 1))).hasMessage("sample_script_invalid_options");
        assertThatThrownBy(() -> service.generate(USER, UUID.randomUUID(), request(1, 2))).hasMessage("sample_script_invalid_options");
        for (int i = 0; i < 20; i++) {
            repo.insertPending(UUID.randomUUID(), USER, UUID.randomUUID(), clock.instant().minusSeconds(60));
        }
        assertThatThrownBy(() -> service.generate(USER, UUID.randomUUID(), request(1, 1)))
                .isInstanceOf(ApiException.class).hasMessage("sample_script_daily_limit");
        assertThat(model.prompts).isEmpty();
    }

    @Test
    @DisplayName("모델이 막히면 다른 결말·소품으로 한 번 더 만든다")
    void retriesWithAnotherSlotWhenBlocked() {
        model.replies.add(p -> {
            throw new IllegalStateException("SAFETY");
        });
        model.replies.add(p -> script(1, 12));

        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));

        assertThat(view.created()).isTrue();
        assertThat(model.prompts).hasSize(2);
        assertThat(model.prompts.get(0)).isNotEqualTo(model.prompts.get(1));
    }

    @Test
    @DisplayName("두 번 다 막히거나 구조가 깨지면 502 이고 아무것도 남지 않는다 — 같은 요청 id 로 다시 시도할 수 있다")
    void failsCleanly() {
        model.replies.add(p -> {
            throw new IllegalStateException("down");
        });
        model.replies.add(p -> "not json");
        UUID requestId = UUID.randomUUID();
        assertThatThrownBy(() -> service.generate(USER, requestId, request(1, 1)))
                .isInstanceOf(ApiException.class).hasMessage("sample_script_failed")
                .extracting(e -> ((ApiException) e).status()).isEqualTo(502);
        assertThat(repo.rows).isEmpty();

        model.replies.add(p -> "```json\n" + script(1, 4) + "\n```");
        model.replies.add(p -> script(2, 12));
        assertThatThrownBy(() -> service.generate(USER, requestId, request(1, 1))).hasMessage("sample_script_failed");
        assertThat(repo.rows).isEmpty();
    }

    @Test
    @DisplayName("걸린 줄만 고치기 프롬프트로 고친다 — 걸리지 않은 줄 번호는 무시하고, 안전 문제가 남으면 보이지 않는다")
    void fixesOnlyFlaggedLines() {
        ObjectNode bad = (ObjectNode) read(script(1, 12));
        ((ObjectNode) bad.withArray("lines").get(3)).put("text", "짧아");
        model.replies.add(p -> bad.toString());
        model.replies.add(p -> "{\"fixes\":[{\"index\":3,\"text\":\"" + LINE + "\"},{\"index\":5,\"text\":\"바꾸면 안 됨\"}]}");

        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));

        assertThat(model.prompts.get(1)).contains("- 3번 줄: 길이 2자").contains("15~28");
        assertThat(view.script().lines().get(3).text()).isEqualTo(LINE);
        assertThat(view.script().lines().get(5).text()).isEqualTo(LINE);

        ObjectNode unsafe = (ObjectNode) read(script(1, 12));
        ((ObjectNode) unsafe.withArray("lines").get(2)).put("text", "오늘 밤 한강에 같이 가 줄 수 있겠어");
        model.replies.add(p -> unsafe.toString());
        model.replies.add(p -> "{\"fixes\":[]}");
        model.replies.add(p -> unsafe.toString());
        model.replies.add(p -> {
            throw new IllegalStateException("fix down");
        });
        assertThatThrownBy(() -> service.generate(USER, UUID.randomUUID(), request(1, 1))).hasMessage("sample_script_failed");
    }

    @Test
    @DisplayName("수정에 성공하면 버전이 하나 늘고 한 번 센다 — 세 번 쓰면 429 이고 모델을 부르지 않는다")
    void revisionsAreCountedOnSuccess() {
        model.replies.add(p -> script(1, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));
        for (int i = 1; i <= 3; i++) {
            ObjectNode next = (ObjectNode) read(script(1, 12));
            next.put("title", "수정 " + i).put("note", "마지막 대사를 담담하게 바꿨어요.");
            model.replies.add(p -> next.toString());
            view = service.revise(USER, view.id(), new Revision(view.version(), "마지막 대사만 담담하게", null, null));
            assertThat(view.revisionsUsed()).isEqualTo(i);
            assertThat(view.version()).isEqualTo(i + 1);
            assertThat(view.note()).isEqualTo("마지막 대사를 담담하게 바꿨어요.");
        }
        String revisePrompt = model.prompts.get(1);
        assertThat(revisePrompt).contains("[배우의 수정 요청]\n마지막 대사만 담담하게", "1인 독백(상대 대사 없음", "\"title\":\"잊어버린 생일\"")
                .doesNotContain("{cast_rule}", "{script}");
        int calls = model.prompts.size();
        UUID id = view.id();
        int version = view.version();
        assertThatThrownBy(() -> service.revise(USER, id, new Revision(version, "또", null, null)))
                .hasMessage("sample_script_revision_limit");
        assertThat(model.prompts).hasSize(calls);
    }

    @Test
    @DisplayName("수정이 실패하면 원본과 횟수가 그대로다 — 모델 오류, 내 배역이 바뀜, 구조 오류 모두")
    void failedRevisionKeepsTheOriginal() {
        model.replies.add(p -> script(1, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));
        UUID id = view.id();

        model.replies.add(p -> {
            throw new IllegalStateException("down");
        });
        model.replies.add(p -> script(1, 12, LINE, "다른이", "f"));
        model.replies.add(p -> script(1, 3));
        for (int i = 0; i < 3; i++) {
            assertThatThrownBy(() -> service.revise(USER, id, new Revision(1, "고쳐 줘", null, null)))
                    .hasMessage("sample_script_revision_failed");
        }

        View after = service.find(USER, id);
        assertThat(after.revisionsUsed()).isZero();
        assertThat(after.version()).isEqualTo(1);
        assertThat(repo.rows.get(id).busySince()).isNull();
    }

    @Test
    @DisplayName("바꿀 것이 없거나 범위 밖 설정이면 모델을 부르지 않는다 — 버전이 다르면 409, 수정 중이면 409")
    void rejectsRevisionsWithoutCalling() {
        model.replies.add(p -> script(1, 12));
        UUID id = service.generate(USER, UUID.randomUUID(), request(1, 1)).id();
        int calls = model.prompts.size();

        assertThatThrownBy(() -> service.revise(USER, id, new Revision(1, "  ", 1, 1))).hasMessage("sample_script_no_change");
        assertThatThrownBy(() -> service.revise(USER, id, new Revision(1, null, 5, null))).hasMessage("sample_script_invalid_options");
        assertThatThrownBy(() -> service.revise(USER, id, new Revision(2, "x", null, null))).hasMessage("sample_script_version_conflict");
        repo.claim(USER, id, 1, 3, clock.instant(), clock.instant().minusSeconds(1));
        assertThatThrownBy(() -> service.revise(USER, id, new Revision(1, "x", null, null))).hasMessage("sample_script_busy");
        assertThatThrownBy(() -> service.save(USER, false, id)).hasMessage("sample_script_busy");
        assertThat(model.prompts).hasSize(calls);
        assertThatThrownBy(() -> service.find(USER, UUID.randomUUID())).hasMessage("sample_script_not_found");
        assertThatThrownBy(() -> service.find(UUID.randomUUID(), id)).hasMessage("sample_script_not_found");
    }

    @Test
    @DisplayName("배역 수와 분량을 함께 바꾸면 한 번의 수정이다 — 독백을 3분 2인 장면으로")
    void resizesInOneRevision() {
        model.replies.add(p -> script(1, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));
        model.replies.add(p -> script(2, 36));

        View next = service.revise(USER, view.id(), new Revision(1, "새 배역은 친구면 좋겠어요", 2, 3));

        assertThat(next.characterCount()).isEqualTo(2);
        assertThat(next.minutes()).isEqualTo(3);
        assertThat(next.revisionsUsed()).isEqualTo(1);
        assertThat(model.prompts.get(1)).contains("[설정 변경] 등장인물을 정확히 2명", "약 3분", "분량을 바꾸는 요청이므로",
                "추가 요청: 새 배역은 친구면 좋겠어요", "같은 사람의 대사 연속 금지");
        assertThat(ScriptCocreateService.request(null, null, "그대로", false)).isEqualTo("그대로");
    }

    @Test
    @DisplayName("10분은 큰 출력 상한을 쓰고, 2인 장면을 독백으로 줄이는 수정은 독백 지시를 싣는다")
    void tenMinutesAndShrinkToMonologue() {
        model.replies.add(p -> script(2, 120));
        View view = service.generate(USER, UUID.randomUUID(), request(2, 10));
        assertThat(model.tokens.getFirst()).isEqualTo(24_576);
        model.replies.add(p -> script(1, 120));

        View next = service.revise(USER, view.id(), new Revision(1, null, 1, null));

        assertThat(next.characterCount()).isEqualTo(1);
        assertThat(model.prompts.get(1)).contains("독백으로 바꾼다").doesNotContain("추가 요청");
    }

    @Test
    @DisplayName("지난 버전으로 되돌려도 수정 횟수는 그대로다 — 없는 버전은 422")
    void restoreKeepsTheCount() {
        model.replies.add(p -> script(1, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));
        model.replies.add(p -> script(1, 12));
        service.revise(USER, view.id(), new Revision(1, "고쳐 줘", null, null));

        View restored = service.restore(USER, view.id(), 1);

        assertThat(restored.version()).isEqualTo(1);
        assertThat(restored.versionCount()).isEqualTo(2);
        assertThat(restored.revisionsUsed()).isEqualTo(1);
        assertThatThrownBy(() -> service.restore(USER, view.id(), 3)).hasMessage("sample_script_version_not_found");
    }

    @Test
    void saveChecksTheLockedRowAndNeverCreatesWhileRevisionIsClaimed() {
        model.replies.add(p -> script(1, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(1, 1));
        repo.beforeSave = () -> repo.claim(USER, view.id(), 1, 3, clock.instant(), clock.instant().minusSeconds(300));
        assertThatThrownBy(() -> service.save(USER, false, view.id())).hasMessage("sample_script_busy");
        verify(scripts, never()).create(any(), anyBoolean(), any(), any());
    }

    @Test
    @DisplayName("확정하면 기존 대본 저장에 생성 기록 id 를 요청 id 로 넣고 잇는다 — 다시 확정하면 같은 대본, 확정 뒤 수정·되돌리기는 409")
    void saveUsesTheExistingScriptStore() {
        model.replies.add(p -> script(2, 12));
        View view = service.generate(USER, UUID.randomUUID(), request(2, 1));
        UUID scriptId = UUID.randomUUID();
        ScriptView saved = mock(ScriptView.class);
        when(saved.id()).thenReturn(scriptId);
        when(scripts.create(eq(USER), anyBoolean(), eq(view.id()), any(ScriptDraft.class)))
                .thenReturn(new ScriptService.Created(saved, true));

        ScriptCocreateService.Saved first = service.save(USER, false, view.id());
        ScriptCocreateService.Saved again = service.save(USER, false, view.id());

        assertThat(first.scriptId()).isEqualTo(scriptId);
        assertThat(first.created()).isTrue();
        assertThat(again.scriptId()).isEqualTo(scriptId);
        assertThat(again.created()).isFalse();
        verify(scripts).create(eq(USER), eq(false), eq(view.id()), any(ScriptDraft.class));
        assertThat(service.find(USER, view.id()).scriptId()).isEqualTo(scriptId);
        assertThatThrownBy(() -> service.revise(USER, view.id(), new Revision(1, "x", null, null))).hasMessage("sample_script_saved");
        assertThatThrownBy(() -> service.restore(USER, view.id(), 1)).hasMessage("sample_script_saved");
    }

    @Test
    @DisplayName("감정·상황을 고르지 않으면 서버가 고르고, 최근 결말·소품은 피하며, 10대에게는 10대용만 쓴다")
    void serverPicksWhenNotChosen() {
        model.replies.add(p -> script(1, 12));
        service.generate(USER, UUID.randomUUID(), new Request(null, 15, "male", "audition", "잘 모르겠어요", "", " ", 1, 1));
        String prompt = model.prompts.getFirst();
        assertThat(prompt).contains("고른 감정: 설렘", "고른 상황: 이별", "추가로 원하는 방향: 없음", "10대 남성",
                "오디션·입시를 준비한다", "입문");
        model.replies.add(p -> script(1, 12));
        service.generate(USER, UUID.randomUUID(), request(1, 1));
        assertThat(model.prompts.get(1)).doesNotContain("스스로 자리를 뜬다");
        verify(scripts, never()).create(any(), anyBoolean(), any(), any());
        assertThat(ScriptCocreateService.actor(null, null)).startsWith("정하지 않음");
        assertThat(ScriptCocreateService.purpose("professional")).contains("작품");
    }

    // ---------------------------------------------------------------- 가짜

    static com.fasterxml.jackson.databind.JsonNode read(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    static class FakeModel implements ScriptCocreateModel {
        final Deque<Function<String, String>> replies = new ArrayDeque<>();
        final List<String> prompts = new ArrayList<>();
        final List<Integer> tokens = new ArrayList<>();

        @Override
        public Reply generate(String prompt, int maxOutputTokens) {
            prompts.add(prompt);
            tokens.add(maxOutputTokens);
            Function<String, String> next = replies.poll();
            if (next == null) {
                throw new IllegalStateException("no reply queued");
            }
            return new Reply(next.apply(prompt), "fake");
        }
    }

    static class MemoryRepository implements ScriptCocreateRepository {
        Runnable beforeSave = () -> {};
        final Map<UUID, Row> rows = new LinkedHashMap<>();
        final Map<UUID, UUID> owners = new LinkedHashMap<>();

        @Override
        public Row find(UUID userId, UUID id) {
            return userId.equals(owners.get(id)) ? rows.get(id) : null;
        }

        @Override
        public <T> T withSaveLock(UUID userId, UUID id, java.util.function.Function<Row, T> save) {
            beforeSave.run();
            return save.apply(find(userId, id));
        }

        @Override
        public Row findByRequest(UUID userId, UUID requestId) {
            return rows.values().stream().filter(r -> r.requestId().equals(requestId) && userId.equals(owners.get(r.id())))
                    .findFirst().orElse(null);
        }

        @Override
        public boolean insertPending(UUID id, UUID userId, UUID requestId, Instant now) {
            if (findByRequest(userId, requestId) != null) {
                return false;
            }
            rows.put(id, new Row(id, requestId, null, null, 0, 0, null, null, null, now));
            owners.put(id, userId);
            return true;
        }

        @Override
        public void deletePending(UUID id) {
            Row row = rows.get(id);
            if (row != null && !row.ready()) {
                rows.remove(id);
            }
        }

        @Override
        public void complete(UUID id, String conditions, String versions, String model, Instant now) {
            Row r = rows.get(id);
            rows.put(id, new Row(id, r.requestId(), conditions, versions, 1, 0, model, null, null, r.createdAt()));
        }

        @Override
        public int countSince(UUID userId, Instant since) {
            return (int) rows.values().stream().filter(r -> userId.equals(owners.get(r.id())) && !r.createdAt().isBefore(since)).count();
        }

        @Override
        public List<String> recentConditions(UUID userId, int limit) {
            List<String> out = new ArrayList<>();
            List<Row> all = new ArrayList<>(rows.values());
            for (int i = all.size() - 1; i >= 0 && out.size() < limit; i--) {
                if (all.get(i).conditions() != null) {
                    out.add(all.get(i).conditions());
                }
            }
            return out;
        }

        @Override
        public boolean claim(UUID userId, UUID id, int version, int revisionLimit, Instant now, Instant staleBefore) {
            Row r = find(userId, id);
            if (r == null || !r.ready() || r.currentVersion() != version || r.scriptId() != null || r.revisionsUsed() >= revisionLimit
                    || (r.busySince() != null && !r.busySince().isBefore(staleBefore))) {
                return false;
            }
            rows.put(id, new Row(id, r.requestId(), r.conditions(), r.versions(), r.currentVersion(), r.revisionsUsed(), r.model(),
                    now, r.scriptId(), r.createdAt()));
            return true;
        }

        @Override
        public void release(UUID id) {
            Row r = rows.get(id);
            rows.put(id, new Row(id, r.requestId(), r.conditions(), r.versions(), r.currentVersion(), r.revisionsUsed(), r.model(),
                    null, r.scriptId(), r.createdAt()));
        }

        @Override
        public void appendVersion(UUID id, String versions, int currentVersion, Instant now) {
            Row r = rows.get(id);
            rows.put(id, new Row(id, r.requestId(), r.conditions(), versions, currentVersion, r.revisionsUsed() + 1, r.model(),
                    null, r.scriptId(), r.createdAt()));
        }

        @Override
        public boolean restore(UUID userId, UUID id, int version, Instant now) {
            Row r = find(userId, id);
            if (r == null || r.scriptId() != null || r.busySince() != null) {
                return false;
            }
            rows.put(id, new Row(id, r.requestId(), r.conditions(), r.versions(), version, r.revisionsUsed(), r.model(),
                    null, r.scriptId(), r.createdAt()));
            return true;
        }

        @Override
        public void linkScript(UUID userId, UUID id, UUID scriptId, Instant now) {
            Row r = rows.get(id);
            rows.put(id, new Row(id, r.requestId(), r.conditions(), r.versions(), r.currentVersion(), r.revisionsUsed(), r.model(),
                    r.busySince(), scriptId, r.createdAt()));
        }
    }
}
