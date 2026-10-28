package com.acttub.actingapi.feature.coach.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.coach.app.ActorJournal.Answers;
import com.acttub.actingapi.feature.coach.app.ActorJournal.Draft;
import com.acttub.actingapi.feature.coach.app.ActorJournal.View;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.platform.text.InputCharset;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.OutputLanguage;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 배우 일지(practice.journal, SOMA-720) — 고정 질문 4개의 답을 받아 일지를 만들고, 읽고, 고친다.
 *
 * <p>자동 칸은 연습 노트와 같은 생성기(노트용 OpenAI 키의 {@code OpenAiTextGenerators.report()})로 만들고, 노트처럼 실패하면
 * <b>한 번 재시도</b>한다. 그래도 실패하면 배우의 답만으로 일지를 저장한다(draft_status=failed) — 앱은 그것을 그대로 보인다.
 * 모델 호출은 트랜잭션 밖이다(CONTRACT §5-4). 한 회차에 일지는 하나이고 다시 만들지 않는다 — 같은 회차의 두 번째 생성 요청은
 * 이미 있는 일지를 돌려준다.
 */
public class JournalService {

    static final String PROMPT = StructuredJson.textResource(ActorJournal.PROMPT_RESOURCE);
    static final int ATTEMPTS = 2;

    private final JournalRepository journals;
    private final ConversationRepository conversations;
    private final TextGenerator generator;
    private final LlmTelemetry telemetry;
    private final ObjectMapper json;
    private final Clock clock;
    private final Supplier<UUID> ids;

    public JournalService(JournalRepository journals, ConversationRepository conversations, TextGenerator generator,
            LlmTelemetry telemetry, ObjectMapper json, Clock clock, Supplier<UUID> ids) {
        this.journals = journals;
        this.conversations = conversations;
        this.generator = generator;
        this.telemetry = telemetry;
        this.json = json;
        this.clock = clock;
        this.ids = ids;
    }

    /** @param created 이번 요청이 새로 만들었다 */
    public record Created(View view, boolean created) {
    }

    /** 고친 일지. 배우의 답 전체와 자동 칸 전체를 받아 바꾼다 — 빈 글의 항목은 지운다. */
    public record Edit(Answers answers, Draft draft) {
    }

    public Created create(UUID userId, UUID practiceId, Answers answers) {
        ConversationRepository.Loaded loaded = conversations.loadByPractice(userId, practiceId);
        if (loaded == null) {
            throw new ApiException(404, "practice_not_found");
        }
        JournalRepository.Row existing = journals.find(userId, practiceId);
        if (existing != null) return new Created(view(existing), false);
        Answers clean = clean(answers);
        UUID id = ids.get();
        Instant now = clock.instant();
        if (!journals.insertPending(id, userId, practiceId, loaded.conversationId(), write(ActorJournal.answersJson(json, clean)), now)) {
            // 겹친 요청이 먼저 넣었다. 그 일지를 돌려준다(아직 만드는 중일 수 있다).
            return new Created(view(journals.find(userId, practiceId)), false);
        }
        if (loaded.conversationId() == null || !ActorJournal.hasConversation(loaded.session())) {
            journals.complete(id, "skipped", null, null, clock.instant());
        } else {
            generateInto(id, userId, practiceId, loaded.session(), clean);
        }
        return new Created(view(journals.find(userId, practiceId)), true);
    }

    public View find(UUID userId, UUID practiceId) {
        JournalRepository.Row row = journals.find(userId, practiceId);
        if (row == null) {
            throw new ApiException(404, "journal_not_found");
        }
        return view(row);
    }

    public View update(UUID userId, UUID practiceId, Edit edit) {
        Draft draft = clean(edit.draft());
        JournalRepository.Row row = journals.update(userId, practiceId, write(ActorJournal.answersJson(json, clean(edit.answers()))),
                write(ActorJournal.draftJson(json, draft)), clock.instant());
        if (row == null) {
            throw new ApiException(404, "journal_not_found");
        }
        return view(row);
    }

