package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;
import java.time.Duration;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.reading.adapter.pron.HttpPronunciationScorer;
import com.acttub.actingapi.feature.reading.app.PronunciationAudio;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.app.PronunciationReportService;
import com.acttub.actingapi.feature.reading.app.PronunciationScorer;
import com.acttub.actingapi.feature.reading.app.PronunciationSettings;
import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.feature.reading.app.VoicePlan;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 발음 보고서(SOMA-606) 조립. 켜는 값은 셋이다 — {@code PRON_REPORT_ENABLED}(기본 false),
 * {@code PRON_REPORT_ALLOWED_USERS}(Pro 가 아니어도 받는 사용자 id, 쉼표로 이음), {@code PRON_SCORER_URL}(채점 서비스 주소).
 * 켜져 있으면 Pro 회원은 목록과 상관없이 받는다 — Pro 판정은 리딩 고품질 목소리와 같은 결제 판정(VoicePlan)을 쓴다.
 */
@Configuration
class PronunciationConfiguration {

    @Bean
    PronunciationSettings pronunciationSettings(
            @Value("${PRON_REPORT_ENABLED:false}") boolean enabled,
            @Value("${PRON_REPORT_ALLOWED_USERS:}") String allowed,
            @Value("${PRON_SCORER_URL:}") String scorerUrl,
            @Value("${PRON_REPORT_LEASE_SECONDS:600}") long leaseSeconds,
            @Value("${PRON_REPORT_MAX_ATTEMPTS:3}") int maxAttempts) {
        return new PronunciationSettings(enabled, parseUsers(allowed), scorerUrl, Duration.ofSeconds(leaseSeconds), maxAttempts);
    }

    @Bean
    PronunciationScorer pronunciationScorer(PronunciationSettings settings, ObjectMapper mapper) {
        return new HttpPronunciationScorer(settings.running() ? settings.scorerUrl() : "http://pron.invalid", mapper);
    }

    @Bean
    PronunciationReportService pronunciationReportService(PronunciationReportRepository reports, PronunciationSettings settings,
            ObjectProvider<VoicePlan> plan, Clock clock) {
        VoicePlan pro = plan.getIfAvailable(() -> VoicePlan.NONE);
        return new PronunciationReportService(reports, settings, pro::pro, clock);
    }

    @Bean
    PronunciationWorker pronunciationWorker(PronunciationReportRepository reports, PronunciationScorer scorer,
            PronunciationAudio audio, PronunciationSettings settings, Clock clock) {
        return new PronunciationWorker(reports, scorer, audio, settings, clock);
    }

    static Set<UUID> parseUsers(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(UUID::fromString)
                .collect(Collectors.toUnmodifiableSet());
    }
}
