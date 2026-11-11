package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NewNote;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Saved;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 발표 시연용 정해진 코칭: 대상 계정은 모델 없이 대본을 순서대로 받고 평소처럼 닫힌다. 다른 계정은 그대로다. */
class ScriptedCoachTest {
    static final String DEMO = "/coaching/scripted/demo.json";
    static final String EMAIL = "sukpower198919@gmail.com";
    static final List<String> LINES = List.of(
            "이 사람은 상대에게서 결국 뭘 얻어 내고 싶어요?",
            "\"혼자 해야 했죠\"에서도 \"기회를 주실 수 있잖아요\"에서도 내 억울함만 쏟아내요. 그러면 상대가 다시 기회를 줬을까요?",
            "다시 기회를 얻으려면, 장면 내내 상대한테 뭘 해 볼래요?",
            "맞아요, 그거예요. 상대한테 간절하게 매달려 봐도 좋아요. 특히 \"기회를 주실 수 있잖아요\"에서요.");

    final ConversationRepository conversations = mock(ConversationRepository.class);
    final CoachEngine coach = mock(CoachEngine.class);
    final NoteWriter notes = mock(NoteWriter.class);
    final LineNoteWriter lineNotes = mock(LineNoteWriter.class);
    final CoachProfile profiles = mock(CoachProfile.class);
    final CoachMemory memory = mock(CoachMemory.class);
    final ConversationClosedListener listener = mock(ConversationClosedListener.class);
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-09T00:00:00Z"));
    final UUID user = UUID.randomUUID();
    final UUID practice = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();
    final UUID sessionId = UUID.randomUUID();
    final AtomicReference<CoachSessionSnapshot> current = new AtomicReference<>();
    /** 대상 계정: 이 사용자만 대본 이메일을 가진다. */
    final CoachScriptedUsers users = (id, emails) -> user.equals(id) && emails.contains(EMAIL);

    ConversationService service(ScriptedCoach scripted) {
        return new ConversationService(conversations, coach, notes, clock, listener, profiles, memory,
                new RecordingFailureReporter(), lineNotes).withScripted(scripted);
    }

    static ScriptedCoach scripted(boolean enabled, CoachScriptedUsers users) {
        return ScriptedCoach.load(enabled, " SukPower198919@gmail.com , other@example.com", users,
                Duration.ZERO, Duration.ZERO, DEMO);
    }

    CoachSessionSnapshot snapshot(String version, String status, List<CoachTurnSnapshot> turns, long revision, JsonNode state) {
        return new CoachSessionSnapshot(sessionId, practice, user, null, "", "", "", 8000, "그 외", "그 외", "",
                status, "", turns, PriorContext.EMPTY, version, revision, state, null);
    }

