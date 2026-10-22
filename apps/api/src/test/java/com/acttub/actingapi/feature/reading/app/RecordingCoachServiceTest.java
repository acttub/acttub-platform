package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingCoachModel.Reply;
import com.acttub.actingapi.feature.reading.app.RecordingCoachModel.Turn;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Line;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Recording;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class RecordingCoachServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-21T08:00:00Z");
    private static final UUID USER = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();

    private final FakeRepository repository = new FakeRepository();
    private final FakeModel model = new FakeModel();
    private final RecordingCoachService service = new RecordingCoachService(
            repository, model, "지시문", Clock.fixed(NOW, ZoneId.of("Asia/Seoul")));

    @Test
    void firstTurnHidesTheDesignAndRemembersTheChosenLine() {
        repository.material = material(3);
        model.next = "<설계>\n들린 것\n고른 녹음: 2\n</설계>\n\"대사 1\"은 끝이 내려가요. 윤서는 왜 이 말을 해요?";

        RecordingCoachService.Started started = service.start(USER, SESSION);

        assertThat(started.created()).isTrue();
        assertThat(started.coach().firstMessage()).isEqualTo("\"대사 1\"은 끝이 내려가요. 윤서는 왜 이 말을 해요?");
        assertThat(repository.first.design()).contains("고른 녹음: 2");
        assertThat(repository.first.focusLineId()).isEqualTo(repository.material.lines().get(1).id());
        assertThat(repository.first.clipCount()).isEqualTo(3);
        assertThat(model.calls).hasSize(1);
        assertThat(model.calls.getFirst().clips()).hasSize(3);
        assertThat(model.calls.getFirst().turns()).containsExactly(new Turn(false, "[이번 차례] 차례 1"));
    }

    @Test
    void existingConversationIsReturnedWithoutCallingTheModel() {
        repository.stored = coach(null);

        RecordingCoachService.Started started = service.start(USER, SESSION);

        assertThat(started.created()).isFalse();
        assertThat(model.calls).isEmpty();
    }

    @Test
    void missingSessionIs404() {
        assertDetail(() -> service.start(USER, SESSION), 404, "session_not_found");
    }

    @Test
    void sessionDeletedWhileTheModelAnsweredIs404() {
        repository.material = material(3);
        repository.dropOnInsert = true;
        model.next = "답이에요.";
        assertDetail(() -> service.start(USER, SESSION), 404, "session_not_found");
    }

    @Test
    void fewerThanThreeAudibleLinesIs422() {
        repository.material = material(2);
        assertDetail(() -> service.start(USER, SESSION), 422, "recording_coach_not_enough_audio");
        assertThat(model.calls).isEmpty();
    }

    @Test
    void modelFailureAndEmptyAnswerAre503() {
        repository.material = material(3);
        model.failure = new IllegalStateException("down");
        assertDetail(() -> service.start(USER, SESSION), 503, "recording_coach_unavailable");
        model.failure = null;
        model.next = "<설계>고른 녹음: 1</설계>";
        assertDetail(() -> service.start(USER, SESSION), 503, "recording_coach_unavailable");
    }

    @Test
    void secondTurnSendsTheConversationAndSavesTheReply() {
        repository.material = material(3);
        repository.stored = coach(null);
        model.next = "그 답은 녹음과 맞아요. 소리로는 여기까지예요. 이 한 줄만 영상으로 찍어 볼래요?";

        RecordingCoachRepository.Coach saved = service.reply(USER, repository.stored.id(), "  화가 나서요 ");

        assertThat(saved.actorReply()).isEqualTo("화가 나서요");
        assertThat(saved.secondMessage()).startsWith("그 답은");
        List<Turn> turns = model.calls.getFirst().turns();
        assertThat(turns).hasSize(3);
        assertThat(turns.get(1)).isEqualTo(new Turn(true, "첫 차례"));
        assertThat(turns.get(2).text()).isEqualTo("배우가 방금 말한 것: 화가 나서요\n\n[이번 차례] 차례 2");
    }

    @Test
    void answeredConversationIsNotSentAgain() {
        repository.stored = coach("이미 답했어요.");
        assertThat(service.reply(USER, repository.stored.id(), "또").secondMessage()).isEqualTo("이미 답했어요.");
        assertThat(model.calls).isEmpty();
    }

    @Test
    void replyToMissingConversationIs404() {
        assertDetail(() -> service.reply(USER, UUID.randomUUID(), "답"), 404, "recording_coach_not_found");
        assertDetail(() -> service.get(USER, UUID.randomUUID()), 404, "recording_coach_not_found");
    }

    @Test
    void replyAfterRecordingsWereDeletedIs422() {
        repository.material = material(0);
        repository.stored = coach(null);
        assertDetail(() -> service.reply(USER, repository.stored.id(), "답"), 422, "recording_coach_not_enough_audio");
    }

    @Test
    void replyAfterSessionWasDeletedIs404() {
        repository.stored = coach(null);
        assertDetail(() -> service.reply(USER, repository.stored.id(), "답"), 404, "recording_coach_not_found");
    }

    @Test
    void bundledPromptLoads() {
        assertThat(RecordingCoachService.loadInstruction()).contains("[차례 1", "[차례 2", "고른 녹음");
    }

    private static void assertDetail(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, error -> {
            assertThat(error.status()).isEqualTo(status);
            assertThat(error.getMessage()).isEqualTo(detail);
        });
    }

    @Test
    void measuredSoundsAreShownToTheModelAndKeptInTheDesign() {
        repository.material = material(3);
        model.next = "<설계>\n고른 녹음: 2\n</설계>\n\"대사 1\"은 다른 대사들보다 크게 들려요. 윤서는 왜 이 말을 해요?";
        RecordingSounds sounds = clips -> java.util.Map.of(
                1, new com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound(-17, 5.0, 0, -1.0, -1.0, 2_000),
                2, new com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound(-12, 5.0, 0, -1.0, -1.0, 2_000),
                3, new com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound(-17.5, 5.0, 0, -1.0, -1.0, 2_000));
        RecordingCoachService measured = new RecordingCoachService(
                repository, model, sounds, "지시문", Clock.fixed(NOW, ZoneId.of("Asia/Seoul")));

        measured.start(USER, SESSION);

        assertThat(model.scripts.getFirst()).contains("[서버가 잰 소리]", "- 녹음 2: 다른 대사들보다 크게 들려요");
        assertThat(repository.first.design()).startsWith("[서버가 잰 소리]").contains("고른 녹음: 2");
    }

    @Test
    void withoutMeasurementsTheModelIsToldThereIsNoSoundToMention() {
        repository.material = material(3);
        model.next = "<설계>\n고른 녹음: 1\n</설계>\n윤서는 왜 이 말을 해요?";

        service.start(USER, SESSION);

        assertThat(model.scripts.getFirst()).contains("확실히 다르게 잰 소리가 없다");
    }

    @Test
    void evaluativeFirstAnswerIsRewrittenOnce() {
        repository.material = material(3);
        model.queue.add("<설계>\n고른 녹음: 1\n</설계>\n\"대사 0\"은 잘 전달돼요. 윤서는 왜 이 말을 해요?");
        model.queue.add("<설계>\n고른 녹음: 1\n</설계>\n윤서는 왜 이 말을 해요?");

        RecordingCoachService.Started started = service.start(USER, SESSION);

        assertThat(started.coach().firstMessage()).isEqualTo("윤서는 왜 이 말을 해요?");
        assertThat(model.calls).hasSize(2);
        assertThat(model.calls.get(1).turns().getLast().text()).contains("[다시 쓰기]", "잘 전달");
    }

    @Test
    void secondAnswerKeepsTheOriginalWhenTheRewriteIsStillEvaluative() {
        repository.material = material(3);
        repository.stored = coach(null);
        model.queue.add("느리게 말한 게 잘 맞네요. 그 줄을 영상으로 찍어 봐요.");
        model.queue.add("소리로는 충분해요. 그 줄을 영상으로 찍어 봐요.");

        RecordingCoachRepository.Coach answered = service.reply(USER, repository.stored.id(), "털어놓고 싶은 마음이요");

        assertThat(model.calls).hasSize(2);
        assertThat(answered.secondMessage()).isEqualTo("느리게 말한 게 잘 맞네요. 그 줄을 영상으로 찍어 봐요.");
    }

    private static RecordingCoachRepository.Material material(int audible) {
        List<Line> lines = new ArrayList<>();
        List<Recording> recordings = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            Line line = new Line(UUID.randomUUID(), i, "dialogue", "대사 " + i, ME, "윤서");
            lines.add(line);
            if (i < audible) {
                recordings.add(new Recording(line.id(), "k" + i, "audio/mp4", 1500, 10_000, "대사", "stt"));
            }
        }
        return new RecordingCoachRepository.Material(Set.of(ME), lines, recordings);
    }

    private static RecordingCoachRepository.Coach coach(String second) {
        return new RecordingCoachRepository.Coach(UUID.randomUUID(), SESSION, null, null, "첫 차례",
                second == null ? null : "전에 한 답", second, NOW, NOW);
    }

    private static final class FakeRepository implements RecordingCoachRepository {
        Material material;
        Coach stored;
        FirstTurn first;
        boolean dropOnInsert;

        @Override
        public Material material(UUID userId, UUID sessionId) {
            return material;
        }

        @Override
        public Coach findBySession(UUID userId, UUID sessionId) {
            return stored;
        }

        @Override
        public Coach find(UUID userId, UUID coachId) {
            return stored != null && stored.id().equals(coachId) ? stored : null;
        }

        @Override
        public Coach insertFirst(UUID userId, UUID sessionId, FirstTurn first, Instant now) {
            this.first = first;
            if (dropOnInsert) {
                return null;
            }
            stored = new Coach(UUID.randomUUID(), sessionId, first.focusLineId(), null, first.message(), null, null,
                    now, now);
            return stored;
        }

        @Override
        public Coach saveSecond(UUID userId, UUID coachId, String actorReply, String secondMessage, Instant now) {
            stored = new Coach(stored.id(), stored.sessionId(), stored.focusLineId(), stored.focusLineText(),
                    stored.firstMessage(), actorReply, secondMessage, stored.createdAt(), now);
            return stored;
        }
    }

    private record Call(List<Clip> clips, List<Turn> turns) {
    }

    private static final class FakeModel implements RecordingCoachModel {
        final List<Call> calls = new ArrayList<>();
        final List<String> scripts = new ArrayList<>();
        String next;
        final java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>();
        RuntimeException failure;

        @Override
        public Reply reply(String instruction, String script, List<Clip> clips, List<Turn> turns) {
            calls.add(new Call(clips, turns));
            scripts.add(script);
            if (failure != null) {
                throw failure;
            }
            return new Reply(queue.isEmpty() ? next : queue.poll(), "gemini-test");
        }
    }
}
