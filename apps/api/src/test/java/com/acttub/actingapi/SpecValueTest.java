package com.acttub.actingapi;

import static java.util.Map.entry;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.acttub.actingapi.feature.ads.domain.AdRules;
import com.acttub.actingapi.feature.ads.domain.AdSize;
import com.acttub.actingapi.feature.ads.domain.AdSlot;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.acttub.actingapi.feature.billing.app.PgReviewResult;
import com.acttub.actingapi.feature.billing.app.PgReviewService;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions;
import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.community.app.CommunityImageService;
import com.acttub.actingapi.feature.portfolio.domain.CreditRules;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;
import com.acttub.actingapi.feature.reading.app.ScriptPlan;
import com.acttub.actingapi.feature.reading.domain.CocreateRules;
import com.acttub.actingapi.feature.reading.domain.LineMatch;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.support.app.SupportInquiryRules;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.platform.schema.AccountCleanupKind;
import com.acttub.actingapi.platform.schema.PgEnum;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import com.acttub.actingapi.platform.security.AccessGate;

/**
 * 스펙이 글로 적은 한도 숫자·값 목록이 코드의 값과 같다. 값을 쓰는 것은 코드이고 스펙은 그 값을 사람이 읽는 말로 옮긴다.
 * 한쪽만 고치면 스펙이 코드와 다른 말을 하므로 이 테스트가 둘을 묶는다(루트 CLAUDE.md 「조건부 정본」, docs/specs/README.md).
 *
 * <p>묶음 하나는 (파일, 정규식, 코드의 값)이다. 정규식의 첫 무리가 문서의 값이다. 파일에 그 문장이 하나 이상 있어야 하고, 있는
 * 곳마다 값이 코드와 같아야 한다. 줄바꿈과 그 뒤 들여쓰기는 빈칸 하나로 읽는다(문단의 줄바꿈이 문장 가운데에 온다). 숫자의 쉼표는
 * 지우고 「두」「세」 같은 우리말 수는 숫자로 읽는다. 목록은 무리 안의 낱말을 모든 곳에서 모아 코드의 목록과 견준다.
 *
 * <ul>
 *   <li>값을 바꾸면 스펙의 그 문장도 고친다.</li>
 *   <li>문장을 고쳐 정규식이 더는 맞지 않으면 묶음을 새 문장에 맞춘다. 묶음을 지우는 것은 스펙에서 그 값이 빠졌을 때뿐이다.</li>
 *   <li>스펙에 새 한도를 적으면 여기에도 묶는다.</li>
 * </ul>
 *
 * <p>상태 값 목록은 {@code ValueCheckCatalogIT} 가, 오류 코드는 {@link SpecErrorCodeTest} 가 묶는다.
 */
class SpecValueTest {

    /** Gradle 은 {@code apps/api} 에서 테스트를 돌린다. 파일 경로는 저장소 루트에서 센다. */
    private static final Path ROOT = Path.of("../..");

    private static final Path JAVA_ROOT = Path.of("src/main/java");

    private static final Path RESOURCES = Path.of("src/main/resources");

    private static final String PACKAGE = "com.acttub.actingapi.";

    private static final long MIB = 1024L * 1024;

    private static final long GIB = 1024L * MIB;

    private static final long MB = 1_000_000L;

    private static final Map<String, Integer> KOREAN_NUMBERS = Map.ofEntries(
            entry("한", 1), entry("하나", 1), entry("두", 2), entry("둘", 2), entry("세", 3), entry("셋", 3),
            entry("네", 4), entry("넷", 4), entry("다섯", 5), entry("여섯", 6), entry("일곱", 7), entry("여덟", 8),
            entry("아홉", 9), entry("열", 10));

