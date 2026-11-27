package com.acttub.actingapi.feature.push.app;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisCompletionListener;
import com.acttub.actingapi.feature.reading.app.PronunciationReportListener;
import com.acttub.actingapi.feature.reading.app.ScriptSplitListener;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
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
public class PushService implements AnalysisCompletionListener, ScriptSplitListener, PronunciationReportListener {

    /** 아는 플랫폼만 받는다. 밖의 값은 등록을 조용히 거르지 않고 요청 검증(web)이 막는다. */
    public static final Set<String> PLATFORMS = Set.of("ios", "android");

    private final PushTokenRepository tokens;
    private final PushOpenRepository opens;
    private final PushSender sender;
    private final FailureReporter failureReporter;
    /** 발음 보고서 알림을 눌러 그 보고서로 갈 수 있는 첫 앱 판(SOMA-1169). */
    private final String pronunciationMinAppVersion;

    public PushService(
            PushTokenRepository tokens,
            PushOpenRepository opens,
            PushSender sender,
            FailureReporter failureReporter,
            @Value("${PRON_PUSH_MIN_APP_VERSION:1.1.4}") String pronunciationMinAppVersion) {
        this.tokens = tokens;
        this.opens = opens;
        this.sender = sender;
        this.failureReporter = failureReporter;
        this.pronunciationMinAppVersion = pronunciationMinAppVersion == null ? "" : pronunciationMinAppVersion.strip();
    }

    /**
     * 서버 푸시 셋을 다 꺼 둔 회원의 토큰은 받지 않는다(조용히 지나간다). 그러지 않으면 한 기기에서 셋을
     * 끈 뒤 다른 기기가 앱을 여는 것만으로 토큰이 되살아난다. 거르는 일은 저장과 한 트랜잭션이어야 해서
     * 저장소가 한다({@link PushTokenRepository#register}).
     */
    public void register(UUID userId, String token, String platform, String appVersion) {
        tokens.register(userId, token, platform, appVersion);
    }

    /** 푸시를 눌러 앱을 연 한 번을 남긴다. 보낸 기록과 잇기 위한 측정이라 이 외의 일은 하지 않는다. */
    public void recordOpen(UUID userId, String kind, String reminderKind, String templateId, String platform,
            String appVersion) {
        opens.record(userId, kind, reminderKind, templateId, platform, appVersion);
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
        List<PushTarget> targets = tokens.analysisDoneTargets(sessionId);
        if (targets.isEmpty()) {
            return;
        }
        List<PushMessage> messages = targets.stream()
                .map(target -> new PushMessage(
                        target.token(),
                        target.korean() ? "분석이 끝났어요" : "Your analysis is ready",
                        target.korean()
                                ? "질문이 준비됐어요. 이어서 확인해 볼까요?"
                                : "The coach has questions waiting. Shall we pick it up?",
                        // 앱이 이 두 키로 완료 푸시를 알아보고 그 회차를 연다(analysisPushTarget).
                        Map.of("kind", "analysis_complete", "practice_id", sessionId.toString())))
                .toList();
        sender.send(messages).forEach(tokens::unregister);
    }

    /**
     * 대본 나누기가 끝난 순간 그 사람의 토큰 전부에 한 번 보낸다(SOMA-960). 잠금 화면에 보이므로 제목·대사는 싣지 않는다.
     * 분석 완료와 같이 어떤 실패도 밖으로 내보내지 않는다.
     */
    @Override
    public void onScriptSplit(UUID userId, UUID scriptId) {
        try {
            List<PushTarget> targets = tokens.scriptSplitTargets(userId);
            if (targets.isEmpty()) {
                return;
            }
            List<PushMessage> messages = targets.stream()
                    .map(target -> new PushMessage(
                            target.token(),
                            target.korean() ? "대본을 다 나눴어요" : "Your script is ready",
                            target.korean()
                                    ? "배역 목소리를 정하고 리딩을 시작해 볼까요?"
                                    : "Pick the voices and start reading.",
                            // 앱이 이 두 키로 알아보고 그 대본의 목소리 정하기를 연다(reminderTarget).
                            Map.of("kind", "script_split_complete", "script_id", scriptId.toString())))
                    .toList();
            sender.send(messages).forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("PushService.onScriptSplit"));
        }
    }

    /**
     * 오래 걸린 발음 보고서가 다 된 순간 그 사람의 새 앱 단말에 한 번 보낸다(SOMA-1169). 잠금 화면에 보이므로 대사·점수는 싣지 않는다.
     * 다른 완료 알림과 같이 어떤 실패도 밖으로 내보내지 않는다.
     */
    @Override
    public void onPronunciationReportReady(UUID userId, UUID sessionId) {
        try {
            List<PushTarget> targets = tokens.pronunciationReportTargets(userId, pronunciationMinAppVersion);
            if (targets.isEmpty()) {
                return;
            }
            List<PushMessage> messages = targets.stream()
                    .map(target -> new PushMessage(
                            target.token(),
                            target.korean() ? "발음 보고서가 나왔어요" : "Your pronunciation report is ready",
                            target.korean()
                                    ? "방금 한 리딩에서 또렷하게 들린 소리와 다시 볼 어절을 확인해 보세요."
                                    : "See which sounds came through clearly in your reading.",
                            // 앱이 이 두 키로 알아보고 그 회차의 발음 보고서를 연다(reminderTarget).
                            Map.of("kind", "pronunciation_report_ready", "session_id", sessionId.toString())))
                    .toList();
            sender.send(messages).forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("PushService.onPronunciationReportReady"));
        }
    }

    /**
     * 새 1:1 메시지를 받는 사람의 단말 전부에 보낸다(SOMA-1039). 같은 대화는 1분에 한 번만 오도록 부르는 쪽(message)이 거른다.
     * 잠금 화면에 보이므로 본문은 싣지 않고 보낸 사람 이름만 적는다. 다른 알림과 같이 어떤 실패도 밖으로 내보내지 않는다.
     */
    public void onDirectMessage(UUID recipientId, UUID conversationId, String senderName) {
        try {
            List<PushTarget> targets = tokens.directMessageTargets(recipientId);
            if (targets.isEmpty()) {
                return;
            }
            List<PushMessage> messages = targets.stream()
                    .map(target -> new PushMessage(
                            target.token(),
                            target.korean() ? "새 메시지" : "New message",
                            target.korean()
                                    ? senderName + "님이 메시지를 보냈어요."
                                    : senderName + " sent you a message.",
                            // 앱이 이 두 키로 알아보고 그 대화를 연다(pushOpenTarget).
                            Map.of("kind", "direct_message", "conversation_id", conversationId.toString())))
                    .toList();
            sender.send(messages).forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("PushService.onDirectMessage"));
        }
    }
}
