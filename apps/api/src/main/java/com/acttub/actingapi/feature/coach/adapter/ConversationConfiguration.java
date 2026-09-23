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
 * 1.0.0 코치 대화의 조립. 행동 규칙을 가진 {@link CoachEngine} 과 노트 생성기({@link ReportEngine})는 그대로
 * 쓰고 저장만 새 표로 간다 — 이 설정이 그 둘을 새 저장소와 잇는다.
 */
@Configuration
class ConversationConfiguration {

    @Bean
    NoteWriter noteWriter(ConversationRepository conversations, ReportEngine reports) {
        return new NoteWriter(conversations, reports);
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
}
