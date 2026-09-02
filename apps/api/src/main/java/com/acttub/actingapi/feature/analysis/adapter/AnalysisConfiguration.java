package com.acttub.actingapi.feature.analysis.adapter;

import com.acttub.actingapi.feature.analysis.adapter.media.FfmpegAudioExtractor;
import com.acttub.actingapi.feature.analysis.adapter.media.OpenAiAudioTranscriber;
import com.acttub.actingapi.feature.analysis.adapter.media.VideoDurationProbe;
import com.acttub.actingapi.feature.analysis.app.AnalysisProcessor;
import com.acttub.actingapi.feature.analysis.app.AudioExtractor;
import com.acttub.actingapi.feature.analysis.app.AudioTranscriber;
import com.acttub.actingapi.feature.analysis.app.SummaryAnalyzer;
import com.acttub.actingapi.feature.analysis.app.VideoCompressor;
import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.acttub.actingapi.integration.observation.ObservationAnalyzer;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 분석 체인의 배선. 여기 빈들의 소비자는 전부 이 클래스 안에서 닫힌다 —
 * {@code summaryAnalyzer} 하나가 나머지 넷을 받고, 그것을 받는 것이 {@code AnalysisWorker} 다.
 *
 * <p>📌 한때 이 설정 전체를 프로파일로 걷어내 스텁으로 갈아끼우는 모드가 있었지만
 * (`SOMA-403` 4단계에서 사라진 {@code contract} 프로파일), 대체를 다시 만든다면
 * {@code GeminiConfiguration} 의 설명을 먼저 읽는다.
 */
@Configuration(proxyBeanMethods = false)
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
            AudioTranscriber audioTranscriber,
            FailureReporter failureReporter) {
        return new SummaryAnalyzer(
                durationProbe,
                compressor,
                observations,
                audioExtractor,
                audioTranscriber,
                failureReporter);
    }
}