    /** 목록 무리에서 값 하나로 읽는 낱말. {@code video/mp4} 같은 형식 이름도 든다. */
    private static final Pattern LIST_TOKEN = Pattern.compile("[a-z0-9][a-z0-9_/.+-]*");

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Z][A-Z0-9_]*):([^}]*)}");

    private static final Map<String, String> TEXTS = new TreeMap<>();

    private sealed interface Expected permits NumberValue, TextValue, ListValue {
    }

    private record NumberValue(BigDecimal value) implements Expected {
    }

    private record TextValue(String value) implements Expected {
    }

    private record ListValue(Set<String> value) implements Expected {
    }

    /** 스펙의 문장 하나와 그 문장이 말해야 하는 코드의 값. */
    private record Binding(String file, Pattern sentence, Expected expected) {
    }

    private static Binding number(String file, String sentence, long expected) {
        return new Binding(file, Pattern.compile(sentence), new NumberValue(BigDecimal.valueOf(expected)));
    }

    private static Binding number(String file, String sentence, double expected) {
        return new Binding(file, Pattern.compile(sentence), new NumberValue(BigDecimal.valueOf(expected)));
    }

    private static Binding text(String file, String sentence, String expected) {
        return new Binding(file, Pattern.compile(sentence), new TextValue(expected));
    }

    private static Binding list(String file, String sentence, Collection<?> expected) {
        return new Binding(file, Pattern.compile(sentence),
                new ListValue(expected.stream().map(String::valueOf).collect(Collectors.toCollection(TreeSet::new))));
    }

    private static final String PRACTICE = "docs/specs/practice/";

    private static final String READING = "docs/specs/reading/";

    private static final String ACCOUNT = "docs/specs/account/";

    private static final String CHALLENGE = "docs/specs/challenge/";

    private static final String APP = "docs/specs/app/";

    private static final String BILLING = "docs/specs/billing/";

    private static List<Binding> bindings() {
        long guest = PracticeRules.GUEST_DAILY_ANALYSES;
        long free = PracticeRules.FREE_DAILY_COACHING_SESSIONS;
        long legacy = ConversationService.LEGACY_REPLY_LIMIT;
        long threeLayers = ConversationService.THREE_LAYERS_REPLY_LIMIT;
        long freeReplies = Long.parseLong(property("COACHING_FREE_REPLY_LIMIT"));
        long purposeCap = longConstant("feature.coach.app.PurposeLoop", "REPLY_CAP");
        long actorText = ConversationService.ACTOR_TEXT_MAX_CHARS;
        long videoMinutes = exact(VideoRules.DURATION_MAX_MS, 60_000);
        long videoMib = exact(VideoRules.FILE_MAX_BYTES, MIB);
        long intentMinutes = minutes(VideoRules.INTENT_TTL);
        long boostGap = longConstant("feature.challenge.adapter.db.UnseenEntryBoost", "GAP");
        long boostSlots = Long.parseLong(property("CHALLENGE_UNSEEN_BOOST_SLOTS"));
        long privacyCoversReading = longConstant("feature.consent.adapter.db.PostgresReadingConsents",
                "PRIVACY_COVERS_READING_FROM");
        String community = "docs/specs/community/README.md";
        return List.of(
                // practice.analyze·start·resume — 게스트 하루 분석 한도와 무료 하루 코칭 회차
                number(PRACTICE + "analyze.md", "게스트 하루 (\\d+)회는", guest),
                number(PRACTICE + "analyze.md", "게스트 (\\d+)회 요청 뒤", guest),
                number(PRACTICE + "analyze.md", "(\\d+)번째 시작: 429 guest_daily_analysis_limit", guest + 1),
                number(PRACTICE + "analyze.md", "하루 코칭 회차 (\\d+)개 한도", free),
                number(PRACTICE + "analyze.md", "`ANALYSIS_LEASE_SEC`, 기본 (\\d+)분",
                        exact(Long.parseLong(property("ANALYSIS_LEASE_SEC")), 60)),
                number(PRACTICE + "start.md", "게스트의 하루 (\\d+)번째 시작", guest + 1),
                number(PRACTICE + "start.md", "게스트 (\\d+)번째: 429", guest + 1),
                number(PRACTICE + "start.md", "하루 (\\d+)회를 쓴 게스트", guest),
                number(PRACTICE + "start.md", "하루 (\\d+)번째 코칭 회차", free + 1),
                number(PRACTICE + "resume.md", "게스트가 하루 (\\d+)회를 쓴 뒤", guest),

                // practice.coach — 코치 응답 상한, 무료 코칭 길이, 목적별 코칭, 배우 답 길이
                number(PRACTICE + "coach.md", "코치 응답 수로 기존 갈래 (\\d+)개", legacy),
                number(PRACTICE + "coach.md", "기존 갈래 \\d+개, 신형 (\\d+)개", threeLayers),
                number(PRACTICE + "coach.md", "코치 응답 (\\d+)개가 저장된", legacy - 1),
                number(PRACTICE + "coach.md", "(\\d+)번째 응답으로 마무리하고", legacy),
                number(PRACTICE + "coach.md", "신형은 (\\d+)개 뒤", threeLayers - 1),
                number(PRACTICE + "coach.md", "신형에서 (\\d+)개 뒤 답", threeLayers - 1),
                number(PRACTICE + "coach.md", "답: (\\d+)번째가 마무리", threeLayers),
                number(PRACTICE + "coach.md", "다시 열기는 코치 응답이 (\\d+)개 이상이면", threeLayers - 2),
                number(PRACTICE + "coach.md", "코치 응답 (\\d+)개인 닫힌 대화", threeLayers - 2),
                number(PRACTICE + "coach.md", "`COACHING_FREE_REPLY_LIMIT`번\\(기본 (\\d+),", freeReplies),
                number(PRACTICE + "coach.md", "시작을 포함해 (\\d+)개이고", freeReplies + 1),
                number(PRACTICE + "coach.md", "`reply_limit`도 (\\d+)이다", freeReplies + 1),
                number(PRACTICE + "coach.md", "코치 응답이 (\\d+)개\\(\\d+ - 2\\) 이상", freeReplies + 1 - 2),
                number(PRACTICE + "coach.md", "코치 응답이 \\d+개\\((\\d+) - 2\\) 이상", freeReplies + 1),
                number(PRACTICE + "coach.md", "시작 응답을 포함해 (\\d+)번까지", purposeCap),
                number(PRACTICE + "coach.md", "(\\d+)번째는 정리다", purposeCap),
                number(PRACTICE + "coach.md", "`text`\\((\\d+)자까지\\)", actorText),
                number(PRACTICE + "coach.md", "배우 답은 (\\d+)자까지", actorText),
                number(PRACTICE + "coach.md", "(\\d+)자 답: 200", actorText),
                number(PRACTICE + "coach.md", "200\\. (\\d+)자: 422", actorText + 1),
                number(PRACTICE + "coach.md", "영상이 (\\d+)초 미만이면\\(`DirectVideoPracticeLoop.MIN_ACTING_MS`",
                        exact(longConstant("feature.coach.app.DirectVideoPracticeLoop", "MIN_ACTING_MS"), 1000)),

                // practice.record — 영상 형식·길이·크기·총량, 올릴 자리 시한, 정리 주기
                list(PRACTICE + "record.md", "`content_type`\\(([^)]+)\\)",
                        (Set<?>) constant("feature.video.domain.VideoRules", "ALLOWED")),
                number(PRACTICE + "record.md", "형식은 MP4·MOV, 길이 (\\d+)분", videoMinutes),
                number(PRACTICE + "record.md", "\\((\\d+)분까지 올릴 수 있어요\\)", videoMinutes),
                number(PRACTICE + "record.md", "(\\d+)분을 넘음", videoMinutes),
                number(PRACTICE + "record.md", "\\((\\d+)분 이내\\)", videoMinutes),
                number(PRACTICE + "record.md", "(\\d+)분 1초", videoMinutes),
                number(PRACTICE + "record.md", "서버에 올리는 파일은 (\\d+)MiB 이하", videoMib),
                number(PRACTICE + "record.md", "압축 결과가 (\\d+)MiB를 넘음", videoMib),
                number(PRACTICE + "record.md", "\\((\\d+)MB 이내\\)", videoMib),
                number(PRACTICE + "record.md", "(\\d+)MiB \\+ 1바이트", videoMib),
                number(PRACTICE + "record.md", "계정당 회원 (\\d+)GiB", exact(VideoRules.MEMBER_QUOTA_BYTES, GIB)),
                number(PRACTICE + "record.md", "총량 (\\d+)GiB를 넘긴", exact(VideoRules.MEMBER_QUOTA_BYTES, GIB)),
                number(PRACTICE + "record.md", "회원 \\d+GiB, 게스트 (\\d+)MiB", exact(VideoRules.GUEST_QUOTA_BYTES, MIB)),
                number(PRACTICE + "record.md", "게스트 (\\d+)MiB: 같다", exact(VideoRules.GUEST_QUOTA_BYTES, MIB)),
                number(PRACTICE + "record.md", "올릴 자리는 (\\d+)분 뒤 만료", intentMinutes),
                number(PRACTICE + "record.md", "받고 (\\d+)분 뒤 마무리", intentMinutes + 1),
                number(PRACTICE + "record.md", "확정 뒤 (\\d+)분이 지나", intentMinutes + 1),
                number(PRACTICE + "record.md", "`UPLOAD_INTENT_SWEEP_INTERVAL_MS`, 기본 (\\d+)초",
                        exact(Long.parseLong(property("UPLOAD_INTENT_SWEEP_INTERVAL_MS")), 1000)),

                // reading.recording — 녹음 크기·길이·총량·재생 주소
                number(READING + "recording.md", "파일 ([\\d,]+)바이트\\(올린 원본 기준\\)", RecordingRules.FILE_MAX_BYTES),
                number(READING + "recording.md", "파일이 ([\\d,]+)바이트를 넘으면 기기가", RecordingRules.FILE_MAX_BYTES),
                number(READING + "recording.md", "([\\d,]+)바이트 파일: 422 recording_too_long", RecordingRules.FILE_MAX_BYTES + 1),
                number(READING + "recording.md", "길이 (\\d+)초를 넘으면 422 recording_too_long",
                        exact(RecordingRules.DURATION_MAX_MS, 1000)),
                number(READING + "recording.md", "(\\d+)초에 이르면 녹음을 멈추고", exact(RecordingRules.DURATION_MAX_MS, 1000)),
                number(READING + "recording.md", "정확히 (\\d+)초: 저장되고", exact(RecordingRules.DURATION_MAX_MS, 1000)),
                number(READING + "recording.md", "행 없음\\. (\\d+)초: 422 recording_too_long",
                        exact(RecordingRules.DURATION_MAX_MS, 1000) + 1),
                number(READING + "recording.md", "저장된 바이트 합으로 회원 ([\\d,]+)바이트", RecordingRules.MEMBER_QUOTA_BYTES),
                number(READING + "recording.md", "총량 ([\\d,]+)바이트를 넘긴 회원", RecordingRules.MEMBER_QUOTA_BYTES),
                number(READING + "recording.md", "회원 [\\d,]+바이트, 게스트 ([\\d,]+)바이트", RecordingRules.GUEST_QUOTA_BYTES),
                number(READING + "recording.md", "게스트 ([\\d,]+)바이트 초과", RecordingRules.GUEST_QUOTA_BYTES),
                number(READING + "recording.md", "m4a ([\\d,]+)바이트 미만", RecordingRules.STORED_MIN_BYTES),
                number(READING + "recording.md", "(\\d+)분 서명 `playback_url`", exact(RecordingRules.PLAYBACK_TTL_SECONDS, 60)),
                number(READING + "recording.md", "짧은 서명 URL\\((\\d+)분\\)", exact(RecordingRules.PLAYBACK_TTL_SECONDS, 60)),

                // reading.script — 글 길이, 대본 수, 원본 파일, 나누기 작업
                number(READING + "script.md", "원문 ([\\d,]+)자(?:\\(| 저장| 이하)", ScriptRules.TEXT_MAX),
                number(READING + "script.md", "원문 ([\\d,]+)자: 422", ScriptRules.TEXT_MAX + 1),
                number(READING + "script.md", "뽑은 글 ([\\d,]+)자", ScriptRules.TEXT_MAX),
                number(READING + "script.md", "뽑은 글이 ([\\d,]+)자를", ScriptRules.TEXT_MAX),
                number(READING + "script.md", "본문 총량이 ([\\d,]+)자를", ScriptRules.TEXT_MAX),
                number(READING + "script.md", "총량도 같은 ([\\d,]+)자로", ScriptRules.TEXT_MAX),
                number(READING + "script.md", "대본 수는 회원 (\\d+)개", ScriptRules.MEMBER_SCRIPT_MAX),
                number(READING + "script.md", "이관으로 회원이 (\\d+)개를", ScriptRules.MEMBER_SCRIPT_MAX),
                number(READING + "script.md", "한도\\(대본 (\\d+)개\\)", ScriptRules.MEMBER_SCRIPT_MAX),
                number(READING + "script.md", "대본 (\\d+)개인 회원: 422", ScriptRules.MEMBER_SCRIPT_MAX),
                number(READING + "script.md", "게스트 (\\d+)개\\(예시", ScriptRules.GUEST_SCRIPT_MAX),
                number(READING + "script.md", "Pro가 아닌 사람은 대본 (\\d+)개까지", ScriptPlan.FREE_SCRIPTS),
                number(READING + "script.md", "파일은 ([\\d,]+)바이트까지", ScriptFileRules.FILE_MAX_BYTES),
                number(READING + "script.md", "(\\d+)MB 초과\\(422 `script_file_too_large`", exact(ScriptFileRules.FILE_MAX_BYTES, MB)),
                number(READING + "script.md", "(\\d+)MB까지 열 수", exact(ScriptFileRules.FILE_MAX_BYTES, MB)),
                number(READING + "script.md", "올리기 주소의 시한\\((\\d+)분\\)", minutes(ScriptFileRules.UPLOAD_TTL)),
                number(READING + "README.md", "올리기 주소 시한\\((\\d+)분\\)", minutes(ScriptFileRules.UPLOAD_TTL)),
                number(READING + "script.md", "읽기 자리가 (\\d+)초", ScriptFileRules.READ_WAIT.toSeconds()),
                number(READING + "script.md", "받기와 뽑기 (\\d+)초", ScriptFileRules.READ_TIMEOUT.toSeconds()),
                number(READING + "script.md", "받기와 뽑기가 (\\d+)초를", ScriptFileRules.READ_TIMEOUT.toSeconds()),
                number(READING + "script.md", "모델을 부를 수 있는 작업은 (\\d+)개", ScriptSplitRules.DAILY_IMPORTS),
                number(READING + "script.md", "(\\d+)줄 조각", ScriptSplitRules.CHUNK_LINES),
                number(READING + "script.md", "빠진 줄은 (\\d+)줄씩", ScriptSplitRules.CHUNK_LINES),
                number(READING + "script.md", "줄씩 묶어 (\\S+) 번까지 다시 묻고", ScriptSplitRules.MISSING_ROUNDS),
                number(READING + "script.md", "빠진 줄마다 앞뒤 (\\d+)줄", ScriptSplitRules.MISSING_CONTEXT_LINES),
                number(READING + "script.md", "동시에 보내는 호출은 (\\d+)개까지", ScriptSplitRules.PARALLEL_CALLS),
                number(READING + "script.md", "서버 전체는 동시 (\\d+)개까지", ScriptSplitRules.REVIEW_IN_FLIGHT),
                number(READING + "script.md", "앞 (\\d+)줄로 말하는", ScriptSplitRules.ROSTER_LINES),
                number(READING + "script.md", "호출은 앞 (\\d+)줄만", ScriptSplitRules.ROSTER_LINES),
                number(READING + "script.md", "\\(앞 (\\d+)줄 뒤에", ScriptSplitRules.ROSTER_LINES),

                // reading.memorization·voice-coaching·cloud-voice·cocreate
                number(READING + "memorization.md", "유사도가 ([\\d.]+) 이상이면 통과", LineMatch.PASS_THRESHOLD),
                number(READING + "voice-coaching.md", "받아쓰기가 없으면 ([\\d.]+)초보다 길다",
                        ReadingVoiceMaterial.SILENT_MAX_MS / 1000.0),
                number(READING + "voice-coaching.md", "대본 순서대로 (\\d+)줄", ReadingVoiceMaterial.MAX_CLIPS),
                number(READING + "voice-coaching.md", "줄·(\\d+)MB 까지", exact(ReadingVoiceMaterial.MAX_TOTAL_BYTES, MIB)),
                number(READING + "voice-coaching.md", "줄마다 뒤에 ([\\d.]+)초 빈 소리", ReadingVoiceMaterial.GAP_MS / 1000.0),
                number(READING + "cloud-voice.md", "한국 달력 월 새 합성 ([\\d,]+)줄",
                        Long.parseLong(property("READING_VOICE_PRO_MONTHLY_LINE_CAP"))),
                number(READING + "cloud-voice.md", "계정별 월 ([\\d,]+)줄",
                        Long.parseLong(property("READING_VOICE_PRO_MONTHLY_LINE_CAP"))),
                number(READING + "cloud-voice.md", "([\\d,]+)번째 줄은 허용",
                        Long.parseLong(property("READING_VOICE_PRO_MONTHLY_LINE_CAP"))),
                number(READING + "cloud-voice.md", "서비스 전체 월 ([\\d,]+)줄",
                        Long.parseLong(property("READING_VOICE_MONTHLY_LINE_CAP"))),
                number(READING + "cloud-voice.md", "기존 일 (\\d+)줄", Long.parseLong(property("READING_VOICE_DAILY_LINE_CAP"))),
                number(READING + "cocreate.md", "배역 수 1~(\\d+)", CocreateRules.MAX_CHARACTERS),
                list(READING + "cocreate.md", "분량 ([\\d·]+)분", CocreateRules.LENGTHS),
                number(READING + "cocreate.md", "성공한 수정만 무료 (\\d+)회", CocreateRules.FREE_REVISIONS),
                number(READING + "cocreate.md", "생성 대본 한 건에 무료 (\\d+)회", CocreateRules.FREE_REVISIONS),
                number(READING + "cocreate.md", "24시간에 (\\d+)개까지", CocreateRules.DAILY_LIMIT),
                number(READING + "cocreate.md", "24시간 (\\d+)개 초과", CocreateRules.DAILY_LIMIT),
                number(READING + "cocreate.md", "하루 (\\d+)개에 다시 센다", CocreateRules.DAILY_LIMIT),
                number(READING + "cocreate.md", "분량은 대사 (\\d+)자 = 1초", CocreateRules.CHARS_PER_SECOND),
                number(READING + "cocreate.md", "영어 기준은 대사 (\\d+)자 = 1초", CocreateRules.CHARS_PER_SECOND_EN),
                number(READING + "cocreate.md", "안전 금지어·지문 (\\d+)자", CocreateRules.DIRECTION_MAX),
                number(READING + "cocreate.md", "지문 (\\d+)자이며", CocreateRules.DIRECTION_MAX_EN),

                // account.portfolio·withdraw·consent
                list(ACCOUNT + "portfolio.md", "저장 값은 ([a-z·]+)다", dbValues(PortfolioCreditKind.values())),
                number(ACCOUNT + "portfolio.md", "소개글은 ([\\d,]+)자", CreditRules.INTRO_MAX),
                number(ACCOUNT + "portfolio.md", "각 1~(\\d+)자", CreditRules.TEXT_MAX),
                number(ACCOUNT + "portfolio.md", "경력은 (\\d+)개까지", CreditRules.CREDIT_MAX),
                number(ACCOUNT + "portfolio.md", "연도는 (\\d+)년부터", CreditRules.YEAR_MIN),
                number(ACCOUNT + "portfolio.md", "사진은 (\\d+)장까지", CreditRules.PHOTO_MAX),
                number(ACCOUNT + "portfolio.md", "최대 (\\d+)장, 순서 있음", CreditRules.PHOTO_MAX),
                number(ACCOUNT + "portfolio.md", "주소를 받고 (\\d+)분 안에",
                        minutes((Duration) constant("feature.portfolio.app.PortfolioService", "PHOTO_UPLOAD_TTL"))),
                list(ACCOUNT + "withdraw.md", "`ck_account_cleanup_operations_kind`의 ([a-z_· ]+)\\)",
                        dbValues(AccountCleanupKind.values())),
                number(ACCOUNT + "consent.md", "개인정보 수집·이용 동의 v(\\d+)부터", privacyCoversReading),
                number(ACCOUNT + "consent.md", "v(\\d+) 이상 동의자", privacyCoversReading),
                number("apps/api/CONTRACT.md", "개인정보 수집·이용 동의 v(\\d+) 이상에 동의했으면", privacyCoversReading),
                number("apps/api/CONTRACT.md", "개인정보 v(\\d+) 이상에 동의하지 않은 게스트", privacyCoversReading),

                // challenge.browse·ai-report·report
                number(CHALLENGE + "browse.md", "대사 목록 응답: visible이고 삭제하지 않은 챌린지만 (\\d+)개씩",
                        longConstant("feature.challenge.adapter.db.PostgresChallengeBrowse", "PAGE_SIZE")),
                number(CHALLENGE + "browse.md", "참여작 목록은 (\\d+)개씩", ChallengeRules.ENTRY_PAGE),
                number(CHALLENGE + "browse.md", "처음 조회한 순서를 (\\d+)분 고정", minutes(ChallengeRules.RANKING_HOLD)),
                number(CHALLENGE + "browse.md", "(\\d+)분이 지난 커서", minutes(ChallengeRules.RANKING_HOLD)),
                number(CHALLENGE + "browse.md", "(\\d+)분 안의 다음 페이지", minutes(ChallengeRules.RANKING_HOLD)),
                number(CHALLENGE + "browse.md", "\\(event_id 유일, (\\d+)일 보관\\)", days(ChallengeRules.VIEW_EVENT_RETENTION)),
                number(CHALLENGE + "browse.md", "조회수가 (\\d+) 미만", Long.parseLong(property("CHALLENGE_UNSEEN_BOOST_MAX_VIEWS"))),
                number(CHALLENGE + "browse.md", "세어 (\\d+)·\\d+·\\d+번째 칸", boostGap),
                number(CHALLENGE + "browse.md", "세어 \\d+·(\\d+)·\\d+번째 칸", boostGap * 2),
                number(CHALLENGE + "browse.md", "세어 \\d+·\\d+·(\\d+)번째 칸", boostGap * boostSlots),
                number(CHALLENGE + "browse.md", "앞쪽 (\\d+)칸 밖", boostGap * boostSlots),
                number(CHALLENGE + "ai-report.md", "회원은 하루 (\\d+)회의 새 생성", ChallengeReportRules.DAILY_REQUESTS),
                number(CHALLENGE + "ai-report.md", "최대 (\\d+)번 실행", ChallengeReportRules.MAX_RUNS),
                number(CHALLENGE + "ai-report.md", "실행 (\\d+)번 (?:소진|실패)", ChallengeReportRules.MAX_RUNS),
                number(CHALLENGE + "ai-report.md", "(?:failed, |\\()attempt_count (\\d+)", ChallengeReportRules.MAX_RUNS),
                number(CHALLENGE + "ai-report.md", "attempt_count 0~(\\d+)", ChallengeReportRules.MAX_RUNS),
                number(CHALLENGE + "ai-report.md", "published_at 최근 (\\d+)개", ChallengeReportRules.MAX_SAMPLES),
                number(CHALLENGE + "ai-report.md", "작성자의 최근 (\\d+)개만", ChallengeReportRules.MAX_SAMPLES),
                number(CHALLENGE + "ai-report.md", "표본이 (\\d+)개 미만", ChallengeReportRules.MIN_SAMPLES),
                text(CHALLENGE + "ai-report.md", "관찰만 만들고 \"([^\"]+)\"를 쓴다", ChallengeReportRules.TOO_FEW_SAMPLES),
                number(CHALLENGE + "report.md", "note\\((\\d+)자", ChallengeRules.REPORT_NOTE_MAX),
                number(CHALLENGE + "report.md", "메모 (\\d+)자: 200", ChallengeRules.REPORT_NOTE_MAX),
                number(CHALLENGE + "report.md", "200\\. (\\d+)자: 422", ChallengeRules.REPORT_NOTE_MAX + 1),
                number(CHALLENGE + "report.md", "서로 다른 신고자 (\\d+)명(?:부터|\\.|이 되는 순간 숨긴다)",
                        ChallengeRules.PASSED_ENTRY_REPORT_THRESHOLD),
                number(CHALLENGE + "report.md", "서로 다른 신고자 (\\d+)명이 되는 순간 moderation",
                        ChallengeRules.CHALLENGE_REPORT_THRESHOLD),
                number(CHALLENGE + "report.md", "동시에 (\\d+)번째가 둘", ChallengeRules.CHALLENGE_REPORT_THRESHOLD),
                number(CHALLENGE + "report.md", "서로 다른 (\\d+)명\\(received\\)", ChallengeRules.CHALLENGE_REPORT_THRESHOLD),
                number(CHALLENGE + "report.md", "숨김·애매 판정과 (\\d+)번 실패", ChallengeRules.MODERATION_MAX_ATTEMPTS),
                number(CHALLENGE + "report.md", "하루 (\\d+)건까지", ChallengeRules.DAILY_REPORTS),
                number(CHALLENGE + "report.md", "하루 (\\d+)번째: 429", ChallengeRules.DAILY_REPORTS + 1),
                number(CHALLENGE + "report.md", "접수순 (\\d+)개씩",
                        longConstant("feature.challenge.adapter.db.PostgresEntryReportRepository", "PAGE")),

                // app.ads·audition·support-inquiry
                text(APP + "ads.md", "LARGE_BANNER (\\d+x\\d+)", size(AdSize.LARGE_BANNER)),
                text(APP + "ads.md", "BANNER (\\d+x\\d+), MEDIUM", size(AdSize.BANNER)),
                text(APP + "ads.md", "MEDIUM_RECTANGLE (\\d+x\\d+)", size(AdSize.MEDIUM_RECTANGLE)),
                list(APP + "ads.md", "`([a-z_]+_full)`",
                        Arrays.stream(AdSlot.values()).filter(AdSlot::fullScreen).map(AdSlot::key).toList()),
                list(APP + "ads.md", "`status`\\(([a-z·]+)\\)", AdRules.STATUSES),
                list(APP + "audition.md", "\\| `category` \\| ([^|]+) \\|", AuditionRules.CATEGORIES),
                list(APP + "audition.md", "\\| `source` \\| 출처 코드 ([^|]+) \\|", AuditionRules.SOURCES.keySet()),
                number(APP + "audition.md", "`posted_on`이 (\\d+)일 안일 때", AuditionRules.OPEN_WITHOUT_END_DAYS),
                number(APP + "audition.md", "`apply_end`가 (\\d+)일 지났거나", AuditionRules.KEEP_AFTER_END_DAYS),
                number(APP + "audition.md", "`posted_on`이 (\\d+)일 지난 행", AuditionRules.KEEP_WITHOUT_END_DAYS),
                number(APP + "support-inquiry.md", "`client` 칸에 남는다\\((\\d+)자까지\\)", SupportInquiryRules.CLIENT_MAX_CHARS),
                number(APP + "support-inquiry.md", "앞뒤 공백을 걷은 뒤 (\\d+)자 이하", SupportInquiryRules.EMAIL_MAX_CHARS),
                number(APP + "support-inquiry.md", "앞뒤 공백을 걷은 뒤 (\\d+)~\\d+ 유니코드", SupportInquiryRules.BODY_MIN_CHARS),
                number(APP + "support-inquiry.md", "앞뒤 공백을 걷은 뒤 \\d+~(\\d+) 유니코드", SupportInquiryRules.BODY_MAX_CHARS),
                number(APP + "support-inquiry.md", "에서 (\\d+)분에 \\d+건까지", SupportInquiryRules.WINDOW_MINUTES),
                number(APP + "support-inquiry.md", "에서 \\d+분에 (\\d+)건까지", SupportInquiryRules.PER_IP_LIMIT),
                number(APP + "support-inquiry.md", "새것부터 (\\d+)건", SupportInquiryRules.MINE_LIMIT),
                number(APP + "support-inquiry.md", "`summary`\\(본문 앞 (\\d+)자", SupportInquiryRules.SUMMARY_CHARS),
                number(APP + "support-inquiry.md", "본문 앞 (\\d+)자·문의 id",
                        longConstant("feature.support.adapter.slack.SlackSupportInquiryNotifier", "BODY_PREVIEW_CHARS")),

                // billing.pg-review·subscription
                number(BILLING + "pg-review.md", "월 ([\\d,]+)원\\(VAT", PgReviewResult.AMOUNT),
                number(BILLING + "pg-review.md", "금액 ([\\d,]+)", PgReviewResult.AMOUNT),
                number(BILLING + "pg-review.md", "서버 고정 ([\\d,]+)원", PgReviewResult.AMOUNT),
                text(BILLING + "pg-review.md", "주문명 `([^`]+)`", PgReviewService.ORDER_NAME),
                number(BILLING + "pg-review.md", "세션당 (\\d+)회", PgReviewSessions.MAX_CHECKOUTS_PER_SESSION),
                number(BILLING + "pg-review.md", "로그인부터 (\\d+)분\\(절대\\)", minutes(PgReviewSessions.SESSION_TTL)),
                number(BILLING + "pg-review.md", "동시 (\\d+)개, 접근 때마다", PgReviewSessions.MAX_SESSIONS),
                number(BILLING + "subscription.md", "만든 회차\\([^)]*\\)가 (\\d+)개면", free),
                number(BILLING + "subscription.md", "코칭 하루 (\\d+)회", free),
                number(BILLING + "subscription.md", "보관 대본이 (\\d+)개면 새 대본", ScriptPlan.FREE_SCRIPTS),
                number(BILLING + "subscription.md", "무료는 대본 (\\d+)개까지", ScriptPlan.FREE_SCRIPTS),
                number(BILLING + "subscription.md", "여러 개를 넣으면 (\\d+)개를 넘을", ScriptPlan.FREE_SCRIPTS),
                number(BILLING + "subscription.md", "리딩 대본 (\\d+)개\\)", ScriptPlan.FREE_SCRIPTS),
                number(BILLING + "subscription.md", "회원 한도\\((\\d+)\\)", ScriptRules.MEMBER_SCRIPT_MAX),
                number(BILLING + "subscription.md", "`COACHING_FREE_REPLY_LIMIT`번\\(기본 (\\d+),", freeReplies),

                // 공통 규칙 — 분당 한도, 강제 업데이트 문장
                number("docs/specs/common.md", "계정마다 분당 (\\d+)회", AccessGate.PER_USER_PER_MINUTE),
                text("docs/specs/common.md", "\\{\"detail\":\"([^\"]+)\"}",
                        (String) constant("platform.security.ClientVersionFilter", "UPGRADE_NOTICE")),

                // 게시판
                number(community, "글 사진은 (\\S+) 장까지", CommunityImageService.MAX_IMAGES_PER_POST),
                number(community, "(\\d+)장 이상은 400", CommunityImageService.MAX_IMAGES_PER_POST + 1),
                number(community, "한 사람이 (\\d+)장까지",
                        longConstant("feature.community.app.CommunityImageService", "PENDING_LIMIT")),
                number(community, "`url`은 (\\d+)시간짜리 서명 주소", exact(CommunityImageService.VIEW_SECONDS, 3600)),
                number(community, "서로 다른 (\\S+) 사람의 처리 전",
                        longConstant("feature.community.adapter.db.PostgresCommunityRepository", "AUTO_HIDE_REPORTERS")));
    }

    @Test
    @DisplayName("스펙이 글로 적은 한도·목록이 코드의 값과 같다 — 값을 바꾸면 스펙의 그 문장도 고친다")
    void everyBoundSentenceSaysTheCodeValue() {
        List<String> failures = new ArrayList<>();
        for (Binding binding : bindings()) {
            failures.addAll(check(binding));
        }
        assertThat(failures).as("스펙과 코드가 다른 값을 말한다. 틀린 쪽을 고친다(묶음은 SpecValueTest#bindings)").isEmpty();
    }

    private static List<String> check(Binding binding) {
        String text = text(binding.file());
        Matcher matcher = binding.sentence().matcher(text);
        List<String> found = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        Set<String> tokens = new TreeSet<>();
        while (matcher.find()) {
            String value = matcher.group(1);
            found.add(value);
            switch (binding.expected()) {
                case NumberValue expected -> {
                    if (parse(value).compareTo(expected.value()) != 0) {
                        failures.add("%s 「%s」: 스펙은 %s, 코드는 %s".formatted(binding.file(), matcher.group(), value,
                                expected.value().toPlainString()));
                    }
                }
                case TextValue expected -> {
                    if (!value.equals(expected.value())) {
                        failures.add("%s 「%s」: 스펙은 %s, 코드는 %s".formatted(binding.file(), matcher.group(), value,
                                expected.value()));
                    }
                }
                case ListValue expected -> {
                    Matcher token = LIST_TOKEN.matcher(value);
                    while (token.find()) {
                        tokens.add(token.group());
                    }
                }
            }
        }
        if (found.isEmpty()) {
            return List.of("%s 에 /%s/ 문장이 없다 — 문장을 고쳤으면 묶음을 새 문장에 맞춘다".formatted(binding.file(),
                    binding.sentence().pattern()));
        }
        if (binding.expected() instanceof ListValue expected && !tokens.equals(expected.value())) {
            failures.add("%s /%s/: 스펙은 %s, 코드는 %s".formatted(binding.file(), binding.sentence().pattern(), tokens,
                    expected.value()));
        }
        return failures;
    }

    @Test
    @DisplayName("동의 문서 표의 type·필수가 manifest.json 의 한국어 문서와 같다")
    void consentDocumentTableMatchesTheManifest() throws IOException {
        Map<String, Boolean> documented = new TreeMap<>();
        for (List<String> row : table("docs/specs/account/consent.md", "## 데이터")) {
            documented.put(row.get(1), switch (row.get(2)) {
                case "필수" -> true;
                case "선택" -> false;
                default -> throw new IllegalStateException("consent.md 「데이터」의 필수 칸은 필수·선택 둘이다: " + row);
            });
        }
        Map<String, Boolean> published = new TreeMap<>();
        JsonNode manifest = JsonMapper.builder().build().readTree(RESOURCES.resolve("consent-docs/manifest.json").toFile());
        for (JsonNode document : manifest) {
            // locale 이 없는 옛 항목은 한국어 정본이다.
            if (!document.has("locale") || document.get("locale").asString().equals("ko")) {
                published.merge(document.get("type").asString(), document.get("required").asBoolean(), (before, now) -> {
                    assertThat(now).as("%s 의 판마다 필수 여부가 같다", document.get("type")).isEqualTo(before);
                    return now;
                });
            }
        }
        assertThat(documented)
                .as("docs/specs/account/consent.md 「데이터」 ↔ consent-docs/manifest.json(ko) — 문서를 더하거나 필수를 바꾸면 둘 다 고친다")
                .isEqualTo(published);
    }

    /**
     * 리딩 자료의 이관·삭제·탈퇴 표는 리딩이 주인인 테이블 가운데 사람에 매달린 것을 모두 적는다. 매달렸다는 것은 외래 키를 따라가면
     * {@code users} 에 닿는다는 뜻이다(대본·회차·녹음을 거쳐도 된다). 표에 없는 테이블은 탈퇴·삭제 때 어떻게 되는지 정하지 않은 자료다.
     */
    @Test
    @DisplayName("리딩 README 의 이관·삭제·탈퇴 표가 사람에 매달린 리딩 테이블을 모두 적는다")
    void readingLifecycleTableListsEveryOwnedTableThatHangsOnAPerson() throws IOException {
        Set<String> owned = ownedTables("feature/reading");
        Map<String, Set<String>> references = foreignKeys();
        Set<String> hanging = new TreeSet<>(Set.of("users"));
        boolean grew = true;
        while (grew) {
            grew = false;
            for (String table : owned) {
                if (!hanging.contains(table) && references.getOrDefault(table, Set.of()).stream().anyMatch(hanging::contains)) {
                    grew = hanging.add(table);
                }
            }
        }
        hanging.remove("users");
        Set<String> listed = new TreeSet<>();
        for (List<String> row : table("docs/specs/reading/README.md", "## 리딩 자료의 이관·삭제·탈퇴")) {
            Matcher name = Pattern.compile("[a-z][a-z0-9_]*").matcher(row.get(0));
            while (name.find()) {
                if (owned.contains(name.group())) {
                    listed.add(name.group());
                }
            }
        }
        assertThat(listed)
                .as("docs/specs/reading/README.md 「리딩 자료의 이관·삭제·탈퇴」 ↔ 리딩이 주인이고 사람에 매달린 테이블")
                .isEqualTo(hanging);
    }

    /** 파일의 절({@code heading}) 안 첫 표의 본문 줄. 칸은 앞뒤 공백을 걷는다. */
    private static List<List<String>> table(String file, String heading) throws IOException {
        List<List<String>> rows = new ArrayList<>();
        boolean inSection = false;
        for (String line : Files.readAllLines(ROOT.resolve(file), StandardCharsets.UTF_8)) {
            if (line.startsWith("## ")) {
                if (inSection) {
                    break;
                }
                inSection = line.equals(heading);
                continue;
            }
            if (!inSection) {
                continue;
            }
            if (!line.startsWith("|")) {
                if (!rows.isEmpty()) {
                    break;
                }
                continue;
            }
            rows.add(Arrays.stream(line.split("\\|", -1)).skip(1).map(String::strip).toList());
        }
        assertThat(rows).as("%s 「%s」에 표가 있다", file, heading).hasSizeGreaterThan(2);
        // 첫 줄은 머리, 둘째 줄은 |---| 구분선이다.
        return rows.subList(2, rows.size());
    }

    /** docs/ARCHITECTURE.md 「테이블 주인」에서 그 주인의 테이블. */
    private static Set<String> ownedTables(String owner) throws IOException {
        Pattern row = Pattern.compile("^\\| `" + Pattern.quote(owner) + "` \\| (.+) \\|$");
        for (String line : Files.readAllLines(ROOT.resolve("docs/ARCHITECTURE.md"), StandardCharsets.UTF_8)) {
            Matcher matcher = row.matcher(line);
            if (matcher.matches()) {
                return Pattern.compile("`([a-z_0-9]+)`").matcher(matcher.group(1)).results().map(result -> result.group(1))
                        .collect(Collectors.toCollection(TreeSet::new));
            }
        }
        throw new IllegalStateException("docs/ARCHITECTURE.md 「테이블 주인」에 " + owner + " 줄이 없다");
    }

    /** 테이블 → 외래 키가 가리키는 테이블. {@code baseline-schema-fingerprint.txt} 의 {@code FOREIGN KEY} 줄에서 읽는다. */
    private static Map<String, Set<String>> foreignKeys() throws IOException {
        Map<String, Set<String>> references = new TreeMap<>();
        Pattern foreignKey = Pattern.compile("^CONSTRAINT ([a-z_0-9]+) \\S+ FOREIGN KEY \\([^)]*\\) REFERENCES ([a-z_0-9]+)\\(");
        for (String line : Files.readAllLines(Path.of("src/test/resources/baseline-schema-fingerprint.txt"))) {
            Matcher matcher = foreignKey.matcher(line);
            if (matcher.find()) {
                references.computeIfAbsent(matcher.group(1), table -> new TreeSet<>()).add(matcher.group(2));
            }
        }
        assertThat(references).as("지문에서 외래 키를 읽었다").isNotEmpty();
        return references;
    }

    /** 줄바꿈과 그 뒤 들여쓰기를 빈칸 하나로 읽은 파일 글. */
    private static String text(String file) {
        return TEXTS.computeIfAbsent(file, key -> {
            try {
                return Files.readString(ROOT.resolve(key), StandardCharsets.UTF_8).replaceAll("\\n[ \\t]*", " ");
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
    }

    private static BigDecimal parse(String value) {
        Integer word = KOREAN_NUMBERS.get(value);
        return word != null ? BigDecimal.valueOf(word) : new BigDecimal(value.replace(",", ""));
    }

    private static long exact(long value, long unit) {
        if (value % unit != 0) {
            throw new IllegalStateException(value + " 은 " + unit + " 로 나누어떨어지지 않는다 — 스펙이 쓰는 단위를 바꾼다");
        }
        return value / unit;
    }

    private static long minutes(Duration duration) {
        return exact(duration.toSeconds(), 60);
    }

    private static long days(Duration duration) {
        return exact(duration.toSeconds(), 24 * 60 * 60);
    }

    private static String size(AdSize size) {
        return size.width() + "x" + size.height();
    }

    private static List<String> dbValues(PgEnum[] values) {
        return Arrays.stream(values).map(PgEnum::dbValue).toList();
    }

    /** 공개하지 않은 상수. 이름이 바뀌면 여기서 실패한다. */
    private static Object constant(String className, String field) {
        try {
            Field declared = Class.forName(PACKAGE + className).getDeclaredField(field);
            declared.setAccessible(true);
            return declared.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(className + "." + field + " 를 읽지 못했다 — 옮겼으면 묶음도 옮긴다", e);
        }
    }

    private static long longConstant(String className, String field) {
        return ((Number) constant(className, field)).longValue();
    }

    /**
     * 설정 키의 기본값({@code ${KEY:기본값}}). {@code src/main/java} 와 {@code application*.yml} 에서 찾고, 쓰는 곳마다 기본값이
     * 같아야 한다.
     */
    private static String property(String key) {
        Set<String> defaults = new TreeSet<>();
        try (Stream<Path> files = Stream.concat(Files.walk(JAVA_ROOT), Files.list(RESOURCES))) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")
                    || path.getFileName().toString().matches("application.*\\.ya?ml")).toList()) {
                Matcher matcher = PLACEHOLDER.matcher(Files.readString(file, StandardCharsets.UTF_8));
                while (matcher.find()) {
                    if (matcher.group(1).equals(key)) {
                        defaults.add(matcher.group(2));
                    }
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        assertThat(defaults).as("%s 의 기본값은 한 곳의 값이다", key).hasSize(1);
        return defaults.iterator().next();
    }
}
