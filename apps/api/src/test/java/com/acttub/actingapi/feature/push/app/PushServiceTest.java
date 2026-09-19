package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PushServiceTest {

    private final RecordingRepository tokens = new RecordingRepository();
    private final RecordingSender sender = new RecordingSender();
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final PushService service = new PushService(tokens, sender, failures);

    @Test
    void analysisCompletionSendsToEveryDeviceOfTheSessionOwner() {
        UUID sessionId = UUID.randomUUID();
        tokens.forSession = List.of("ExponentPushToken[aaa]", "ExponentPushToken[bbb]");

        service.onAnalysisComplete(sessionId);

        assertThat(sender.sent).hasSize(2);
        assertThat(sender.sent)
                .extracting(PushMessage::to)
                .containsExactly("ExponentPushToken[aaa]", "ExponentPushToken[bbb]");
        // 알림을 탭한 앱이 어느 연습으로 이어갈지 알 수 있어야 한다.
        assertThat(sender.sent)
                .allSatisfy(message -> assertThat(message.data())
                        .isEqualTo(Map.of("sessionId", sessionId.toString())));
        assertThat(sender.sent.getFirst().title()).isNotBlank();
        assertThat(sender.sent.getFirst().body()).isNotBlank();
    }

    @Test
    void analysisCompletionWithoutTokensSendsNothing() {
        tokens.forSession = List.of();

        service.onAnalysisComplete(UUID.randomUUID());

        // 토큰이 없으면(등록 안 함·권한 거부·분석 완료 토글 꺼짐) 발송 자체를 시도하지 않는다.
        assertThat(sender.sent).isEmpty();
        assertThat(sender.calls).isZero();
    }

    @Test
    @DisplayName("account.notification: Expo 가 \"등록되지 않은 기기\"로 답하면 그 토큰 행을 지운다")
    void unregisteredDevicesAreForgotten() {
        tokens.forSession = List.of("ExponentPushToken[alive]", "ExponentPushToken[gone]");
        sender.unregistered = List.of("ExponentPushToken[gone]");

        service.onAnalysisComplete(UUID.randomUUID());

        assertThat(tokens.removed).containsExactly("ExponentPushToken[gone]");
    }

    @Test
    @DisplayName("account.notification: 발송이 어떻게 실패해도 분석 완료 처리로 예외가 새지 않고, 실패는 보고된다")
    void aFailingSendNeverReachesTheAnalysisCompletion() {
        tokens.forSession = List.of("ExponentPushToken[aaa]");
        sender.failure = new IllegalStateException("expo is down");

        assertThatCode(() -> service.onAnalysisComplete(UUID.randomUUID())).doesNotThrowAnyException();

        assertThat(failures.contexts()).containsExactly("PushService.onAnalysisComplete");
    }

    @Test
    @DisplayName("account.notification: 서버 푸시 둘을 다 꺼 둔 회원의 토큰은 받지 않는다")
    void registrationIsIgnoredWhileBothPushesAreOff() {
        UUID member = UUID.randomUUID();
        tokens.turnedOff = true;
        service.register(member, "ExponentPushToken[aaa]", "ios");
        assertThat(tokens.registered).isEmpty();

        tokens.turnedOff = false;
        service.register(member, "ExponentPushToken[aaa]", "ios");
        assertThat(tokens.registered).containsExactly("ExponentPushToken[aaa]");
    }

    @Test
    void knownPlatformsAreExactlyIosAndAndroid() {
        // 컨트롤러 검증이 이 집합을 본다 — 넓히면 계약(allowableValues)도 함께 넓혀야 한다.
        assertThat(PushService.PLATFORMS).containsExactlyInAnyOrder("ios", "android");
    }

    private static final class RecordingRepository implements PushTokenRepository {
        private List<String> forSession = List.of();
        private boolean turnedOff;
        private final List<String> registered = new ArrayList<>();
        private final List<String> removed = new ArrayList<>();

        @Override
        public void register(UUID userId, String token, String platform) {
            registered.add(token);
        }

        @Override
        public void unregister(String token) {
            removed.add(token);
        }

        @Override
        public List<String> analysisDoneTargets(UUID sessionId) {
            return forSession;
        }

        @Override
        public boolean pushesTurnedOff(UUID userId) {
            return turnedOff;
        }
    }

    private static final class RecordingSender implements PushSender {
        private final List<PushMessage> sent = new ArrayList<>();
        private List<String> unregistered = List.of();
        private RuntimeException failure;
        private int calls;

        @Override
        public List<String> send(List<PushMessage> messages) {
            calls++;
            if (failure != null) {
                throw failure;
            }
            sent.addAll(messages);
            return unregistered;
        }
    }
}
