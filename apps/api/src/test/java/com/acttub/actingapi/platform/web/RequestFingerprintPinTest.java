package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.Clock;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.challenge.app.AiReportService;
import com.acttub.actingapi.feature.challenge.app.ChallengeService;
import com.acttub.actingapi.feature.challenge.app.EntryService;
import com.acttub.actingapi.feature.challenge.app.ReactionService;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import com.acttub.actingapi.feature.reading.app.CloudVoiceService;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.video.app.VideoService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/**
 * 요청 지문과 토큰 해시가 저장된 값과 글자 그대로 같은지 고정한다. 지문이 바뀌면 이미 저장된 요청의 재전송이
 * {@code request_fingerprint_mismatch} 로 갈라지고, 토큰 해시가 바뀌면 저장된 refresh 토큰을 못 찾는다.
 *
 * <p>각 자리의 지문 함수는 private·package-private 이라 반사로 부른다. 입력 바이트를 만드는 방식(정규 JSON·
 * {@code |} 로 이은 문자열)은 자리마다 다르고, 그 차이까지 여기서 함께 고정된다.
 */
class RequestFingerprintPinTest {
    private static final UUID A = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final UUID B = UUID.fromString("00000000-0000-4000-8000-000000000002");
    private final CanonicalJson canonical = new CanonicalJson(new ObjectMapper());
    private final Clock clock = Clock.systemUTC();

    @Test
    void canonicalJsonFingerprintsStayTheSame() throws Exception {
        assertThat(call(new AiReportService(null, canonical, clock), "fingerprint",
                List.of("challenge_report", A.toString())))
                .isEqualTo("dab96fcddacb255fc6ef3ddc4717e571a14fee97da4673d13eb2619da32038b8");
        assertThat(call(new ChallengeService(null, canonical, clock), "fingerprint",
                new ChallengeService.Draft("대사", "작품", "배역", null, 7)))
                .isEqualTo("2d02acaba42988100014fe7ef67b42d7ed1e08612f64f61901d866a54de2e73e");
        assertThat(call(new EntryService(null, null, canonical, clock), "fingerprint",
                Arrays.asList(A.toString(), B.toString(), "소감 한 줄", "public")))
                .isEqualTo("234eaa67c69cde686e0a744f9eefb5f7ba9ccd732f29dff0c842a36019ec1c8f");
        assertThat(call(new ReactionService(null, null, canonical, clock), "fingerprint",
                Arrays.asList("entry", A.toString(), "spam", null)))
                .isEqualTo("c877a9e26315da09e8d91680c782b4fecd46e605af98eb2bef4d0c8617cd4c40");
        assertThat(call(new ScriptService(null, null, canonical, clock), "fingerprint", ScriptDraft.class,
                new ScriptDraft("제목", "원문\n둘째 줄", "paste", List.of("철수", "영희"),
                        List.of(new ScriptDraft.Line(1, "dialogue", 0, "안녕"),
                                new ScriptDraft.Line(2, "direction", null, "(웃는다)")))))
                .isEqualTo("8987f430175cf7d08477339ac7008953fb302bc88ebbe44db135a71753f3f718");
    }

    @Test
    void joinedStringFingerprintsStayTheSame() throws Exception {
        assertThat(callStatic(VideoService.class, "fingerprint",
                new Class<?>[] {String.class, long.class, int.class}, "video/mp4", 1_234_567L, 42_000))
                .isEqualTo("ba8edfa2602a261ee5d3b3c893b43e00b85bd740714f61c223a40e2c175520fc");
        assertThat(callStatic(PracticeService.class, "fingerprint",
                new Class<?>[] {String.class}, "analyze_retry|" + A))
                .isEqualTo("438b7433fc295221966fcccd9bb152e65125ab491a347ca3dd9ba0106f177850");
        assertThat(callStatic(ConversationService.class, "fingerprint",
                new Class<?>[] {String.class}, "coach_reply|" + A + "|대사 한 줄"))
                .isEqualTo("db5856c3e1b2038f22b3662197eea6d9f276aef3e3eaf23d99943be2fc82d291");
        assertThat(callStatic(CloudVoiceService.class, "hash",
                new Class<?>[] {String.class, String.class, String.class}, "gemini-tts", "Kore", "안녕하세요"))
                // 2026-10-02 저장 형식 판(wav2)을 붙여 일부러 바꿨다 — WAV를 두 번 싸던 캐시를 버리려고.
                .isEqualTo("a17e863c41fb9c5891b833074fc6d6ae082e5903d14e4ba07dfb0a58d4a94841");
        assertThat(Hashing.sha256Hex("memory_update:" + A))
                .isEqualTo("f1da15b8f665e2a09c0cc05a8f80b948e7f1105d7c3d6b4002640c7df77b0abb");
        assertThat(JwtService.hashToken("refresh-token-value"))
                .isEqualTo("e65009f6e0ae9fc204adcb73a208f63c582b7839bde7fe836da36a3df6ae7a85");
    }

    private static Object call(Object target, String name, Object argument) throws Exception {
        return call(target, name, Object.class, argument);
    }

    private static Object call(Object target, String name, Class<?> parameter, Object argument) throws Exception {
        Method method = target.getClass().getDeclaredMethod(name, parameter);
        method.setAccessible(true);
        return method.invoke(target, argument);
    }

    private static Object callStatic(Class<?> type, String name, Class<?>[] parameters, Object... arguments)
            throws Exception {
        Method method = type.getDeclaredMethod(name, parameters);
        method.setAccessible(true);
        return method.invoke(null, arguments);
    }
}
