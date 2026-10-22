package com.acttub.actingapi.feature.coach.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.coach.app.CoachEngine;
import com.acttub.actingapi.feature.coach.app.CoachProfile;
import com.acttub.actingapi.feature.coach.app.CoachMemory;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.ConversationClosedListener;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.coach.app.NoteWriter;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 0.1.0 코치 대화의 조립. 행동 규칙을 가진 {@link CoachEngine} 과 노트 생성기({@link ReportEngine})는 그대로
 * 쓰고 저장만 새 표로 간다 — 이 설정이 그 둘을 새 저장소와 잇는다.
 */
@Configuration
class ConversationConfiguration {

    @Bean
    NoteWriter noteWriter(ConversationRepository conversations, ReportEngine reports) {
        return new NoteWriter(conversations, reports);
    }

    /**
     * 배우 일지(practice.journal, SOMA-720). 자동 칸은 연습 노트와 같은 생성기(노트용 키의 {@code report()})로 만든다.
     */
    @Bean
    com.acttub.actingapi.feature.coach.app.JournalService journalService(
            com.acttub.actingapi.feature.coach.app.JournalRepository journals,
            ConversationRepository conversations,
            com.acttub.actingapi.integration.llm.OpenAiTextGenerators generators,
            com.acttub.actingapi.platform.observability.LlmTelemetry telemetry,
            com.fasterxml.jackson.databind.ObjectMapper json,
            Clock clock) {
        return new com.acttub.actingapi.feature.coach.app.JournalService(
                journals, conversations, generators.report(), telemetry, json, clock, java.util.UUID::randomUUID);
    }

    /**
     * 종료 알림은 선택이다 — {@code memory} 가 구현을 내지만, 없어도 대화는 돌아야 한다
     * ({@code AnalysisCompletionListener} 와 같은 형태).
     */
    @Bean
    ConversationService conversationService(
            ConversationRepository conversations,
            CoachEngine coach,
            NoteWriter notes,
            Clock clock,
            ObjectProvider<ConversationClosedListener> closedListener,
            CoachProfile profiles,
            CoachMemory memory,
            FailureReporter failureReporter) {
        return new ConversationService(conversations, coach, notes, clock, closedListener.getIfAvailable(),
                profiles, memory, failureReporter);
    }

    /** 분석이 끝나면 첫 질문을 미리 쓴다(SOMA-780). false 면 예전처럼 앱의 시작 요청이 올 때 쓴다(롤백). */
    @Bean(destroyMethod = "close")
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "ACTTUB_COACH_FIRST_QUESTION_PREWRITE", havingValue = "true", matchIfMissing = true)
    com.acttub.actingapi.feature.coach.app.CoachFirstQuestionPrewriter coachFirstQuestionPrewriter(
            ConversationService conversations) {
        return new com.acttub.actingapi.feature.coach.app.CoachFirstQuestionPrewriter(conversations);
    }
}
