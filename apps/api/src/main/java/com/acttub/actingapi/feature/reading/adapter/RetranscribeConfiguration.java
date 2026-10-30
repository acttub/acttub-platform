package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.feature.reading.app.PronunciationAudio;
import com.acttub.actingapi.feature.reading.app.RetranscribeAudio;
import com.acttub.actingapi.feature.reading.app.RetranscribeRepository;
import com.acttub.actingapi.feature.reading.app.RetranscribeSettings;
import com.acttub.actingapi.feature.reading.app.RetranscribeWorker;
import com.acttub.actingapi.integration.media.AudioPeak;
import com.acttub.actingapi.integration.observation.SpeechAnalyzer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 녹음 서버 다시 받아쓰기 조립. {@code READING_RETRANSCRIBE_ENABLED}(기본 false)가 켜져야 줄 세우고 처리한다.
 * 기준 소리 {@code READING_RETRANSCRIBE_MIN_PEAK_DB}는 녹음의 순간 최댓값(sample peak)이다. 기본 -30dBFS — 2026-10-30 빈 전사
 * 녹음 37개를 50ms 평균 세기로 재 보니 목소리가 든 것은 -9~-27, 무음은 -37 아래였고 순간 최댓값은 평균 세기보다 몇~십여 dB
 * 높다. 하루 호출 한도 {@code READING_RETRANSCRIBE_DAILY_LIMIT}(기본 400).
 */
@Configuration
class RetranscribeConfiguration {

    @Bean
    RetranscribeSettings retranscribeSettings(
            @Value("${READING_RETRANSCRIBE_ENABLED:false}") boolean enabled,
            @Value("${READING_RETRANSCRIBE_MIN_PEAK_DB:-30}") double minPeakDb,
            @Value("${READING_RETRANSCRIBE_DAILY_LIMIT:400}") int dailyLimit,
            @Value("${READING_RETRANSCRIBE_MAX_DURATION_MS:60000}") int maxDurationMs,
            @Value("${READING_RETRANSCRIBE_LEASE_SECONDS:300}") long leaseSeconds,
            @Value("${READING_RETRANSCRIBE_MAX_ATTEMPTS:2}") int maxAttempts) {
        return new RetranscribeSettings(enabled, minPeakDb, dailyLimit, maxDurationMs, Duration.ofSeconds(leaseSeconds),
                maxAttempts);
    }

    @Bean
    RetranscribeAudio retranscribeAudio(SpeechAnalyzer speechAnalyzer) {
        return new MediaRetranscribeAudio(new AudioPeak(), speechAnalyzer);
    }

    @Bean
    RetranscribeWorker retranscribeWorker(RetranscribeRepository queue, PronunciationAudio storage, RetranscribeAudio audio,
            RetranscribeSettings settings, Clock clock) {
        return new RetranscribeWorker(queue, storage, audio, settings, clock);
    }
}
