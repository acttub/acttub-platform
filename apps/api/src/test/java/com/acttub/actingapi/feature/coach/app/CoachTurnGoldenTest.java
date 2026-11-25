package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;

import com.acttub.actingapi.integration.media.FaceMosaic;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * 코칭 한 차례의 동작 고정 기록(SOMA-1133). 갈래마다 대화를 실제로 몇 차례 돌려 {@link CoachTurnGoldenRig} 가 적은 글을
 * {@code src/test/resources/frozen/coach-turn/<갈래>.txt} 의 커밋된 기록과 바이트까지 견준다. 기록에는 모델로 나간 요청(영상·대화
 * 기록·지시문·생각 단계), 배우에게 간 말, 저장 상태, handoff, 노트, 관측 기록(metadata 키와 값), 실패 보고, 로그 문구가 있다.
 *
 * <p>코치 코드를 동작을 바꾸지 않고 나눌 때 이 시험이 그 증명이다. 하나라도 달라지면 깨진다.
 *
 * <p>동작을 일부러 바꾼 PR 이면 {@code UPDATE_COACH_TURN_GOLDEN=1 ./gradlew test --tests '*CoachTurnGoldenTest*'} 로 다시 뜨고
 * diff 를 눈으로 확인한 뒤 함께 커밋한다. 갱신 모드는 일부러 실패로 끝난다 — 다시 뜬 채로 초록을 받아 들고 가면 검사가 무력해진다
 * ({@code OpenApiSnapshotIT} 와 같은 까닭).
 */
class CoachTurnGoldenTest {
    static final Path FROZEN = Path.of("src/test/resources/frozen/coach-turn");

    static final String OPENING = """
            <설계>
            영상: 연기
            관찰 근거: 영상과 음성
            대사 확인: 확인됨
            확인된 대사: "가지 마", "됐어"
            말 거는 대상: 떠나는 연인
            인물: 혼자 선 척 붙잡히길 바란다
            근본 문제: 2 목적성이 안 보인다
            버릇: 말끝을 길게 끈다
            왜 이 배우의 문제인가: 붙잡는 말이 부탁처럼 들린다
            버릇이 가리는 것: 붙잡고 싶은 마음
            다른 쪽 살아 있는 곳: "됐어"에서 눈을 피한다
            확인할 대사: 가지 마
            이번 목표: 붙잡는 말이 상대에게 가게 한다
            다음 테이크: 반대로: "가지 마"를 짧게 끊어 본다
            첫 질문 모양: 2
            </설계>
            <코치>
            이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?
            </코치>
            <보기>
            붙잡고 싶었어요
            떠나게 두고 싶었어요
            </보기>""";

    static final String ENGLISH_OPENING = """
            <설계>
            영상: 연기
            대사 확인: 확인됨
            인물: wants to be held
            버릇: lets the line trail off
            확인할 대사: don't go
            근본 문제: 2
            </설계>
            <코치>
            What did she want from him in this scene?
            </코치>""";

    static final String SILENT_OPENING = """
            <설계>
            영상: 연기
            관찰 근거: 영상만
            대사 확인: 확인 안 됨
            확인된 대사: 없음
            인물: 떠나는 사람을 붙잡는다
            버릇: 고개를 자주 숙인다
            근본 문제: 1
            </설계>
            <코치>
            이 장면에서 누구한테 말하고 있었어요?
            </코치>""";

    static final String CONTINUED = """
            <설계>
            영상: 연기
            인물: 혼자 선 척 붙잡히길 바란다
            버릇: 말끝을 길게 끈다
            첫 질문 모양: 이어서
            </설계>
            <코치>
            지난번엔 끝을 늦춰 보기로 했죠. 이번엔 어땠어요?
            </코치>""";

    static final String PROFILE = "[길이] 100\n[이 배우에게 맞춘 코칭]\n이 배우는 이유를 함께 들을 때 납득했다.\n- 배우가 \"왜요?\"라고 물으면 이유부터 답한다.";

    static final String STUCK_OPENING = """
            <설계>
            영상: 연기
            관찰 근거: 화면·음성
            대사 확인: 확인됨
            확인된 대사: "가르쳐 줘"
            대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"
            장면: 헤어지자는 말을 들은 밤 | 헬레네 | 상대
            버릇: "취소해"에서 화내는 사람처럼 들려요
            확인할 대사: 취소해
            다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
            </설계>
            <코치>
            어떤 게 막혔어요?
            </코치>
            <보기>
            감정이 안 따라와요
            대사가 입에 안 붙어요
            뭘 원하는지 모르겠어요
            </보기>""";

    static final String EVALUATE_OPENING = """
            <설계>
            영상: 연기
            관찰 근거: 화면·음성
            대사 확인: 확인됨
            대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"
            장면: 이별 직후 | 헬레네 | 연인
            버릇: "취소해"에서 화내는 사람처럼 들려요
            </설계>
            <코치>
            "가르쳐 줘"까지는 붙잡는 게 보였어요.
            끝에서 화내는 쪽으로 가요.
            </코치>
            <카드>
            잘 된 곳: 0:03 "가르쳐 줘"에서 붙잡는 마음이 보여요
            아쉬운 곳: 0:12 "취소해"에서 화내는 쪽으로 들려요
            다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
            </카드>""";

    static final String CHARACTER_OPENING = """
            <설계>
            영상: 연기
            대사 확인: 확인됨
            대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"
            대본 단서: "가르쳐 줘"
            테이크 속 인물: 화를 참는 사람
            다른 가능성: 매달리는 사람
            </설계>
            <코치>
            이 인물은 어떤 사람으로 봤어요?
            </코치>
            <보기>
            화를 참는 사람이요
            매달리는 사람이요
            </보기>
            <장면>
            헤어지자는 말을 들은 밤 | 헬레네 | 연인
            </장면>""";

    static final String TALK_OPENING = """
            <설계>
            입력: 영상 없음 (말로 하는 코칭)
            장면: 없음
            </설계>
            <코치>
            어떤 게 막혔어요?
            </코치>
            <보기>
            감정이 안 따라와요
            대사가 입에 안 붙어요
            </보기>""";

    static final String READING_MATERIAL = """
            [리딩 녹음]
            [대본]
            1. 민수(내 대사, 녹음 1): 가지 마, 제발.
            2. 지혜(상대 대사): 이미 늦었어.
            [소리 안 줄별 시간] 내 대사 녹음을 대본 순서대로 이었다.
            - 녹음 1: 0:00~0:02 "가지 마, 제발."
            [서버가 잰 소리]
            - 녹음 1: 다른 대사들보다 빨라요 (rate)
            """;

