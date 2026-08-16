package com.acttub.actingapi.analysis;

import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.acttub.actingapi.integration.observation.ObservationAnalyzer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * contract 에서는 서지 않는다 — 여기 빈들의 소비자가 전부 이 클래스 안에서 닫히고
 * ({@code summaryAnalyzer} 하나가 나머지 넷을 받는다), 그 {@code summaryAnalyzer} 를 받을
 * {@code AnalysisWorker} 는 contract 에서 {@code ContractAnalysisProcessor} 를 쓴다.
 * {@code GeminiConfiguration} 의 설명 참조.
 */
@Configuration(proxyBeanMethods = false)
@Profile("!contract")
class AnalysisConfiguration {

    @Bean
    VideoDurationProbe videoDurationProbe() {
        return new VideoDurationProbe();
    }

    @Bean
    VideoCompressor analysisVideoCompressor(GeminiVideoCompressor compressor) {
        return compressor::compress;
    }

    @Bean
    AudioExtractor analysisAudioExtractor() {
        return new FfmpegAudioExtractor();
    }

    @Bean
    AudioTranscriber analysisAudioTranscriber(ObjectMapper mapper) {
        return new OpenAiAudioTranscriber(mapper);
    }

    @Bean
    AnalysisProcessor summaryAnalyzer(
            VideoDurationProbe durationProbe,
            VideoCompressor compressor,
            ObservationAnalyzer observations,
            AudioExtractor audioExtractor,
            AudioTranscriber audioTranscriber) {
        return new SummaryAnalyzer(
                durationProbe, compressor, observations, audioExtractor, audioTranscriber);
    }
}
