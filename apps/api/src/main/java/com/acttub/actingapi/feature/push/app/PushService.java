package com.acttub.actingapi.feature.push.app;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisCompletionListener;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
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
    private final FailureReporter failureReporter;

    public PushService(PushTokenRepository tokens, PushSender sender, FailureReporter failureReporter) {
        this.tokens = tokens;
        this.sender = sender;
        this.failureReporter = failureReporter;
    }

    /**
     * 서버 푸시 둘을 다 꺼 둔 회원의 토큰은 받지 않는다(조용히 지나간다). 그러지 않으면 한 기기에서 둘을
     * 끈 뒤 다른 기기가 앱을 여는 것만으로 토큰이 되살아난다. 거르는 일은 저장과 한 트랜잭션이어야 해서
     * 저장소가 한다({@link PushTokenRepository#register}).
     */
    public void register(UUID userId, String token, String platform) {
        tokens.register(userId, token, platform);
    }

    public void unregister(String token) {
        tokens.unregister(token);
    }

    /**
     * 분석이 끝난 순간 그 사람의 토큰 전부에 한 번 보낸다. <b>어떤 실패도 밖으로 내보내지 않는다</b> — 알림은
     * 부가 기능이고 분석 완료 처리는 그대로 끝나야 한다. "등록되지 않은 기기"로 답이 온 토큰은 지운다.
     */
    @Override
    public void onAnalysisComplete(UUID sessionId) {
        try {
            notifyAnalysisDone(sessionId);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("PushService.onAnalysisComplete"));
        }
    }

    private void notifyAnalysisDone(UUID sessionId) {
        List<String> targets = tokens.analysisDoneTargets(sessionId);
        if (targets.isEmpty()) {
            return;
        }
        List<PushMessage> messages = targets.stream()
                .map(token -> new PushMessage(
                        token,
                        "분석이 끝났어요",
                        "질문이 준비됐어요. 이어서 확인해 볼까요?",
                        Map.of("sessionId", sessionId.toString())))
                .toList();
        sender.send(messages).forEach(tokens::unregister);
    }
}