    static final String READING_OPENING = """
            <설계>
            입력: 리딩 녹음 (음성만)
            고른 소리: 녹음 1 빨라요
            </설계>
            <코치>
            "가지 마"는 다른 대사들보다 빨라요. 이 말을 할 때 민수는 지혜한테서 무슨 말을 듣고 싶었어요?
            </코치>
            <보기>
            남아 줄게
            미안해
            </보기>""";

    static String signals(String... ids) {
        return "{\"signals\":[" + String.join(",", Stream.of(ids).map(id -> "\"" + id + "\"").toList()) + "]}";
    }

    static Map<String, Consumer<CoachTurnGoldenRig>> scenarios() {
        var all = new java.util.LinkedHashMap<String, Consumer<CoachTurnGoldenRig>>();
        all.put("practice-loop-steps", CoachTurnGoldenTest::practiceLoopSteps);
        all.put("practice-loop-answers", CoachTurnGoldenTest::practiceLoopAnswers);
        all.put("practice-loop-stream", CoachTurnGoldenTest::practiceLoopStream);
        all.put("practice-loop-english", CoachTurnGoldenTest::practiceLoopEnglish);
        all.put("practice-loop-rewrites", CoachTurnGoldenTest::practiceLoopRewrites);
        all.put("practice-loop-compared-model", CoachTurnGoldenTest::comparedModel);
        all.put("practice-loop-continued-take", CoachTurnGoldenTest::continuedTake);
        all.put("practice-loop-cuts", CoachTurnGoldenTest::cuts);
        all.put("practice-loop-no-audio-track", CoachTurnGoldenTest::noAudioTrack);
        all.put("practice-loop-face-mosaic", CoachTurnGoldenTest::faceMosaic);
        all.put("practice-loop-persona-and-profile", CoachTurnGoldenTest::personaAndProfile);
        all.put("practice-loop-already-arm", CoachTurnGoldenTest::alreadyArm);
        all.put("practice-loop-evidence-arm", CoachTurnGoldenTest::evidenceArm);
        all.put("practice-loop-cost-switches", CoachTurnGoldenTest::costSwitches);
        all.put("practice-loop-video-budget", CoachTurnGoldenTest::videoBudget);
        all.put("practice-loop-pro-actor", CoachTurnGoldenTest::proActor);
        all.put("practice-loop-layer-one", CoachTurnGoldenTest::layerOne);
        all.put("practice-loop-resumed", CoachTurnGoldenTest::practiceLoopResumed);
        all.put("practice-loop-classifier-model", CoachTurnGoldenTest::classifierModel);
        all.put("reply-limits", CoachTurnGoldenTest::replyLimits);
        all.put("free-reply-limit", CoachTurnGoldenTest::freeReplyLimit);
        all.put("purpose-evaluate", CoachTurnGoldenTest::purposeEvaluate);
        all.put("purpose-stuck", CoachTurnGoldenTest::purposeStuck);
        all.put("purpose-character", CoachTurnGoldenTest::purposeCharacter);
        all.put("talk-stuck", CoachTurnGoldenTest::talkStuck);
        all.put("talk-character-and-concern", CoachTurnGoldenTest::talkCharacterAndConcern);
        all.put("reading-voice", CoachTurnGoldenTest::readingVoice);
        all.put("before-practice-loop", CoachTurnGoldenTest::beforePracticeLoop);
        return all;
    }

    @TestFactory
    Stream<DynamicTest> everyBranchSendsAndKeepsTheSameThing() {
        return scenarios().entrySet().stream().map(entry -> DynamicTest.dynamicTest(entry.getKey(), () -> check(entry.getKey(),
                entry.getValue())));
    }

    static void check(String name, Consumer<CoachTurnGoldenRig> scenario) throws IOException {
        var rig = new CoachTurnGoldenRig();
        try {
            scenario.accept(rig);
        } finally {
            rig.close();
        }
        assertThat(rig.leftovers()).as("정해 둔 답이 남았다 — 시나리오가 의도한 갈래를 타지 않았다").isEmpty();
        String actual = rig.out.toString();
        Path frozen = FROZEN.resolve(name + ".txt");
        if ("1".equals(System.getenv("UPDATE_COACH_TURN_GOLDEN"))) {
            Files.createDirectories(FROZEN);
            Files.writeString(frozen, actual, StandardCharsets.UTF_8);
            fail("기록을 다시 떴다 (%s). diff 를 확인하고 커밋한 뒤 이 변수 없이 다시 돌려라.", frozen.toAbsolutePath());
        }
        assertThat(frozen).as("기록이 없다. UPDATE_COACH_TURN_GOLDEN=1 로 먼저 뜬다").exists();
        assertThat(actual).as("코치 한 차례의 요청·응답·상태가 %s 와 달라졌다", frozen)
                .isEqualTo(Files.readString(frozen, StandardCharsets.UTF_8));
    }

    // ---- 연습 루프 ----

