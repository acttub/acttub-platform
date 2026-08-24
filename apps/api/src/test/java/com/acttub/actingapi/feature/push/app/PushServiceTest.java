package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class PushServiceTest {

    private final RecordingRepository tokens = new RecordingRepository();
    private final RecordingSender sender = new RecordingSender();
    private final PushService service = new PushService(tokens, sender);

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

        // 토큰이 없으면(등록 안 함·권한 거부) 발송 자체를 시도하지 않는다.
        assertThat(sender.sent).isEmpty();
        assertThat(sender.calls).isZero();
    }

    @Test
    void knownPlatformsAreExactlyIosAndAndroid() {
        // 컨트롤러 검증이 이 집합을 본다 — 넓히면 계약(allowableValues)도 함께 넓혀야 한다.
        assertThat(PushService.PLATFORMS).containsExactlyInAnyOrder("ios", "android");
    }

    private static final class RecordingRepository implements PushTokenRepository {
        private List<String> forSession = List.of();

        @Override
        public void register(UUID userId, String token, String platform) {
        }

        @Override
        public void unregister(UUID userId, String token) {
        }

        @Override
        public List<String> tokensForSessionOwner(UUID sessionId) {
            return forSession;
        }
    }

    private static final class RecordingSender implements PushSender {
        private final List<PushMessage> sent = new ArrayList<>();
        private int calls;

        @Override
        public void send(List<PushMessage> messages) {
            calls++;
            sent.addAll(messages);
        }
    }
}
