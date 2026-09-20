package com.acttub.actingapi.feature.push.app;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisCompletionListener;
import org.springframework.stereotype.Service;

/**
 * 푸시 알림의 규칙. 등록·해제는 멱등하고, 발송은 최선 노력이다.
 *
 * <p>{@link AnalysisCompletionListener} 구현이 이 도메인의 존재 이유다 — 분석은 수 분
 * 걸리고 배우는 그동안 앱을 떠난다. 완료 전이 직후 세션 주인의 단말 전부로
 * "질문이 준비됐어요" 를 보낸다. 토큰이 없으면(등록 안 함·권한 거부) 조용히 아무 일도
 * 하지 않는다.
 */
@Service
public class PushService implements AnalysisCompletionListener {

    /** 아는 플랫폼만 받는다. 밖의 값은 등록을 조용히 거르지 않고 요청 검증(web)이 막는다. */
    public static final Set<String> PLATFORMS = Set.of("ios", "android");

    private final PushTokenRepository tokens;
    private final PushSender sender;

    public PushService(PushTokenRepository tokens, PushSender sender) {
        this.tokens = tokens;
        this.sender = sender;
    }

    public void register(UUID userId, String token, String platform) {
        tokens.register(userId, token, platform);
    }

    public void unregister(UUID userId, String token) {
        tokens.unregister(userId, token);
    }

    @Override
    public void onAnalysisComplete(UUID sessionId) {
        List<PushTarget> targets = tokens.targetsForSessionOwner(sessionId);
        if (targets.isEmpty()) {
            return;
        }
        List<PushMessage> messages = targets.stream()
                .map(target -> new PushMessage(
                        target.token(),
                        korean(target) ? "분석이 끝났어요" : "Your analysis is ready",
                        korean(target)
                                ? "질문이 준비됐어요. 이어서 확인해 볼까요?"
                                : "The coach has questions waiting. Shall we pick it up?",
                        Map.of("sessionId", sessionId.toString())))
                .toList();
        sender.send(messages);
    }

    /**
     * 이 단말이 한국어를 쓰는가. 값이 비었으면(옛 토큰) 한국어로 본다 — 지금까지 쓰던 사람은
     * 전부 한국어 사용자라, 모르면 바꾸지 않는 쪽이 맞다.
     */
    private static boolean korean(PushTarget target) {
        return target.locale() == null || target.locale().isBlank()
                || "ko".equals(target.locale());
    }
}