    /** 단계 질문을 따라 정리까지 가고, 맞장구에 코치 AI 없이 닫히며 노트가 남는다. 정정에는 영상 없이 내려놓는다. */
    static void practiceLoopSteps(CoachTurnGoldenRig rig) {
        rig.model.says(OPENING.replace("<코치>\n이 장면에서 인물은 상대한테서", "<코치>\n안녕하세요, 잘 봤어요.\n이 장면에서 [인물]은 [상대]한테서"),
                "붙잡고 싶었어요, 떠나지 말라고 하고 싶었군요. \"가지 마\"에서 말끝이 길어서 부탁처럼 들려요. 붙잡는 말로 들렸을까요? 아니면 다르게 들렸을까요?",
                "붙잡는 말이면 끝을 짧게 끊을 것 같아요. 그런 쪽이었어요?",
                "\"가지 마\" 끝이 길게 늘어져서 붙잡는 말보다 부탁하는 말처럼 들렸어요. 그래서 상대가 떠나도 괜찮다는 쪽으로도 들려요.",
                "그 장면에서는 뭘 하려고 했어요?",
                "그럼 다음엔 그 사람한테 뭘 해 볼래요?",
                "<다음 테이크>\"가지 마\"를 짧게 끊어 붙잡아 봐도 좋아요</다음 테이크>\n맞아요, 그거예요. \"가지 마\"를 짧게 끊어 붙잡아 봐도 좋아요. 어때요?");
        rig.model.classifies(signals("answered"), signals("not_yet"), signals("not_yet", "why"),
                signals("not_yet", "correction", "line_fix"), signals("answered", "want"), signals("answered", "decided"),
                signals("answered", "ack"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("헤어지자는 말을 들은 밤", 8000, "끝이 자꾸 늘어져요", null), null).session();
        s = rig.turn(s, "붙잡고 싶었어요 떠나지 말라고 하고 싶었어요").session();
        s = rig.turn(s, "몰라").session();
        s = rig.turn(s, "왜 그렇게 봤어요?").session();
        s = rig.turn(s, "그건 다른 장면이에요").session();
        s = rig.turn(s, "그냥 붙잡고 싶었어요 떠나지 말라고").session();
        s = rig.turn(s, "말을 짧게 끊어서 붙잡아 볼게요").session();
        rig.turn(s, "네 해볼게요");
    }

    /** 반박·평가 요청·다른 피드백 요청(같은 단계에 머묾)·방법 요청·그만. */
    static void practiceLoopAnswers(CoachTurnGoldenRig rig) {
        rig.model.says(OPENING,
                "맞아요. \"됐어\"에서 눈을 피하는 게 좋아요. 그 순간을 어디서 더 써 볼래요?",
                "조금 아쉬워요. [인물]이 [상대]를 붙잡는 게 안 보여요. 다음엔 짧게 끊어 봐도 좋아요.",
                "\"됐어\"는 좋았어요. 눈을 피하는 게 진짜 같았어요.",
                "\"가지 마\"에서 끝이 길어서 부탁처럼 들려요. 붙잡는 말로 들렸을까요?",
                "<다음 테이크>\"가지 마\"를 짧게 끊어 봐도 좋아요</다음 테이크>\n맞아요, 그거예요. \"가지 마\"를 짧게 끊어 봐도 좋아요.");
        rig.model.classifies(signals("not_yet", "pushback"), signals("not_yet", "evaluation"), signals("not_yet", "evaluation"),
                signals("not_yet", "method"), signals("not_yet", "method"), signals("stop"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        s = rig.turn(s, "너 내 말 안 듣잖아").session();
        s = rig.turn(s, "연기력은 어때?").session();
        s = rig.turn(s, "다른 피드백은?").session();
        s = rig.turn(s, "그래서 어떻게 해요?").session();
        s = rig.turn(s, "그러니까 어떻게 하면 돼요?").session();
        rig.turn(s, "오늘은 그만할래요");
    }

    /** 스트리밍: 보이는 글만 흘린다. 빈 답·깨진 글은 다시 쓴다. */
    static void practiceLoopStream(CoachTurnGoldenRig rig) {
        rig.model.says(OPENING, null, "\"가지 마\"에서 끝이 길어요.\n붙잡는 말로 들렸을까요?",
                "<div class=\"x\">깨진 출력</div>\n<script>", "누구한테 하는 말이었어요?");
        rig.model.classifies(signals("answered"), signals("answered"));
        var s = rig.streamed(CoachTurnGoldenRig.fresh(), null).session();
        s = rig.streamed(s, "붙잡고 싶었어요").session();
        rig.streamed(s, "상대가 떠나려고 해서요");
    }

    static void practiceLoopEnglish(CoachTurnGoldenRig rig) {
        rig.model.says(ENGLISH_OPENING, "You let \"don't go\" trail off. Did it sound like holding on?");
        rig.model.classifies(signals("answered"), signals("stop"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("In a garden with my crush", 8000, null, null), null).session();
        s = rig.turn(s, "I wanted her to stay with me").session();
        rig.turn(s, "Okay that is enough practice for me today");
    }

    /** 같은 둘째 차례에서 빈 답·깨진 글·영상 시간·비유·반복 질문·긴 말·모델 오류를 하나씩. */
    static void practiceLoopRewrites(CoachTurnGoldenRig rig) {
        rig.model.says(OPENING);
        var opened = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        rig.section("빈 답 두 번 뒤 생각 최소로 한 번 더");
        rig.model.classifies(signals("answered")).says(null, "<생각>\n배우가 한 말: 붙잡고\n</생각>").saysLight("\"가지 마\"에서 끝이 길어요. 누구한테 했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("깨진 글");
        rig.model.classifies(signals("answered")).says("<div>깨진 출력</div>\nfunction x() { return 1; }", "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("영상 시간");
        rig.model.classifies(signals("answered")).says("0:23에서 말끝이 길어요. 누구한테 말했어요?", "\"가지 마\"에서 말끝이 길어요. 누구한테 말했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("영상 시간 두 번");
        rig.model.classifies(signals("answered")).says("0:23에서 말끝이 길어요. 누구한테 말했어요?", "0:23 \"가지 마\"에서 말끝이 길어요. 누구한테 말했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("비유 다듬기");
        rig.model.classifies(signals("answered")).says("목소리에 무게가 실려요. 누구한테 말했어요?").saysLight("목소리가 커져요. 누구한테 말했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("앞 질문 되풀이");
        rig.model.classifies(signals("answered")).says("그렇군요. 이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?").saysLight("이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("긴 말 줄이기");
        rig.model.classifies(signals("answered")).says(
                "말끝을 길게 끄는 버릇이 상대를 붙잡는 마음을 가려요. 그래서 붙잡는 말이 부탁처럼 들리고 힘이 빠져요. 어디서 가장 붙잡고 싶었어요?").saysLight("끝이 길어요. 어디서 붙잡고 싶었어요?");
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("모델 오류");
        rig.model.classifies(signals("answered")).says(new IllegalStateException("quota exceeded"));
        rig.turn(opened, "붙잡고 싶었어요");
        rig.section("분류 실패");
        rig.model.classifies("not json").says("누구한테 했어요?");
        rig.turn(opened, "붙잡고 싶었어요");
    }

    /** 비교 모델(b)이 계속 비면 기본 모델이 쓴다. 다음 답도 b 다. */
    static void comparedModel(CoachTurnGoldenRig rig) {
        var compared = rig.model("gemini-3.8-flash", "compared");
        compared.says(null, null, "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?").saysLight((Object) null);
        rig.coach = rig.builder().compared(compared, 100).build();
        rig.model.says(OPENING).classifies(signals("answered"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        rig.turn(s, "붙잡고 싶었어요");
    }

    /**
     * 이어서 찍은 회차: 받아 적기·지난 시도부터 묻는 첫 답을 기본 첫 답과 함께 돌리고, 같은 장면이면 그 답을 쓴다.
     * 다른 장면이면 곁가지 답을 취소하는데, 그 호출이 취소 전에 모델에 닿는지는 스레드 순서에 달려 기록으로 고정할 수 없다. 같은 장면만 적는다.
     */
    static void continuedTake(CoachTurnGoldenRig rig) {
        var prior = new PriorContext(Map.of(), "배우: 끝을 늦춰 볼게\n코치: 좋아요", true, List.of(),
                List.of("1차: 말끝 — 제안: 끝을 늦춘다"), List.of("가지 마, 제발 여기 있어 줘"));
        var session = CoachTurnGoldenRig.fresh("헤어지자는 말을 들은 밤", 8000, "첫 대사는 놀리면서 시작하고 싶었어", null).withPrior(prior);
        String heard = ContinuedTake.heardLinesPrompt();
        String continuation = DirectVideoPrompts.continuation(prior, null);
        rig.model.byInstruction = instruction -> instruction.equals(heard) ? "1. 가지 마, 제발 여기 있어 줘"
                : instruction.endsWith(continuation) ? CONTINUED : OPENING;
        rig.unordered = true;
        var s = rig.turn(session, null).session();
        rig.unordered = false;
        rig.model.byInstruction = null;
        rig.model.says("끝을 늦추니 붙잡는 게 보였어요. 다음엔 뭘 해 볼래요?").classifies(signals("answered"));
        rig.turn(s, "다시 집중됐어요");
    }

    /** 첫 응답 전에 끊는 것: 너무 짧은 영상, 소리 없음, 빈 입력, 검사 실패, 모델이 연기 아님으로 본 것. */
    static void cuts(CoachTurnGoldenRig rig) {
        rig.section("3초 미만");
        rig.turn(CoachTurnGoldenRig.fresh("", 1200, null, null), null);
        rig.section("소리 트랙은 있는데 완전 무음");
        rig.model.inspection = new DirectVideoModel.InputInspection(true, null, false);
        rig.turn(CoachTurnGoldenRig.fresh(), null);
        rig.section("소리 없음과 검은 화면");
        rig.model.inspection = new DirectVideoModel.InputInspection(false, true);
        rig.turn(CoachTurnGoldenRig.fresh(), null);
        rig.section("검사 실패");
        rig.model.inspectFailure = new IllegalStateException("audio signal inspection failed");
        rig.turn(CoachTurnGoldenRig.fresh(), null);
        rig.model.inspectFailure = null;
        rig.section("모델이 연기 아님으로 봄");
        rig.model.inspection = new DirectVideoModel.InputInspection(true, false, true);
        rig.model.says("<설계>\n영상: 연기 아님: 잡담\n</설계>\n<코치>\n좋은 이야기네요?\n</코치>");
        rig.turn(CoachTurnGoldenRig.fresh(), null);
    }

    /** 소리 트랙이 없는 영상: 서버 사실을 앞에 붙이고, 스트리밍을 요청해도 다 쓴 뒤 보낸다. */
    static void noAudioTrack(CoachTurnGoldenRig rig) {
        rig.model.inspection = new DirectVideoModel.InputInspection(false, false);
        rig.model.says(SILENT_OPENING, "고개를 숙이는 게 여러 번 보여요. 그때 누구를 떠올렸어요?").classifies(signals("answered"));
        var s = rig.streamed(CoachTurnGoldenRig.fresh(), null).session();
        rig.streamed(s, "떠나는 사람이요");
    }

    static void faceMosaic(CoachTurnGoldenRig rig) {
        rig.source = new CoachVideoSource.Video("owned/video.mp4", "video/quicktime", "etag", true);
        rig.coach.withFaceMosaic(new FaceMosaic() {
            @Override public boolean available() { return true; }
            @Override public Path render(Path source) throws IOException {
                Path masked = Files.createTempFile("golden-masked-", ".mp4");
                Files.writeString(masked, "masked video bytes");
                return masked;
            }
        });
        rig.model.says(OPENING);
        rig.turn(CoachTurnGoldenRig.fresh(), null);
    }

    /** 자문위원 성격(b1)과, 자문위원 파일이 없는 배우의 맞춤 코칭(단계 지시 바꿔 끼우기·질문 수 상한·길이). */
    static void personaAndProfile(CoachTurnGoldenRig rig) {
        rig.section("자문위원 성격 b1");
        rig.coach = rig.builder().personas(session -> "b1").build();
        rig.model.says(OPENING, "\"가지 마\"에서 끝이 길어요. 그건 어때요?").classifies(signals("answered"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        rig.turn(s, "붙잡고 싶었어요");
        rig.section("맞춤 코칭");
        rig.coach = rig.builder().personas(session -> "").build();
        var prior = new PriorContext(Map.of("coaching_profile", PROFILE, "tone", "짧게 존댓말로 답한다"), null, true, List.of(), List.of());
        rig.model.says(OPENING, "\"가지 마\"에서 붙잡으려는 것처럼 보였어요. 맞아요?",
                "\"소소한 행복\"에서도 상대 마음을 떠보는 말로 안 들려요.\n오래된 연인이라도 이 말은 마음을 묻는 말이라서요.\n그럼 상대가 대답해 줬을까요?").classifies(signals("not_yet"), signals("answered"));
        s = rig.turn(CoachTurnGoldenRig.fresh().withPrior(prior), null).session();
        s = rig.turn(s.withPrior(prior), "몰라").session();
        rig.turn(s.withPrior(prior), "같이 즐기고 싶었어요");
    }

    /** "이미 그렇게 했다" 비교의 실험 쪽: 한 일 묻기(영상 없음) → 다르게 정리 → 닫기. */
    static void alreadyArm(CoachTurnGoldenRig rig) {
        rig.coach.withAlreadyShare(100);
        rig.model.says(OPENING, "그 대사에서 실제로 어떻게 했어요?",
                "<다음 테이크>\"됐어\"에서 상대를 똑바로 봐도 좋아요</다음 테이크>\n이미 끝을 짧게 했군요. \"가지 마\"는 아직 덜 들렸어요. 이번엔 \"됐어\"에서 상대를 똑바로 보며 말해 봐도 좋아요.");
        rig.model.classifies(signals("answered", "already"), signals("answered"), signals("answered", "ack"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        s = rig.turn(s, "이미 그렇게 했어요").session();
        s = rig.turn(s, "말끝을 짧게 했어요").session();
        rig.turn(s, "네");
    }

    /** 근거·방법 비교의 실험 쪽: 2단계에서 방법을 물으면 방법부터 답한다. 정리는 길게 둔다. */
    static void evidenceArm(CoachTurnGoldenRig rig) {
        rig.coach.withEvidenceShare(100);
        rig.model.says(OPENING,
                "예를 들면 \"가지 마\" 끝에서 숨을 끊고 상대를 보는 식이에요.",
                "\"가지 마\"에서 끝이 길어서 부탁처럼 들려요. 붙잡는 말로 들렸을까요?",
                "그럼 다음엔 그 사람한테 뭘 해 볼래요?",
                "<다음 테이크>\"가지 마\"를 짧게 끊고 상대를 봐도 좋아요</다음 테이크>\n\"가지 마\"를 짧게 끊고 상대를 봐도 좋아요. 끊는 순간 상대 눈을 보면 붙잡는 게 보여요. 다음 테이크에서 \"가지 마\"를 들어 봐요.");
        rig.model.classifies(signals("not_yet", "method"), signals("answered"), signals("answered"), signals("answered", "decided"),
                signals("answered", "ack"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        s = rig.turn(s, "그래서 어떻게 해요?").session();
        s = rig.turn(s, "붙잡고 싶었어요").session();
        s = rig.turn(s, "아니요 부탁처럼 들렸어요").session();
        s = rig.turn(s, "짧게 끊고 상대를 볼게요").session();
        rig.turn(s, "네 고마워요");
    }

    /** 고정 앞부분·공통 지시 옮기기·무료 배우 후속 답 영상 빼기(대화 안 영상 다시 쓰기와 함께). */
    static void costSwitches(CoachTurnGoldenRig rig) {
        var cache = new CoachVideoCache(rig.model, Duration.ofMinutes(10), new MutableClock(Instant.parse("2026-11-24T00:00:00Z")),
                rig.failures);
        try {
            rig.coach = rig.builder().cache(cache).build().withStablePrefix(true).withStaticRulesInPrefix(true).withFreeVideoFirstOnly(true);
            rig.model.says(OPENING, "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?", "그 사람이 떠나면 어때요?").classifies(signals("answered"), signals("answered"));
            var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
            s = rig.turn(s, "붙잡고 싶었어요").session();
            rig.turn(s, "떠나는 연인한테요");
        } finally {
            cache.close();
        }
    }

    /** 회차 영상 예산을 넘긴 뒤 답은 영상 없이 쓴다. */
    static void videoBudget(CoachTurnGoldenRig rig) {
        var cache = new CoachVideoCache(rig.model, Duration.ofMinutes(10), new MutableClock(Instant.parse("2026-11-24T00:00:00Z")),
                rig.failures);
        try {
            rig.coach = rig.builder().cache(cache).build().withVideoTokenBudget(800);
            rig.model.says(OPENING, "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?").classifies(signals("answered"));
            var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
            rig.turn(s, "붙잡고 싶었어요");
        } finally {
            cache.close();
        }
    }

    /** Pro 배우: 비교 모델(Pro 전용), 지난 연습 기억 칸, 이름표 단 영상을 다음 답에서 다시 쓴다. */
    static void proActor(CoachTurnGoldenRig rig) {
        var cache = new CoachVideoCache(rig.model, Duration.ofMinutes(10), new MutableClock(Instant.parse("2026-11-24T00:00:00Z")),
                rig.failures, "golden", Duration.ZERO);
        var compared = rig.model("gemini-3.8-flash", "compared");
        compared.says(OPENING, "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?");
        try {
            var past = new CoachProMemory.Past(Instant.parse("2026-11-20T03:00:00Z"), "이별 장면", "말끝이 길다",
                    "끝을 짧게 끊는다", List.of(), "helpful");
            rig.coach = rig.builder().compared(compared, 100).cache(cache).build()
                    .withProMemory(userId -> true, (userId, practiceId, limit) -> List.of(past))
                    .withAlternateProOnly(true);
            rig.model.classifies(signals("answered"));
            var prior = new PriorContext(Map.of("goal", "오디션 합격", "avoid", "- 말끝: 배우가 아니라고 함\n- 시선: 지난번 정정"), null, true,
                    List.of("끝을 짧게 끊어 본다"), List.of());
            var profile = new ActorProfile("김배우", "여성", 27, List.of("드라마"), "1년", "오디션 합격");
            var s = rig.turn(CoachTurnGoldenRig.fresh().withPrior(prior).withActorProfile(profile), null).session();
            rig.turn(s.withPrior(prior).withActorProfile(profile), "김배우인 저는 붙잡고 싶었어요");
        } finally {
            cache.close();
        }
    }

    /** 1층 관찰: 아직 안 끝났으면 기다림 칸, 상태에 관찰이 있으면 그 칸을 붙인다. */
    static void layerOne(CoachTurnGoldenRig rig) {
        try (var layer = new CoachLayerOne((video, mime, scene, practice, user) -> "", 100, rig.failures, CoachPro.NONE)) {
            rig.coach = rig.builder().layerOne(layer).build();
            rig.model.says(OPENING, "\"가지 마\"에서 고개를 숙여요. 누구한테 했어요?").classifies(signals("answered"));
            var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
            s = CoachTurnGoldenRig.editState(s, state -> {
                ((tools.jackson.databind.node.ObjectNode) state.path(DirectVideoCoach.LAYER1))
                        .put("block", "## 1층 관찰\n- \"가지 마\"에서 고개를 숙인다");
                return state;
            });
            rig.turn(s, "붙잡고 싶었어요");
        }
    }

    /** 닫힌 연습 루프 대화를 다시 연 뒤: 묻는 말에는 답하고, 맞장구면 다시 닫는다. */
    static void practiceLoopResumed(CoachTurnGoldenRig rig) {
        rig.model.says(OPENING, "\"가지 마\"에서 끝이 길어요. 붙잡는 말로 들렸을까요?", "\"됐어\"에서 눈을 피하는 게 좋았어요.");
        rig.model.classifies(signals("answered"), signals("stop"), signals("not_yet", "evaluation"), signals("answered", "ack"));
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        s = rig.turn(s, "붙잡고 싶었어요").session();
        s = rig.turn(s, "그만할게요").session();
        int replies = (int) s.turns().stream().filter(turn -> "ai".equals(turn.role())).count();
        var reopened = CoachTurnGoldenRig.editState(s, state -> {
            ((tools.jackson.databind.node.ObjectNode) state.path(DirectVideoPracticeLoop.STATE_KEY))
                    .put(PracticeLoopRouter.RESUMED_AT, replies);
            return state;
        });
        reopened = reopened.withCoachingState(reopened.experienceVersion(), reopened.stateRevision(), reopened.coachingState(), "open", "");
        s = rig.turn(reopened, "근데 표정은 어땠어요?").session();
        rig.turn(s, "네 알겠어요");
    }

    /** 분류 모델을 따로 두고 마지막 두 메시지만 보낸다. */
    static void classifierModel(CoachTurnGoldenRig rig) {
        var classifier = rig.model("gemini-flash-lite", "classifier");
        classifier.classifies(signals("answered"));
        rig.coach.withClassifier(classifier, 2);
        rig.model.says(OPENING, "\"가지 마\"에서 끝이 길어요. 누구한테 했어요?");
        var s = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        rig.turn(s, "붙잡고 싶었어요");
    }

    /** 응답 상한: 연습 루프는 24번째 응답을 코치 AI 없이 닫고, 목적별 코칭은 9번째 응답이 정리다. */
    static void replyLimits(CoachTurnGoldenRig rig) {
        rig.section("연습 루프 23번 뒤");
        rig.model.classifies(signals("answered"));
        rig.turn(loopedAfter(23), "배우 말 23");
        rig.section("목적별 코칭 8번 뒤");
        rig.model.says(STUCK_OPENING);
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 8000, null, "stuck"), null).session();
        rig.model.says("<다음 테이크>\"취소해\"를 붙잡듯 말해 봐도 좋아요</다음 테이크>\n\"취소해\"를 붙잡듯 말해 봐도 좋아요.")
                .classifies(signals("answered"));
        rig.turn(purposeAfter(s, 8), "그건 잘 모르겠어요 그냥 해볼게요");
    }

    /**
     * 무료 코칭 답 상한(SOMA-1131, 배우 답 7번): 연습 루프는 상한을 채우는 응답에서 코치 AI 가 정리하며 닫고, 그 앞 응답도 정리다.
     * 목적별 코칭은 상한을 채우는 응답이 정리다. 첫 응답에는 걸지 않는다.
     */
    static void freeReplyLimit(CoachTurnGoldenRig rig) {
        rig.coach.withFreeReplies(userId -> 7);
        rig.section("첫 응답");
        rig.model.says(OPENING);
        rig.turn(CoachTurnGoldenRig.fresh(), null);
        rig.section("연습 루프 배우 답 6번째");
        rig.model.classifies(signals("answered")).says(
                "<다음 테이크>\"가지 마\"를 짧게 끊어 봐도 좋아요</다음 테이크>\n\"가지 마\"를 짧게 끊어 봐도 좋아요.");
        rig.turn(loopedAfter(6), "배우 말 6");
        rig.section("연습 루프 배우 답 7번째");
        rig.model.classifies(signals("answered")).says(
                "<다음 테이크>\"가지 마\"를 짧게 끊어 봐도 좋아요</다음 테이크>\n오늘 말한 마음 그대로예요. \"가지 마\"를 짧게 끊어 봐도 좋아요.");
        rig.turn(loopedAfter(7), "배우 말 7");
        rig.section("연습 루프 배우 답 6번째에 정리한 뒤 7번째");
        // 6번째 답에서 정리했으면 7번째(마지막) 응답은 정리를 되풀이하지 않고 받아 주고 닫는다. 정리에서 쓴 인정 말로 시작하면 뗀다.
        var wrapped = loopedAfter(7);
        var turns = new java.util.ArrayList<>(wrapped.turns());
        turns.set(turns.size() - 1, new com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot("ai",
                "맞아요, 그거예요. \"가지 마\"를 짧게 끊어 봐도 좋아요."));
        wrapped = CoachTurnGoldenRig.editState(wrapped.withTurns(turns), state -> {
            ((tools.jackson.databind.node.ArrayNode) state.path(DirectVideoPracticeLoop.STATE_KEY).path("statuses"))
                    .set(6, tools.jackson.databind.node.StringNode.valueOf("배우의 말: 답\n할 일: 정리하기\n다음 테이크: \"가지 마\"를 짧게 끊어 봐도 좋아요\n단계: 4"));
            return state;
        });
        rig.model.classifies(signals("answered")).says("맞아요, 그거예요. 오늘 말한 마음 그대로 다음 테이크에서 확인해 봐요.");
        rig.turn(wrapped, "네 짧게 끊어 볼게요");
        rig.section("연습 루프 배우 답 7번째에 그만");
        rig.model.classifies(signals("stop"));
        rig.turn(loopedAfter(7), "그만할래요");
        rig.section("목적별 코칭 배우 답 7번째");
        rig.model.says(STUCK_OPENING);
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 8000, null, "stuck"), null).session();
        rig.model.says("<다음 테이크>\"취소해\"를 붙잡듯 말해 봐도 좋아요</다음 테이크>\n\"취소해\"를 붙잡듯 말해 봐도 좋아요.")
                .classifies(signals("answered"));
        rig.turn(purposeAfter(s, 7), "그건 잘 모르겠어요 그냥 해볼게요");
    }

    /** 코치 응답 {@code coachTurns}개와 그 사이 배우 말이 오간 연습 루프 대화. 다음은 배우 말 차례다. */
    static CoachSessionSnapshot loopedAfter(int coachTurns) {
        var turns = new java.util.ArrayList<com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot>();
        long revision = coachTurns * 2L - 1;
        var state = CoachingStateReducer.empty().put("revision", revision);
        var loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", "버릇: 말끝을 길게 끈다\n확인할 대사: 가지 마")
                .put("flow", "a").put("coach_model", "a");
        var statuses = loop.putArray("statuses");
        for (int i = 0; i < coachTurns; i++) {
            turns.add(new com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot("ai", "코치 말 " + (i + 1)));
            if (i < coachTurns - 1) turns.add(new com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot("actor", "배우 말 " + (i + 1)));
            statuses.add(i == 0 ? "" : "배우의 말: 답\n할 일: 답하기\n단계: 3");
        }
        return new CoachSessionSnapshot(CoachTurnGoldenRig.SESSION, CoachTurnGoldenRig.PRACTICE, CoachTurnGoldenRig.USER,
                com.acttub.actingapi.integration.llm.StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null,
                "open", "", turns, PriorContext.EMPTY, "three_layers_v1", revision, state, null, null);
    }

    /** 목적별 코칭 첫 응답 뒤 배우 말·코치 말을 더해 코치 응답을 {@code coachTurns}개로 만든다. */
    static CoachSessionSnapshot purposeAfter(CoachSessionSnapshot opened, int coachTurns) {
        var many = new java.util.ArrayList<>(opened.turns());
        for (int i = 1; i < coachTurns; i++) {
            many.add(new com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot("actor", "배우 말 " + i));
            many.add(new com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot("ai", "코치 말 " + (i + 1)));
        }
        return opened.withTurns(many);
    }

    // ---- 목적별 코칭 ----

    static void purposeEvaluate(CoachTurnGoldenRig rig) {
        rig.model.says(EVALUATE_OPENING,
                """
                "가지 마"에서도 붙잡는 게 보였어요.
                <카드>
                잘 된 곳: 0:03 "가르쳐 줘"에서 붙잡는 마음이 보여요
                아쉬운 곳: 0:08 "가지 마"에서 끝이 흐려져요
                다음 테이크: "가지 마"를 또렷하게 끝내 봐도 좋아요
                </카드>""",
                """
                어떻게 고쳐 볼지 골라 봐요.
                <보기>
                - 0:12 상대를 붙잡듯 말하기
                - 끝을 짧게 끊기
                </보기>""",
                """
                <다음 테이크>"취소해"에서 상대를 붙잡듯 말해 봐도 좋아요</다음 테이크>
                "취소해"에서 상대를 붙잡듯 말해 봐도 좋아요. 그러면 화보다 매달림이 보여요. 어때요?
                <카드>
                잘 된 곳: 0:03 "가르쳐 줘"에서 붙잡는 마음이 보여요
                아쉬운 곳: 0:12 "취소해"에서 화내는 쪽으로 들려요
                다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
                </카드>""");
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 8000, null, "evaluate"), null).session();
        s = rig.turn(s, PurposeLoop.ANOTHER).session();
        s = rig.turn(s, PurposeLoop.FIX_TOGETHER).session();
        rig.turn(s, "0:12 상대를 붙잡듯 말하기");
    }

    /** 첫 응답 뒤 갈래마다: 대사를 짚은 답(어느 대사 건너뜀)과 물음, 버튼, 모르겠다, 방법 요청, 그만. */
    static void purposeStuck(CoachTurnGoldenRig rig) {
        rig.model.says(STUCK_OPENING);
        var opened = rig.turn(CoachTurnGoldenRig.fresh("", 8000, null, "stuck"), null).session();
        rig.section("대사를 짚은 답, 그다음 물음");
        rig.model.says("\"취소해\"에서 자꾸 화내는 것처럼 되는군요. 그 대사에서 목소리가 커지고 끝이 높아져서 화난 사람처럼 들려요. 그때 상대 얼굴을 봤어요?\n<보기>\n상대 얼굴이요\n바닥이요\n</보기>",
                "<다음 테이크>\"취소해\"를 붙잡듯 낮게 말해 봐도 좋아요</다음 테이크>\n커지는 건 화가 나서라기보다 매달려서일 수 있어요. \"취소해\"를 붙잡듯 낮게 말해 봐도 좋아요.");
        rig.model.classifies(signals("answered"), signals("not_yet", "question"));
        var s = rig.turn(opened, "감정이 안 따라와요 \"취소해\"에서 자꾸 화내는 것처럼 돼요").session();
        rig.turn(s, "왜요? 무슨 뜻이에요?");
        rig.section("버튼");
        rig.model.says("어느 대사에서 그랬어요? 앞쪽이었어요?\n<보기>\n0:12 취소해\n0:03 가르쳐 줘\n</보기>");
        rig.turn(opened, "감정이 안 따라와요");
        rig.section("모르겠다");
        rig.model.says("저는 \"취소해\"에서 막힌 것 같아요. 맞아요?\n<보기>\n맞아요\n</보기>");
        rig.turn(opened, "잘 모르겠어요");
        rig.section("방법 요청");
        rig.model.says("<다음 테이크>\"취소해\"를 붙잡듯 낮게 말해 봐도 좋아요</다음 테이크>\n\"취소해\"를 붙잡듯 낮게 말해 봐도 좋아요.")
                .classifies(signals("not_yet", "method"));
        rig.turn(opened, "그래서 어떻게 해요?");
        rig.section("그만");
        rig.turn(opened, "그만");
    }

    static void purposeCharacter(CoachTurnGoldenRig rig) {
        rig.model.says(CHARACTER_OPENING,
                "화를 참는 사람이군요. 이 사람은 그 전에 무슨 일이 있었을까요?\n<보기>\n헤어지자는 말을 들었어요\n</보기>\n<인물 카드>\n누구: 화를 참는 사람 (내 말)\n</인물 카드>",
                "그래서 끝까지 참는군요. 이 사람이 바라는 건 뭘까요?\n<인물 카드>\n누구: 화를 참는 사람 (내 말)\n직전 상황: 헤어지자는 말을 들었다 (내 말)\n</인물 카드>",
                "\"가르쳐 줘\"는 매달리는 말로도 들려요. 화를 참으면서도 붙잡고 싶은 사람이라 더 입체적이에요.\n<인물 카드>\n누구: 화를 참는 사람 (내 말)\n직전 상황: 헤어지자는 말을 들었다 (내 말)\n바라는 것: 붙잡히기 (같이 찾음)\n관계: 연인 (영상)\n막는 것: 자존심 (영상)\n</인물 카드>\n<다음 테이크>\"가르쳐 줘\"를 매달리듯 말해 봐도 좋아요</다음 테이크>");
        rig.model.classifies(signals("answered"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 8000, null, "character"), null).session();
        s = rig.turn(s, "화를 참는 사람이요").session();
        s = rig.turn(s, "헤어지자는 말을 들었어요").session();
        rig.turn(s, "붙잡히고 싶었던 것 같아요");
    }

    /** 영상 없이 말로: 따온 대사로 방법까지 건너뛰고, 방법을 달라 하면 정해 주며 정리한다. 다시 연 뒤 물음에는 답만 한다. */
    static void talkStuck(CoachTurnGoldenRig rig) {
        rig.model.says(TALK_OPENING,
                "\"가지 마\"가 입에 안 붙는군요. 어떻게 해 볼까요?\n<보기>\n- 상대를 붙잡듯 말하기\n- 끝을 짧게 끊기\n</보기>",
                "<다음 테이크>\"가지 마\"를 붙잡듯 말해 봐도 좋아요</다음 테이크>\n\"가지 마\"를 붙잡듯 말해 봐도 좋아요. \"사랑해\"라고 덧붙여도 좋아요. 그러면 훨씬 잘 느껴질 거예요.",
                "\"사랑해\"라고 읽어 보면 돼요. 소리 내어 읽으면 입에 붙어요. 그러면 훨씬 자연스러워질 거예요. 다시 해 볼까요?");
        rig.model.classifies(signals("answered"), signals("not_yet", "method"), signals("not_yet", "question"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 0, null, PurposeLoop.TALK_PREFIX + "stuck"), null).session();
        var opened = s;
        s = rig.turn(s, "\"가지 마\"가 입에 안 붙어요").session();
        s = rig.turn(s, "그래서 어떻게 해요?").session();
        int replies = (int) s.turns().stream().filter(turn -> "ai".equals(turn.role())).count();
        var reopened = CoachTurnGoldenRig.editState(s, state -> {
            ((tools.jackson.databind.node.ObjectNode) state.path(PurposeLoop.STATE_KEY)).put(PracticeLoopRouter.RESUMED_AT, replies);
            return state;
        });
        reopened = reopened.withCoachingState(reopened.experienceVersion(), reopened.stateRevision(), reopened.coachingState(), "open", "");
        rig.turn(reopened, "예시로 읽어줄 수 있어?");
        rig.section("그만(말로)");
        rig.turn(opened, "그만");
    }

    static void talkCharacterAndConcern(CoachTurnGoldenRig rig) {
        rig.section("인물 이해하기(말로)");
        rig.model.says(
                "<설계>\n입력: 영상 없음 (말로 하는 코칭)\n</설계>\n<코치>\n이 인물은 어떤 사람이에요?\n</코치>\n<보기>\n화를 참는 사람\n</보기>",
                "화를 참는 사람이군요. 그 전에 무슨 일이 있었어요?\n<인물 카드>\n누구: 화를 참는 사람 (내 말)\n</인물 카드>",
                "붙잡히고 싶은 마음도 있을 수 있어요. 그래서 참는 게 더 아파 보여요.\n<인물 카드>\n누구: 화를 참는 사람 (내 말)\n직전 상황: 헤어지자는 말을 들었다 (내 말)\n바라는 것: 붙잡히기 (같이 찾음)\n</인물 카드>\n<다음 테이크>참는 말끝에 붙잡고 싶은 마음을 남겨 봐도 좋아요</다음 테이크>");
        rig.model.classifies(signals("answered"), signals("answered"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 0, null, PurposeLoop.TALK_PREFIX + "character"), null).session();
        s = rig.turn(s, "화를 참는 사람이요").session();
        rig.turn(s, "헤어지자는 말을 들었어요");
        rig.section("고민 상담(말로)");
        rig.model.says(
                "<설계>\n입력: 영상 없음 (말로 하는 코칭)\n</설계>\n<코치>\n요즘 연기하면서 어떤 고민이 있어요?\n</코치>\n<보기>\n오디션이 걱정돼요\n</보기>",
                "오디션이 걱정되는군요. 뭐가 있으면 덜 걱정될까요?",
                "<다음 테이크>오디션 대본 한 장면을 매일 소리 내어 읽어 봐도 좋아요</다음 테이크>\n매일 한 장면을 소리 내어 읽어 봐도 좋아요.");
        rig.model.classifies(signals("answered"));
        s = rig.turn(CoachTurnGoldenRig.fresh("", 0, null, PurposeLoop.TALK_PREFIX + "concern"), null).session();
        s = rig.turn(s, "오디션이 걱정돼요").session();
        rig.turn(s, "연습할 시간이 있으면요");
    }

    /** 리딩 녹음 코칭: 이은 녹음을 올리고 대본을 재료로 붙인다. 방법을 달라 하면 정해 주며 정리한다. */
    static void readingVoice(CoachTurnGoldenRig rig) {
        rig.coach.withReadingAudio((userId, practiceId, withAudio) -> {
            Path file = null;
            if (withAudio) {
                try {
                    file = Files.createTempFile("golden-reading-", ".wav");
                    Files.writeString(file, "reading voice bytes");
                } catch (IOException failure) {
                    throw new java.io.UncheckedIOException(failure);
                }
            }
            return new CoachReadingAudio.Prepared(file, "audio/wav", "reading/source", READING_MATERIAL);
        });
        rig.model.says(READING_OPENING,
                "남아 달라는 말이군요. \"가지 마, 제발\"을 천천히 읽어 봐요. 어떤 마음으로 읽을래요?\n<보기>\n매달리는 마음\n</보기>",
                "<다음 테이크>\"가지 마, 제발.\"에서 매달리듯 천천히 읽어 봐도 좋아요</다음 테이크>\n\"가지 마, 제발\"에서 매달리듯 천천히 읽어 봐도 좋아요. 그 한 줄을 영상으로 찍어 보면 더 깊게 볼게요.\n천천히 읽기.");
        rig.model.classifies(signals("not_yet", "method"));
        var s = rig.turn(CoachTurnGoldenRig.fresh("", 0, null, "reading"), null).session();
        var opened = s;
        s = rig.turn(s, "남아 줄게").session();
        rig.turn(s, "어떻게 읽어요?");
        rig.section("그만(리딩 녹음)");
        rig.turn(opened, "그만");
    }

    /** 연습 루프 상태 없이 시작한 옛 대화: 분류·과제 조립 경로로 답한다. */
    static void beforePracticeLoop(CoachTurnGoldenRig rig) {
        rig.model.classifies(signals("unsure"));
        rig.model.says("겁주려는 마음이 끝까지 가요. 마지막 대사에서 상대를 봐요.");
        rig.turn(CoachTurnGoldenRig.beforeLoop("말끝을 가볍게 던진 선택이 보여요. 장난스럽게 겁주려는 건가요?", "네 겁주려고요",
                "그 마음이 끝까지 가요?"), "잘 모르겠어요");
    }
}
