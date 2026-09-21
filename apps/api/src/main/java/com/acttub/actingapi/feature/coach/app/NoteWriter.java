package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.List;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NewNote;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.report.app.PracticeNote;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 대화가 닫힐 때 연습 노트를 <b>한 번</b> 만든다 (practice.note).
 *
 * <p>고정된 종료 {@code revision} 으로 만들고 이미 있는 노트를 다시 만들지 않는다 — 재생성 요청은 같은 노트를
 * 돌려받는다. 생성이 실패하면 <b>한 번 재시도</b>하고 그래도 실패하면 갈래가 갈린다: 기존 갈래는 노트를 만들지
 * 않고, 신형은 확인된 것만 담은 폴백을 남긴다({@code fallback = true}).
 *
 * <p>만들지 않는 조건도 갈래마다 다르다. 기존 갈래는 <b>유효한 배우 답이 2개 미만</b>이면 만들지 않는다(초기 폼의
 * 막힘 상세와 종료어는 답으로 세지 않는다). 신형은 조기 종료에도 기록을 남긴다 — 제안이 있으면 {@code action},
 * 초점만 남았으면 {@code observation}, 초점도 없으면 {@code record_only} 이고 그때 제목은 NULL 이다.
 *
 * <p>노트가 소유하는 것은 제목·요약 인용·제안·종류·배우 문장·정정·태그·폴백 여부·{@code source_revision} 이고,
 * 생성기가 낸 <b>원문 전체</b>를 함께 둔다 — 옛 공개 필드를 그대로 내는 호환 응답이 그것을 읽는다.
 */
public class NoteWriter {

    /** 기존 갈래에서 노트를 만들기 위한 최소 유효 답 수. */
    static final int LEGACY_MIN_ACTOR_ANSWERS = 2;

    private final ConversationRepository conversations;
    private final ReportEngine reports;

    public NoteWriter(ConversationRepository conversations, ReportEngine reports) {
        this.conversations = conversations;
        this.reports = reports;
    }

    /** @return 만들지 않았으면 {@code null} */
    public NoteView write(Loaded loaded, CoachResult result, long sourceRevision, Instant now) {
        CoachSessionSnapshot session = result.session();
        boolean threeLayers = session.threeLayers();
        if (!threeLayers && validAnswers(session) < LEGACY_MIN_ACTOR_ANSWERS) {
            // "모르겠어요 → 그만": 연습 기록에 "아직 정리 없음" 으로 남는다.
            return null;
        }
        JsonNode report = generate(loaded, result, threeLayers);
        if (report == null) {
            // 거듭 실패했다. 기존 갈래는 노트가 없고, 신형은 확인된 것만 남긴다.
            return threeLayers
                    ? conversations.saveNote(loaded.conversationId(), fallbackNote(sourceRevision), now)
                    : null;
        }
        return conversations.saveNote(
                loaded.conversationId(), note(report, session, threeLayers, sourceRevision), now);
    }

    /** 생성 실패는 한 번 재시도한다. 두 번 다 실패하면 {@code null}. */
    private JsonNode generate(Loaded loaded, CoachResult result, boolean threeLayers) {
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                return reports.generateReport(
                        ConversationService.branchOf(result.session()),
                        observationPack(result.session()),
                        result.reply().handoff(),
                        !threeLayers,
                        loaded.conversationId().toString(),
                        result.session().analysisHandoff(),
                        null,
                        loaded.practiceId(),
                        result.session().userId());
            } catch (Exception retryable) {
                // 생성 실패는 한 번 재시도한다 — 모델이 형식을 어기거나 잠시 답하지 못하는 경우다.
                if (attempt == 1) {
                    return null;
                }
            }
        }
        return null;
    }

    private NewNote note(JsonNode report, CoachSessionSnapshot session, boolean threeLayers, long sourceRevision) {
        if (!threeLayers || !PracticeNote.isNote(report)) {
            // 기존 갈래: 종류와 응답 모양을 현행 그대로 두고 원문을 보존한다.
            return new NewNote(
                    "legacy",
                    ConversationService.branchOf(session),
                    text(report.path("title")),
                    empty(),
                    null,
                    empty(),
                    empty(),
                    empty(),
                    false,
                    sourceRevision,
                    report);
        }
        String mode = report.path("mode").asText("record_only");
        JsonNode focus = report.path("focus");
        JsonNode direction = report.path("direction");
        return new NewNote(
                "v2",
                mode,
                // 제목은 초점 문구 원문이다. 초점 없이 끝난 record_only 는 NULL.
                "record_only".equals(mode) || focus.isMissingNode() || focus.isNull()
                        ? null
                        : text(focus.path("label")),
                empty(),
                direction.isMissingNode() || direction.isNull() ? null : text(direction.path("text")),
                empty(),
                empty(),
                empty(),
                false,
                sourceRevision,
                report);
    }

    /** 확인된 것만 담은 폴백 — 제안을 만들지 않는다(신형의 {@code system_failure}). */
    private NewNote fallbackNote(long sourceRevision) {
        return new NewNote("v2", "record_only", null, empty(), null, empty(), empty(), empty(),
                true, sourceRevision, null);
    }

    /**
     * 종료어와 도움말을 뺀 배우 답의 수. 기존 갈래가 노트를 만들지 판정하는 기준이다.
     *
     * <p>옛 흐름은 첫 배우 턴이 폼의 막힘 상세라 그것을 뺐다. <b>1.0.0 은 영상만 올리고 시작하므로 시작에
     * 배우 메시지가 없다</b> — 저장된 배우 턴은 처음부터 진짜 답이다(practice.start).
     */
    private static int validAnswers(CoachSessionSnapshot session) {
        List<com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot> turns = session.turns();
        int counted = 0;
        for (var turn : turns) {
            if (!"actor".equals(turn.role())) {
                continue;
            }
            if (com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(turn.text())
                    || com.acttub.actingapi.feature.coach.domain.CoachHelpIntent.needsExplanation(turn.text())) {
                continue;
            }
            counted++;
        }
        return counted;
    }

    /** 관찰이 아직 없는 회차도 노트 생성을 부를 수 있어야 한다 — 빈 묶음으로 채운다. */
    private static JsonNode observationPack(CoachSessionSnapshot session) {
        if (session.observationPack() != null) {
            return session.observationPack();
        }
        ObjectNode empty = ConversationService.json().createObjectNode();
        empty.set("observations", ConversationService.json().createArrayNode());
        empty.set("uncertainties", ConversationService.json().createArrayNode());
        return empty;
    }

    private static JsonNode empty() {
        return ConversationService.json().createArrayNode();
    }

    private static String text(JsonNode value) {
        return value == null || value.isMissingNode() || value.isNull() || value.asText().isBlank()
                ? null
                : value.asText();
    }
}