    /** 자동 칸을 만들어 저장한다. 두 번 다 실패하면 failed 로 남기고 배우의 답은 그대로 둔다. */
    private void generateInto(UUID id, UUID userId, UUID practiceId, CoachSessionSnapshot session, Answers answers) {
        ObjectNode input = ActorJournal.modelInput(json, session, PurposeView.from(session.sessionPurpose(), session.coachingState()), answers);
        String userPrompt = input.toString();
        String systemPrompt = OutputLanguage.apply(PROMPT);
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            try {
                GeneratedText generated = recorded(systemPrompt, userPrompt, practiceId, userId);
                Draft draft = ActorJournal.sanitize(StructuredJson.parse(unfenced(generated.text())), input);
                journals.complete(id, "ready", write(ActorJournal.draftJson(json, draft)), generated.model(), clock.instant());
                return;
            } catch (RuntimeException retryable) {
                // 모델이 형식을 어기거나 잠시 답하지 못한 경우다. 한 번 더 부르고, 그래도 안 되면 배우의 답만 남긴다.
            }
        }
        journals.complete(id, "failed", null, null, clock.instant());
    }

    /** 모델을 부르고 그 한 번을 노트와 같은 단계(report)로 남긴다. */
    private GeneratedText recorded(String systemPrompt, String userPrompt, UUID practiceId, UUID userId) {
        Instant startedAt = Instant.now();
        String recordedInput = systemPrompt + "\n\n" + userPrompt;
        try {
            ExternalOperationExecution.externalCall("model");
            GeneratedText generated = generator.generate(systemPrompt, userPrompt);
            telemetry.record(new LlmCall(LlmStep.REPORT, practiceId, userId, generated.model(), recordedInput, generated.text(),
                    generated.usage() == null ? LlmTokens.unknown()
                            : LlmTokens.of(generated.usage().prompt(), generated.usage().completion(), generated.usage().total()),
                    startedAt, Duration.between(startedAt, Instant.now()), null,
                    LlmCall.metadata("report_type", "actor_journal")));
            return generated;
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(LlmStep.REPORT, practiceId, userId, "", recordedInput, "", LlmTokens.unknown(),
                    startedAt, Duration.between(startedAt, Instant.now()), failure.getClass().getSimpleName(),
                    LlmCall.metadata("report_type", "actor_journal")));
            throw failure;
        }
    }

    /** 모델이 JSON 을 ```json … ``` 로 감싸 보냈으면 벗긴다(정규식 되짚기 없이 앞뒤만 본다). */
    static String unfenced(String text) {
        if (text == null) return null;
        String body = text.strip();
        if (!body.startsWith("```") || !body.endsWith("```") || body.length() < 6) return body;
        body = body.substring(3, body.length() - 3);
        if (body.regionMatches(true, 0, "json", 0, 4)) body = body.substring(4);
        return body.strip();
    }

    /** 앞뒤 공백만 걷는다 — 배우의 글은 고쳐 쓰지 않는다. 빈 글은 null 이고, 아무것도 없는 질문은 건너뛴 것(null)이다. */
    static Answers clean(Answers answers) {
        if (answers == null) return Answers.empty();
        ActorJournal.Feeling feeling = answers.feeling() == null ? null
                : new ActorJournal.Feeling(strip(answers.feeling().choice()), strip(answers.feeling().text()));
        if (feeling != null && feeling.choice() == null && feeling.text() == null) feeling = null;
        ActorJournal.Unknown unknown = answers.unknown() == null ? null
                : new ActorJournal.Unknown(answers.unknown().none(), strip(answers.unknown().text()));
        if (unknown != null && !unknown.none() && unknown.text() == null) unknown = null;
        ActorJournal.Next next = answers.next() == null ? null
                : new ActorJournal.Next(answers.next().undecided(), strip(answers.next().text()));
        if (next != null && !next.undecided() && next.text() == null) next = null;
        return new Answers(feeling, unknown, next, strip(answers.review()));
    }

    static Draft clean(Draft draft) {
        if (draft == null) return Draft.empty();
        return new Draft(
                draft.practice().stream().filter(item -> strip(item.text()) != null)
                        .map(item -> new ActorJournal.PracticeItem(strip(item.text()), item.basis() == null ? "discussed" : item.basis())).toList(),
                draft.character().stream().filter(item -> strip(item.text()) != null)
                        .map(item -> new ActorJournal.CharacterItem(item.aspect(), strip(item.text()))).toList(),
                draft.feedback().stream().filter(item -> strip(item.text()) != null)
                        .map(item -> new ActorJournal.FeedbackItem(strip(item.text()), item.giver() == null ? "coach" : item.giver(), item.at())).toList());
    }

    private static String strip(String value) {
        if (value == null) return null;
        InputCharset.require(value);
        String stripped = value.strip();
        return stripped.isEmpty() ? null : stripped;
    }

    private View view(JournalRepository.Row row) {
        return new View(row.id(), row.practiceId(), row.conversationId(), ActorJournal.answersOf(read(row.answers())),
                row.draftStatus(), ActorJournal.draftOf(read(row.draft())), row.editedAt(), row.createdAt(), row.updatedAt(),
                row.title(), row.purpose(), row.roleName());
    }

    private JsonNode read(String text) {
        if (text == null) return null;
        try {
            return json.readTree(text);
        } catch (JsonProcessingException malformed) {
            throw new IllegalStateException("stored journal is not JSON", malformed);
        }
    }

    private String write(JsonNode node) {
        try {
            return json.writeValueAsString(node);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
