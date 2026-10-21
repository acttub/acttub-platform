package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;
import com.acttub.actingapi.feature.analysis.app.AnalysisCompletionListener;

/**
 * 분석이 끝나면 첫 질문을 미리 쓴다(SOMA-780, {@link ConversationService#prewriteStart}).
 *
 * <p>10/21 dev 실측: 영상 준비가 올리기 끝에서 끝나 있어도, 앱이 연습을 만든 뒤 약 5초 동안 '분석 중' 화면에서 기다렸다가
 * 첫 질문을 청해서 그 시간에는 아무것도 하지 않았다. 분석 작업 스레드를 막지 않게 뒤에서 돈다.
 */
public final class CoachFirstQuestionPrewriter implements AnalysisCompletionListener, AutoCloseable {
    private final BiConsumer<UUID, UUID> prewrite;
    private final ExecutorService background;

    public CoachFirstQuestionPrewriter(ConversationService conversations) {
        this(conversations::prewriteStart, Executors.newVirtualThreadPerTaskExecutor());
    }

    /** @param prewrite (회차 주인, 회차) 를 받아 첫 질문을 미리 쓴다 */
    CoachFirstQuestionPrewriter(BiConsumer<UUID, UUID> prewrite, ExecutorService background) {
        this.prewrite = prewrite;
        this.background = background;
    }

    @Override
    public void onAnalysisComplete(UUID sessionId) {
        // 주인을 모르면 대화를 열 수 없다 — 앱의 시작 요청이 쓴다.
    }

    @Override
    public void onAnalysisComplete(UUID sessionId, UUID userId) {
        if (sessionId == null || userId == null) return;
        background.execute(() -> prewrite.accept(userId, sessionId));
    }

    @Override
    public void close() {
        background.shutdown();
    }
}
