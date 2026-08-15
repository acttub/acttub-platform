package com.acttub.actingapi.analysis;

import com.acttub.actingapi.media.GeminiVideoCompressor;
import com.acttub.actingapi.observation.ObservationAnalyzer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
            AudioTranscriber audioTranscriber) {
        return new SummaryAnalyzer(
                durationProbe, compressor, observations, audioExtractor, audioTranscriber);
    }
}
