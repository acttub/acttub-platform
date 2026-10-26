package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;

import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository;
import com.acttub.actingapi.feature.reading.app.CloudVoiceService;
import com.acttub.actingapi.feature.reading.app.CloudVoiceSettings;
import com.acttub.actingapi.feature.reading.app.CloudVoiceStorage;
import com.acttub.actingapi.feature.reading.adapter.decision.OpenRouterLineDecider;
import com.acttub.actingapi.feature.reading.app.LineDecider;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository;
import com.acttub.actingapi.feature.reading.app.MemorizationService;
import com.acttub.actingapi.feature.reading.app.ReadingExampleRepository;
import com.acttub.actingapi.feature.reading.app.ReadingExampleService;
import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.RecordingPlayback;
import com.acttub.actingapi.feature.reading.app.RecordingRepository;
import com.acttub.actingapi.feature.reading.app.RecordingService;
import com.acttub.actingapi.feature.reading.app.RecordingStorage;
import com.acttub.actingapi.feature.reading.app.ScriptFileCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptFileStorage;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository;
import com.acttub.actingapi.feature.reading.app.ScriptImportService;
import com.acttub.actingapi.feature.reading.app.ScriptPlan;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import com.acttub.actingapi.feature.reading.app.ScriptUploadService;
import com.acttub.actingapi.feature.reading.app.SessionRatingService;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionService;
import com.acttub.actingapi.feature.reading.app.VoiceModelService;
import com.acttub.actingapi.feature.reading.app.VoiceModelStorage;
import com.acttub.actingapi.feature.reading.app.VoiceSynthesizer;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.integration.llm.OpenAiTextGenerators;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.feature.reading.adapter.voice.GeminiVoiceSynthesizer;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 서비스의 조립. 정리 장부는 장부의 주인인 {@code profile} 이 구현한 포트로 받는다. 음성 변환기는 영상 파이프라인과
 * 같은 ffmpeg 실행이며 테스트가 다른 실행기를 끼울 수 있게 빈으로 둔다.
 */
@Configuration
class ReadingConfiguration {

    @Bean
    CloudVoiceSettings cloudVoiceSettings(
            @Value("${GEMINI_TTS_MODEL:}") String model,
            @Value("${GEMINI_TTS_API_KEY:}") String ttsKey,
            @Value("${GEMINI_API_KEY:}") String legacyKey,
            @Value("${READING_VOICE_FREE_UNTIL:2026-10-31T23:59:59+09:00}") String freeUntil,
            @Value("${READING_VOICE_DAILY_LINE_CAP:300}") int dailyCap,
            @Value("${READING_VOICE_MONTHLY_LINE_CAP:75000}") int monthlyCap) {
        return new CloudVoiceSettings(model, com.acttub.actingapi.integration.llm.ApiKeys.firstNonBlank(ttsKey, legacyKey),
                freeUntil == null || freeUntil.isBlank() ? null : OffsetDateTime.parse(freeUntil), dailyCap, monthlyCap);
    }

    /** 리딩 기기 목소리 모델 fp16 묶음 위치(SOMA-747). 비우면 앱은 원본 fp32 를 받는다. */
    @Bean
    VoiceModelService voiceModelService(VoiceModelStorage storage,
            @Value("${READING_VOICE_MODEL_PREFIX:}") String prefix) {
        return new VoiceModelService(storage, prefix);
    }

    @Bean
    VoiceSynthesizer voiceSynthesizer(@Qualifier("geminiTtsClient") Client client, CloudVoiceSettings settings) {
        return new GeminiVoiceSynthesizer(client, settings.model());
    }

    @Bean
    CloudVoiceService cloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock) {
        return new CloudVoiceService(repository, storage, synthesizer, settings, clock);
    }

    @Bean
    ScriptService scriptService(
            ScriptRepository scripts, ReadingRecordingCleanup cleanup, CanonicalJson canonical, Clock clock,
            ObjectProvider<ScriptPlan> plan) {
        // 무료 대본 한도(SOMA-818)는 결제 도메인이 구현한다. 그 빈이 없는 조립에서는 한도가 없다.
        return new ScriptService(scripts, cleanup, canonical, clock, plan.getIfAvailable(() -> ScriptPlan.UNLIMITED));
    }

    @Bean
    ReadingExampleService readingExampleService(ReadingExampleRepository examples, ScriptService scripts, VoiceModelStorage storage) {
        return new ReadingExampleService(examples, scripts, storage);
    }

    @Bean
    ScriptUploadService scriptUploadService(ScriptUploadRepository uploads, ScriptImportRepository imports,
            ScriptFileStorage storage, ScriptFileCleanup cleanup, Clock clock) {
        return new ScriptUploadService(uploads, imports, storage, cleanup, clock, new ScriptUploadService.ReadLimits(
                ScriptFileRules.READ_CONCURRENCY, ScriptFileRules.READ_WAIT, ScriptFileRules.READ_TIMEOUT));
    }

    @Bean
    ScriptImportService scriptImportService(ScriptImportRepository imports, ScriptUploadService uploads,
            CanonicalJson canonical, Clock clock, ObjectProvider<ScriptPlan> plan) {
        return new ScriptImportService(imports, uploads, canonical, clock, plan.getIfAvailable(() -> ScriptPlan.UNLIMITED));
    }

    /** 줄 두 번째 의견(SOMA-663 J1). 키가 없으면 그 단계를 건너뛴다. */
    @Bean
    ScriptSplitWorker scriptSplitWorker(AiJobLedger ledger, ScriptImportRepository imports, OpenAiTextGenerators generators,
            LlmTelemetry telemetry, FailureReporter failures, Clock clock, ObjectMapper json,
            @Value("${OPENROUTER_SCRIPT_REVIEW_API_KEY:}") String reviewKey,
            @Value("${SCRIPT_REVIEW_MODEL:" + ScriptSplitRules.REVIEW_MODEL + "}") String reviewModel) {
        LineDecider decider = reviewKey.isBlank() ? null
                : new OpenRouterLineDecider(json,
                reviewModel.isBlank() ? ScriptSplitRules.REVIEW_MODEL : reviewModel.strip(), reviewKey.strip(), Duration.ofSeconds(20),
                ScriptSplitRules.REVIEW_IN_FLIGHT);
        return new ScriptSplitWorker(ledger, imports, generators.scriptSplit(), telemetry, failures, clock, decider,
                ScriptSplitRules.REVIEW, ScriptSplitRules.SAME_SPEAKER_MIN);
    }

    @Bean
    SessionService sessionService(
            SessionRepository sessions, ReadingRecordingCleanup cleanup, RecordingPlayback playback, Clock clock) {
        return new SessionService(sessions, cleanup, playback, clock);
    }

    @Bean
    SessionRatingService sessionRatingService(SessionRatingStore store, Clock clock) {
        return new SessionRatingService(store, clock);
    }

    @Bean
    MemorizationService memorizationService(MemorizationRepository memorization, Clock clock) {
        return new MemorizationService(memorization, clock);
    }

    @Bean
    RecordingPlayback recordingPlayback(RecordingStorage storage, Clock clock) {
        return new RecordingPlayback(storage, clock);
    }

    @Bean
    @ConditionalOnMissingBean
    AudioTranscoder audioTranscoder() {
        return new AudioTranscoder();
    }

    @Bean
    RecordingService recordingService(
            RecordingRepository recordings,
            RecordingStorage storage,
            AudioTranscoder transcoder,
            RecordingPlayback playback,
            ReadingRecordingCleanup cleanup,
            Clock clock) {
        return new RecordingService(recordings, storage, transcoder, playback, cleanup, clock);
    }
}
