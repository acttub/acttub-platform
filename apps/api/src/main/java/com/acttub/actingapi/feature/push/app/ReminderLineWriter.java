package com.acttub.actingapi.feature.push.app;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import org.springframework.stereotype.Component;

/**
 * 지난 연습 노트의 "다음 촬영에서 해볼 한 가지"를 잠금 화면에 띄울 한 줄로 줄인다 (SOMA-704 B 문구).
 *
 * <p>노트 문장을 그대로 띄우지 않는 이유: 상대 인물 이름("아빠", "허미어")·대사 인용·작품명이 들어 있어 잠금 화면에
 * 뜨면 어색하고 사적인 내용처럼 보인다. 행동이 아닌 문장(관찰)도 섞여 있다. 그래서 모델이 한 번 줄이고, 아래 검사를
 * 통과한 것만 쓴다. 어떤 이유로든 못 쓰면 비우고, 부르는 쪽이 고정 문구(A)를 보낸다.
 */
@Component
public class ReminderLineWriter {
    static final int KO_LIMIT = 40;
    static final int EN_LIMIT = 70;
    static final String SKIP = "SKIP";
    private static final Duration TIMEOUT = Duration.ofSeconds(15);
    private static final GenerationOptions OPTIONS = new GenerationOptions(null, "low", 400, null, null, TIMEOUT);
    private static final Pattern QUOTES = Pattern.compile("[\"'“”‘’「」『』《》<>]");
    private static final Pattern HANGUL = Pattern.compile("[가-힣]");

    static final String KO_INSTRUCTIONS = """
            너는 연기 연습 앱의 저녁 알림 본문을 쓴다. 입력은 배우가 지난 연습을 마치며 "다음 촬영에서 해볼 한 가지"로 남긴
            문장이다. 이것을 잠금 화면에 뜰 한국어 한 문장으로 줄인다.
            - 40자 이내, 한 문장, 줄바꿈 없음.
            - 배우가 할 행동 하나만 남긴다.
            - 상대 인물의 이름이나 관계(아빠, 엄마, 후임, 선생님, 극 중 이름 등)는 "상대"로 바꾼다.
            - 대사 인용, 작품 이름, 따옴표는 넣지 않는다.
            - "~해 봐요"처럼 부드럽게 권하고, "한 번 더"처럼 오늘 다시 찍어 보게 한다.
            - 칭찬, 홍보, 이모지, 느낌표를 쓰지 않는다.
            - 입력이 해볼 행동이 아니라 관찰이나 평가라면 SKIP 한 단어만 쓴다.
            예)
            입력: 처음부터 끝까지 상대가 내 말에 흔들리는지 확인하며 따져 봐도 좋아요.
            출력: 상대가 흔들리는지 보면서 한 번 더 찍어 봐요.
            입력: 렌즈를 아빠 얼굴로 두고, 반응을 보며 따져 봐도 좋아요
            출력: 렌즈를 상대 얼굴로 두고, 반응 보며 한 번 더 해 봐요.
            입력: 후임이 갈구는 걸 멈추는지 보면서 "적당히 좀 해라"로 눌러요.
            출력: 상대가 멈추는지 보면서 한 번 더 눌러 봐요.
            입력: 친구의 축하를 확인하려 하는 것과 실망하는 모습이 잘 보여요.
            출력: SKIP
            """;

    static final String EN_INSTRUCTIONS = """
            You write the body of an evening reminder for an acting practice app. The input is the "one thing to try on
            the next take" the actor kept after their last practice (it may be in Korean). Rewrite it as one short English
            sentence for a phone lock screen.
            - At most 70 characters, one sentence, no line breaks.
            - Keep only the one action the actor will try.
            - Replace character names or relations with "your partner".
            - No quoted lines, play titles or quotation marks.
            - Invite gently and suggest one more take today.
            - No praise, promotion, emoji or exclamation marks.
            - If the input is an observation or judgement rather than an action, output only the word SKIP.
            Example
            Input: Olivia, next take, on "just killed myself", try dropping the smile completely and holding your gaze steady on the partner.
            Output: Drop the smile and hold your gaze on your partner. One more take?
            """;

    private final TextGenerator generator;
    private final LlmTelemetry telemetry;

    public ReminderLineWriter(TextGenerator generator, LlmTelemetry telemetry) {
        this.generator = generator;
        this.telemetry = telemetry;
    }

    /**
     * @param practiceId 노트가 나온 회차. 관측 기록을 묶는 열쇠다
     * @return 쓸 수 있는 한 줄. 모델이 SKIP 이라 했거나, 실패했거나, 검사를 못 넘으면 빈 값
     */
    public Optional<String> write(UUID userId, UUID practiceId, String nextTake, boolean korean) {
        if (nextTake == null || nextTake.isBlank()) return Optional.empty();
        String instructions = korean ? KO_INSTRUCTIONS : EN_INSTRUCTIONS;
        Instant startedAt = Instant.now();
        GeneratedText generated;
        try {
            generated = generator.generate(instructions, nextTake.strip(), OPTIONS);
        } catch (RuntimeException failure) {
            telemetry.record(call(userId, practiceId, instructions, nextTake, "", null, startedAt,
                    failure.getClass().getSimpleName(), korean, false));
            return Optional.empty();
        }
        Optional<String> line = accept(generated.text(), korean);
        telemetry.record(call(userId, practiceId, instructions, nextTake, generated.text(), generated, startedAt,
                null, korean, line.isPresent()));
        return line;
    }

    /** 모델 출력을 잠금 화면에 띄워도 되는지 본다. 되면 다듬은 한 줄을 돌려준다. */
    static Optional<String> accept(String raw, boolean korean) {
        if (raw == null) return Optional.empty();
        String line = raw.strip();
        if (line.isEmpty() || line.contains("\n") || line.toUpperCase().startsWith(SKIP)) {
            return Optional.empty();
        }
        if (QUOTES.matcher(line).find() || line.contains("!")) return Optional.empty();
        if (line.codePointCount(0, line.length()) > (korean ? KO_LIMIT : EN_LIMIT)) return Optional.empty();
        if (korean != HANGUL.matcher(line).find()) return Optional.empty();
        return Optional.of(line);
    }

    private LlmCall call(UUID userId, UUID practiceId, String instructions, String input, String output,
            GeneratedText generated, Instant startedAt, String error, boolean korean, boolean accepted) {
        LlmTokens tokens = generated == null || generated.usage() == null ? LlmTokens.unknown()
                : LlmTokens.of(generated.usage().prompt(), generated.usage().completion(), generated.usage().total());
        return new LlmCall(LlmStep.REMINDER_LINE, practiceId, userId, generated == null ? "" : generated.model(),
                instructions + "\n\n" + input, output, tokens, startedAt, Duration.between(startedAt, Instant.now()),
                error, LlmCall.metadata("experiment", EveningReminderExperiment.NAME,
                        "language", korean ? "ko" : "en", "accepted", Boolean.toString(accepted)));
    }
}
