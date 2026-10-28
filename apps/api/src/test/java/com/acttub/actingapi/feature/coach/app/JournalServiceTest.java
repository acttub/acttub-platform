package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmScore;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 배우 일지 서비스(practice.journal, SOMA-720) — 배우 답은 그대로, 생성 실패는 배우 답만, 한 회차에 하나. */
class JournalServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ActorJournal.Answers ANSWERS = new ActorJournal.Answers(
            new ActorJournal.Feeling("떨렸어요", "  낮게 하니까 오히려 더 떨렸어요 "),
            new ActorJournal.Unknown(false, "앞 대사가 화난 건지 무서운 건지 모르겠어요"),
            new ActorJournal.Next(false, "앞 대사를 화난 버전이랑 무서운 버전으로 찍어 보기"),
            "소리 안 질러도 붙잡을 수 있다는 걸 처음 느꼈다");

    private final UUID userId = UUID.randomUUID();
    private final UUID practiceId = UUID.randomUUID();
    private final UUID conversationId = UUID.randomUUID();
    private final FakeJournals journals = new FakeJournals();
    private final ConversationRepository conversations = mock(ConversationRepository.class);
    private final List<LlmCall> calls = new java.util.ArrayList<>();
    private final LlmTelemetry telemetry = new LlmTelemetry() {
        @Override public void record(LlmCall call) { calls.add(call); }
        @Override public void score(LlmScore score) { }
    };

    private JournalService service(TextGenerator generator) {
        return new JournalService(journals, conversations, generator, telemetry, JSON,
                Clock.fixed(Instant.parse("2026-10-23T03:00:00Z"), ZoneOffset.UTC), UUID::randomUUID);
    }

    private void conversation(List<CoachTurnSnapshot> turns) {
        when(conversations.loadByPractice(any(), any())).thenReturn(new ConversationRepository.Loaded(practiceId, conversationId,
                "conversing", ActorJournalTest.session("evaluate", turns)));
    }

    private static final List<CoachTurnSnapshot> TURNS = List.of(
            new CoachTurnSnapshot("ai", "이 장면에서 은서는 상대한테서 결국 뭘 얻어 내고 싶었어요?"),
            new CoachTurnSnapshot("actor", "떠나지 말고 제 얘기를 끝까지 들어 줬으면 했어요."));

    @Test
    void createsWithAnswersVerbatimAndTheDraftSeparately() throws Exception {
        conversation(TURNS);
        String output = """
                {"schema_version":"acttub.actor_journal_draft.v4",
                 "practice":[{"text":"상대가 끝까지 들어 주길 바라는 마음을 살펴봤어요","basis":"discussed","source_refs":["m0"]}],
                 "character":[{"aspect":"wants","text":"상대가 끝까지 들어 주기","source_refs":["m0"]},
                              {"aspect":"partner","text":"연인","source_refs":["c0"]}],
                 "feedback":[]}""";
        JournalService.Created created = service((system, input) -> new GeneratedText("```json\n" + output + "\n```", null, "gpt-test"))
                .create(userId, practiceId, ANSWERS);

        assertThat(created.created()).isTrue();
        ActorJournal.View view = created.view();
        assertThat(view.draftStatus()).isEqualTo("ready");
        // 앞뒤 공백만 걷고 글은 그대로다.
        assertThat(view.answers().feeling().text()).isEqualTo("낮게 하니까 오히려 더 떨렸어요");
        assertThat(view.answers().unknown()).isEqualTo(ANSWERS.unknown());
        assertThat(view.answers().next()).isEqualTo(ANSWERS.next());
        assertThat(view.answers().review()).isEqualTo(ANSWERS.review());
        assertThat(view.draft().practice()).hasSize(1);
        // 코치의 질문만으로는 상대를 쓰지 않는다 — 근거 없는 칸은 빈 칸이다.
        assertThat(view.draft().character()).extracting(ActorJournal.CharacterItem::aspect).containsExactly("wants");
        assertThat(view.conversationId()).isEqualTo(conversationId);
        assertThat(calls).hasSize(1);
        assertThat(calls.getFirst().input()).contains("떠나지 말고 제 얘기를");
    }

    @Test
    void retriesOnceThenKeepsOnlyTheActorAnswers() {
        conversation(TURNS);
        AtomicInteger attempts = new AtomicInteger();
        ActorJournal.View view = service((system, input) -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("model down");
        }).create(userId, practiceId, ANSWERS).view();

        assertThat(attempts).hasValue(2);
        assertThat(view.draftStatus()).isEqualTo("failed");
        assertThat(view.draft().practice()).isEmpty();
        assertThat(view.answers().review()).isEqualTo(ANSWERS.review());
    }

    @Test
    void malformedOutputCountsAsAFailedAttempt() {
        conversation(TURNS);
        AtomicInteger attempts = new AtomicInteger();
        ActorJournal.View view = service((system, input) -> {
            attempts.incrementAndGet();
            return new GeneratedText("not json", null, "gpt-test");
        }).create(userId, practiceId, ANSWERS).view();

        assertThat(attempts).hasValue(2);
        assertThat(view.draftStatus()).isEqualTo("failed");
    }

    @Test
    void secondCreateReturnsTheFirstJournalWithoutCallingTheModel() {
        conversation(TURNS);
        AtomicInteger attempts = new AtomicInteger();
        TextGenerator failing = (system, input) -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("down");
        };
        service(failing).create(userId, practiceId, ANSWERS);
        JournalService.Created again = service(failing).create(userId, practiceId, ActorJournal.Answers.empty());

        assertThat(again.created()).isFalse();
        assertThat(again.view().answers().review()).isEqualTo(ANSWERS.review());
        assertThat(attempts).hasValue(2);
    }

    @Test
    void noConversationSkipsTheModel() {
        conversation(List.of());
        ActorJournal.View view = service((system, input) -> {
            throw new AssertionError("must not call");
        }).create(userId, practiceId, ANSWERS).view();

        assertThat(view.draftStatus()).isEqualTo("skipped");
    }

    @Test
    void skippedQuestionsStayEmpty() {
        conversation(List.of());
        ActorJournal.View view = service((system, input) -> null).create(userId, practiceId, new ActorJournal.Answers(
                new ActorJournal.Feeling(" ", ""), new ActorJournal.Unknown(true, null), new ActorJournal.Next(false, " "), "")).view();

        assertThat(view.answers().feeling()).isNull();
        assertThat(view.answers().unknown()).isEqualTo(new ActorJournal.Unknown(true, null));
        assertThat(view.answers().next()).isNull();
        assertThat(view.answers().review()).isNull();
        assertThat(view.answers().nextAction()).isNull();
    }

    @Test
    void unknownPracticeAndMissingJournalAre404() {
        JournalService service = service((system, input) -> null);
        assertThatThrownBy(() -> service.create(userId, practiceId, ANSWERS))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("practice_not_found"));
        assertThatThrownBy(() -> service.find(userId, practiceId))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("journal_not_found"));
        assertThatThrownBy(() -> service.update(userId, practiceId, new JournalService.Edit(ANSWERS, ActorJournal.Draft.empty())))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("journal_not_found"));
    }

    @Test
    void editReplacesAnswersAndDropsBlankLines() {
        conversation(List.of());
        JournalService service = service((system, input) -> null);
        service.create(userId, practiceId, ANSWERS);
        ActorJournal.View edited = service.update(userId, practiceId, new JournalService.Edit(
                new ActorJournal.Answers(ANSWERS.feeling(), ANSWERS.unknown(), new ActorJournal.Next(false, "준호를 보며 말하기"), "고친 후기"),
                new ActorJournal.Draft(List.of(new ActorJournal.PracticeItem("  ", "discussed"), new ActorJournal.PracticeItem("고친 연습", null)),
                        List.of(), List.of(new ActorJournal.FeedbackItem("고친 피드백", null, 31)))));

        assertThat(edited.answers().nextAction()).isEqualTo("준호를 보며 말하기");
        assertThat(edited.answers().review()).isEqualTo("고친 후기");
        assertThat(edited.draft().practice()).containsExactly(new ActorJournal.PracticeItem("고친 연습", "discussed"));
        assertThat(edited.draft().feedback()).containsExactly(new ActorJournal.FeedbackItem("고친 피드백", "coach", 31));
        assertThat(edited.editedAt()).isNotNull();
    }

    @Test
    void unfencedStripsOnlyAWrappingCodeFence() {
        assertThat(JournalService.unfenced("```json\n{\"a\":1}\n```")).isEqualTo("{\"a\":1}");
        assertThat(JournalService.unfenced("```{}```")).isEqualTo("{}");
        assertThat(JournalService.unfenced(" {\"a\":1} ")).isEqualTo("{\"a\":1}");
        assertThat(JournalService.unfenced("```")).isEqualTo("```");
        assertThat(JournalService.unfenced(null)).isNull();
    }

    /** 표 하나를 흉내 낸다 — 회차마다 한 줄, 본인 것만, 고친 뒤엔 생성 결과가 덮지 않는다. */
    static final class FakeJournals implements JournalRepository {
        private final Map<UUID, Row> byPractice = new HashMap<>();
        private final Map<UUID, UUID> owners = new HashMap<>();

        @Override
        public Row find(UUID userId, UUID practiceId) {
            return userId.equals(owners.get(practiceId)) ? byPractice.get(practiceId) : null;
        }

        @Override
        public boolean insertPending(UUID id, UUID userId, UUID practiceId, UUID conversationId, String answers, Instant now) {
            if (byPractice.containsKey(practiceId)) return false;
            owners.put(practiceId, userId);
            byPractice.put(practiceId, new Row(id, practiceId, conversationId, answers, null, "pending", null, null, now, now, null, "evaluate", "서연"));
            return true;
        }

        @Override
        public void complete(UUID id, String status, String draft, String model, Instant now) {
            byPractice.replaceAll((practice, row) -> row.id().equals(id) && "pending".equals(row.draftStatus()) && row.editedAt() == null
                    ? new Row(row.id(), row.practiceId(), row.conversationId(), row.answers(), draft, status, model, null, row.createdAt(), now, row.title(), row.purpose(), row.roleName())
                    : row);
        }

        @Override
        public Row update(UUID userId, UUID practiceId, String answers, String draft, Instant now) {
            Row row = find(userId, practiceId);
            if (row == null) return null;
            Row next = new Row(row.id(), practiceId, row.conversationId(), answers, draft,
                    "pending".equals(row.draftStatus()) ? "ready" : row.draftStatus(), row.model(), now, row.createdAt(), now, row.title(), row.purpose(), row.roleName());
            byPractice.put(practiceId, next);
            return next;
        }
    }

    @org.junit.jupiter.api.Test
    void cleanRejectsStackedCombiningMarks() {
        var answers = new ActorJournal.Answers(null, new ActorJournal.Unknown(false, "Z\u0325\u031c\u0318\u0316\u0323x"), null, null);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> JournalService.clean(answers))
                .isInstanceOf(com.acttub.actingapi.platform.web.ApiException.class)
                .hasMessageContaining("unreadable_text");
    }
}