    /** 저장소를 흉내 낸다: 시작·답이 저장한 턴·상태를 다음 읽기가 본다. */
    void fakeRepository(String version) {
        CoachSessionSnapshot empty = snapshot(version, "open", List.of(), 0, null);
        current.set(empty);
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, null, "conversing", empty));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation))
                .thenAnswer(call -> new Loaded(practice, conversation, "conversing", current.get()));
        doAnswer(call -> {
            current.set(snapshot(version, call.getArgument(3) == null ? "open" : "closed",
                    List.of(new CoachTurnSnapshot("ai", call.getArgument(1))), 1, call.getArgument(2)));
            return null;
        }).when(conversations).saveOpening(eq(conversation), anyString(), any(), any(), any());
        when(conversations.appendTurn(eq(conversation), anyLong(), any(), anyString(), anyString(), anyString(), any(),
                anyString(), any(), any())).thenAnswer(call -> {
            CoachSessionSnapshot before = current.get();
            var turns = new ArrayList<>(before.turns());
            turns.add(new CoachTurnSnapshot("actor", call.getArgument(4)));
            turns.add(new CoachTurnSnapshot("ai", call.getArgument(5)));
            long revision = before.stateRevision() + 1;
            current.set(snapshot(version, call.getArgument(7), turns, revision, call.getArgument(6)));
            int coachCount = (int) turns.stream().filter(turn -> "ai".equals(turn.role())).count();
            return new Saved(revision, call.getArgument(7), call.getArgument(8), coachCount);
        });
    }

    @Test void aScriptedActorGetsTheFixedLinesInOrderWithoutAnyModelCallAndClosesLikeANormalLoop() {
        fakeRepository("three_layers_v1");
        ConversationService service = service(scripted(true, users));
        List<ConversationService.Turn> turns = new ArrayList<>();

        turns.add(service.start(user, practice, UUID.randomUUID()));
        // 배우가 무슨 말을 하든 다음 말은 대본의 다음 줄이다.
        for (String answer : List.of("음 글쎄요", "모르겠어요", "그냥 화내요")) {
            turns.add(service.reply(user, conversation, UUID.randomUUID(), answer, current.get().stateRevision()));
        }

        assertThat(turns).extracting(ConversationService.Turn::coachMessage).containsExactlyElementsOf(LINES);
        assertThat(turns).extracting(ConversationService.Turn::status)
                .containsExactly("open", "open", "open", "closed");
        assertThat(turns.getLast().closeReason()).as("연습 루프가 마무리를 마칠 때와 같은 사유").isEqualTo("exhausted");
        assertThat(turns.getFirst().answerExamples()).containsExactly("다시 기회를 얻고 싶어요");
        assertThat(turns.get(2).replyLimit()).as("마지막 앞 줄에서 평소처럼 '다음 답으로 마무리'를 띄운다").isEqualTo(4);
        assertThat(turns.getLast().answerExamples()).isEmpty();

        verifyNoInteractions(coach, notes, lineNotes, listener, memory, profiles);
        var note = ArgumentCaptor.forClass(NewNote.class);
        verify(conversations).saveNote(eq(conversation), note.capture(), any());
        assertThat(note.getValue().format()).isEqualTo("v2");
        assertThat(note.getValue().kind()).isEqualTo("action");
        assertThat(note.getValue().title()).isEqualTo("상대한테 간절하게 매달려 다시 기회를 얻는다");
        assertThat(note.getValue().nextTake()).isEqualTo("\"기회를 주실 수 있잖아요\"에서 간절하게 매달려 보기");
        assertThat(note.getValue().summaryQuotes()).extracting(quote -> quote.path("quote").asText())
                .as("배우가 실제로 한 첫 답과 마지막 답만 인용한다").containsExactly("음 글쎄요", "그냥 화내요");
        assertThat(note.getValue().sourceRevision()).isEqualTo(4);
    }

    @Test void theStreamingPathSendsTheFixedLineAsADelta() {
        fakeRepository("three_layers_v1");
        List<String> streamed = new ArrayList<>();
        CoachStream stream = new CoachStream() {
            @Override public void begin() { streamed.add("begin"); }
            @Override public void delta(String text) { streamed.add(text); }
        };
        ConversationService service = service(scripted(true, users));

        service.start(user, practice, UUID.randomUUID(), stream);
        service.reply(user, conversation, UUID.randomUUID(), "아무 말", null, stream);

        assertThat(streamed).containsExactly("begin", LINES.get(0), "begin", LINES.get(1));
        verifyNoInteractions(coach);
    }

    @Test void theFirstQuestionWaitsLongerThanTheFollowUps() {
        fakeRepository("three_layers_v1");
        ScriptedCoach slow = ScriptedCoach.load(true, EMAIL, users, Duration.ofMillis(300), Duration.ofMillis(50), DEMO);
        ConversationService service = service(slow);

        long started = System.nanoTime();
        service.start(user, practice, UUID.randomUUID());
        long first = System.nanoTime() - started;
        started = System.nanoTime();
        service.reply(user, conversation, UUID.randomUUID(), "아무 말", null);
        long next = System.nanoTime() - started;

        assertThat(Duration.ofNanos(first)).isGreaterThanOrEqualTo(Duration.ofMillis(300));
        assertThat(Duration.ofNanos(next)).isGreaterThanOrEqualTo(Duration.ofMillis(50)).isLessThan(Duration.ofMillis(300));
    }

    @Test void anotherActorStillGoesThroughTheCoachEngine() {
        fakeRepository("three_layers_v1");
        when(coach.start(any(), eq(conversation)))
                .thenReturn(new CoachResult(current.get(), new CoachReply("모델의 첫 질문", "continue", null)));
        CoachScriptedUsers nobody = (id, emails) -> false;

        var turn = service(scripted(true, nobody)).start(user, practice, UUID.randomUUID());

        assertThat(turn.coachMessage()).isEqualTo("모델의 첫 질문");
        verify(coach).start(any(), eq(conversation));
    }

    @Test void turningItOffSendsEvenTheScriptedActorToTheCoachEngine() {
        fakeRepository("three_layers_v1");
        when(coach.start(any(), eq(conversation)))
                .thenReturn(new CoachResult(current.get(), new CoachReply("모델의 첫 질문", "continue", null)));

        var turn = service(scripted(false, users)).start(user, practice, UUID.randomUUID());

        assertThat(turn.coachMessage()).isEqualTo("모델의 첫 질문");
        verify(coach).start(any(), eq(conversation));
    }

    @Test void aFailedLookupFallsBackToTheNormalCoach() {
        fakeRepository("three_layers_v1");
        when(coach.start(any(), eq(conversation)))
                .thenReturn(new CoachResult(current.get(), new CoachReply("모델의 첫 질문", "continue", null)));
        CoachScriptedUsers broken = (id, emails) -> { throw new IllegalStateException("db down"); };

        var turn = service(scripted(true, broken)).start(user, practice, UUID.randomUUID());

        assertThat(turn.coachMessage()).isEqualTo("모델의 첫 질문");
    }

    @Test void legacySessionsAreNotScripted() {
        fakeRepository("legacy");
        when(coach.start(any(), eq(conversation)))
                .thenReturn(new CoachResult(current.get(), new CoachReply("옛 갈래 첫 질문", "continue", null)));

        service(scripted(true, users)).start(user, practice, UUID.randomUUID());

        verify(coach).start(any(), eq(conversation));
        verify(conversations, never()).saveNote(any(), any(), any());
    }

    @Test void theEmailListIsTrimmedAndCaseInsensitive() {
        var seen = new AtomicReference<Set<String>>();
        ScriptedCoach scripted = scripted(true, (id, emails) -> {
            seen.set(emails);
            return true;
        });
        assertThat(scripted.appliesTo(user)).isTrue();
        assertThat(seen.get()).containsExactlyInAnyOrder(EMAIL, "other@example.com");
        assertThat(ScriptedCoach.load(true, " , ", users, Duration.ZERO, Duration.ZERO, DEMO).appliesTo(user)).isFalse();
        assertThat(ScriptedCoach.NONE.appliesTo(user)).isFalse();
    }
}
