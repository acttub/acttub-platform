package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.reading.app.RecordingCoachModel.Reply;
import com.acttub.actingapi.feature.reading.app.RecordingCoachModel.Turn;
import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository.Coach;
import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository.FirstTurn;
import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository.Material;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Output;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Prepared;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Cue;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 녹음 코치 (reading.recording-coach, 실험·기본 꺼짐, SOMA-791). 리딩 회차의 내 대사 녹음으로 두 차례 대화한다.
 *
 * <p>차례 1: 녹음에서 들린 것 하나 + 대본 질문. 차례 2: 배우의 답을 받아 이어 주고 그 한 줄을 영상으로 찍자고 권한다.
 * 모델 호출은 트랜잭션 밖이다(CONTRACT §5-4) — 저장소의 각 메서드가 자기 트랜잭션을 갖는다.
 *
 * <p>거절: 남의·없는 회차 404 {@code session_not_found}, 소리가 든 내 대사 녹음이 {@link RecordingCoachMaterial#MIN_CLIPS}
 * 줄보다 적으면 422 {@code recording_coach_not_enough_audio}, 없는 대화 404 {@code recording_coach_not_found}, 모델 실패나
 * 빈 답 503 {@code recording_coach_unavailable}.
 */
public class RecordingCoachService {
    private static final Logger LOGGER = Logger.getLogger(RecordingCoachService.class.getName());

    static final String FIRST = "\n\n[이번 차례] 차례 1";
    static final String SECOND = "\n\n[이번 차례] 차례 2";
    static final String REWRITE = "\n\n[다시 쓰기] 방금 쓴 답에 평가하는 말(\"%s\")이 있었다. 잘했다·잘 맞는다·잘 어울린다·충분하다 같은 "
            + "평가 없이, 들린 것과 배우의 답이 맞는지만 그대로 말하도록 다시 쓴다.";

    private final RecordingCoachRepository coaches;
    private final RecordingCoachModel model;
    private final RecordingSounds sounds;
    private final String instruction;
    private final Clock clock;

    public RecordingCoachService(RecordingCoachRepository coaches, RecordingCoachModel model, RecordingSounds sounds, Clock clock) {
        this(coaches, model, sounds, loadInstruction(), clock);
    }

    RecordingCoachService(RecordingCoachRepository coaches, RecordingCoachModel model, String instruction, Clock clock) {
        this(coaches, model, RecordingSounds.NONE, instruction, clock);
    }

    RecordingCoachService(RecordingCoachRepository coaches, RecordingCoachModel model, RecordingSounds sounds,
            String instruction, Clock clock) {
        this.coaches = coaches;
        this.model = model;
        this.sounds = sounds;
        this.instruction = instruction;
        this.clock = clock;
    }

    /** @return 이번에 만들었으면 {@code created=true}(201), 이미 있던 대화면 {@code false}(200) */
    public Started start(UUID userId, UUID sessionId) {
        Coach existing = coaches.findBySession(userId, sessionId);
        if (existing != null) {
            return new Started(existing, false);
        }
        Material material = coaches.material(userId, sessionId);
        if (material == null) {
            throw new ApiException(404, "session_not_found");
        }
        Prepared prepared = RecordingCoachMaterial.prepare(
                material.lines(), material.myCharacterIds(), material.recordings());
        if (prepared.clips().size() < RecordingCoachMaterial.MIN_CLIPS) {
            throw new ApiException(422, "recording_coach_not_enough_audio");
        }
        List<Cue> cues = RecordingSoundCues.pick(prepared.clips(), sounds.measure(prepared.clips()));
        List<Turn> firstTurns = List.of(new Turn(false, FIRST.strip()));
        Reply reply = call(prepared, cues, firstTurns);
        Output output = RecordingCoachMaterial.parse(reply.text());
        requireMessage(output);
        Reply rewritten = withoutEvaluation(prepared, cues, firstTurns, output);
        if (rewritten != null) {
            reply = rewritten;
            output = RecordingCoachMaterial.parse(reply.text());
        }
        Integer chosen = output.chosenClip();
        if (!cues.isEmpty() && cues.stream().noneMatch(c -> java.util.Objects.equals(c.clip(), chosen))) {
            LOGGER.warning("recording coach chose a clip outside the measured cues: " + chosen);
        }
        String design = RecordingSoundCues.block(cues).strip() + "\n\n" + (output.design() == null ? "" : output.design());
        Coach saved = coaches.insertFirst(userId, sessionId, new FirstTurn(
                reply.model(), prepared.clips().size(), design, output.message(),
                prepared.lineOf(output.chosenClip())), clock.instant());
        if (saved == null) {
            throw new ApiException(404, "session_not_found");
        }
        // 겹친 요청이 먼저 넣었으면 그 대화가 돌아온다 — 이 요청의 답은 버린다.
        return new Started(saved, true);
    }

    public Coach get(UUID userId, UUID coachId) {
        Coach coach = coaches.find(userId, coachId);
        if (coach == null) {
            throw notFound();
        }
        return coach;
    }

    /** 배우의 답에 둘째 차례로 답한다. 이미 답한 대화면 모델을 부르지 않고 지금 값을 돌려준다. */
    public Coach reply(UUID userId, UUID coachId, String actorReply) {
        Coach coach = get(userId, coachId);
        if (coach.secondMessage() != null) {
            return coach;
        }
        Material material = coaches.material(userId, coach.sessionId());
        if (material == null) {
            throw notFound();
        }
        Prepared prepared = RecordingCoachMaterial.prepare(
                material.lines(), material.myCharacterIds(), material.recordings());
        if (prepared.clips().isEmpty()) {
            // 그사이 녹음을 지웠다 — 첫 차례에 보인 것을 다시 보일 수 없다.
            throw new ApiException(422, "recording_coach_not_enough_audio");
        }
        List<Cue> cues = RecordingSoundCues.pick(prepared.clips(), sounds.measure(prepared.clips()));
        List<Turn> secondTurns = List.of(
                new Turn(false, FIRST.strip()),
                new Turn(true, coach.firstMessage()),
                new Turn(false, "배우가 방금 말한 것: " + actorReply.strip() + SECOND));
        Reply reply = call(prepared, cues, secondTurns);
        Output output = RecordingCoachMaterial.parse(reply.text());
        requireMessage(output);
        Reply rewritten = withoutEvaluation(prepared, cues, secondTurns, output);
        if (rewritten != null) {
            output = RecordingCoachMaterial.parse(rewritten.text());
        }
        Coach saved = coaches.saveSecond(userId, coachId, actorReply.strip(), output.message(), clock.instant());
        if (saved == null) {
            throw notFound();
        }
        return saved;
    }

    /**
     * 답에 평가하는 말이 있으면 그 말을 빼라고 한 번만 다시 쓰게 한다. 다시 쓴 답도 평가가 남았거나 비면 처음 답을 쓴다
     * ({@code null}) — 대화를 멈추지는 않는다.
     */
    private Reply withoutEvaluation(Prepared prepared, List<Cue> cues, List<Turn> turns, Output output) {
        String found = RecordingCoachMaterial.evaluative(output.message());
        if (found == null) {
            return null;
        }
        List<Turn> retry = new ArrayList<>(turns);
        Turn last = retry.removeLast();
        retry.add(new Turn(false, last.text() + REWRITE.formatted(found)));
        Reply again = call(prepared, cues, List.copyOf(retry));
        Output parsed = RecordingCoachMaterial.parse(again.text());
        if (parsed.message().isBlank() || RecordingCoachMaterial.evaluative(parsed.message()) != null) {
            LOGGER.warning("recording coach kept an evaluative phrase: " + found);
            return null;
        }
        return again;
    }

    private Reply call(Prepared prepared, List<Cue> cues, List<Turn> turns) {
        try {
            return model.reply(instruction, prepared.script() + RecordingSoundCues.block(cues), prepared.clips(), turns);
        } catch (RuntimeException failure) {
            throw ApiException.external(503, "recording_coach_unavailable", failure);
        }
    }

    private static void requireMessage(Output output) {
        if (output.message().isBlank()) {
            throw ApiException.unexpected(503, "recording_coach_unavailable",
                    new IllegalStateException("recording coach returned no visible message"));
        }
    }

    private static ApiException notFound() {
        return new ApiException(404, "recording_coach_not_found");
    }

    static String loadInstruction() {
        try (InputStream input = RecordingCoachService.class.getResourceAsStream("/reading/recording-coach-prompt.txt")) {
            if (input == null) {
                throw new IllegalStateException("recording coach prompt is missing");
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    public record Started(Coach coach, boolean created) {
    }
}
