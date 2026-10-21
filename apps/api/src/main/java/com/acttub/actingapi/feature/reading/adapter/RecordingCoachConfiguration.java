package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.reading.adapter.pron.HttpRecordingSounds;
import com.acttub.actingapi.feature.reading.adapter.voice.GeminiRecordingCoachModel;
import com.acttub.actingapi.feature.reading.app.RecordingCoachModel;
import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository;
import com.acttub.actingapi.feature.reading.app.RecordingCoachService;
import com.acttub.actingapi.feature.reading.app.RecordingSounds;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 녹음 코치 (reading.recording-coach, 실험, SOMA-791). {@code ACTTUB_RECORDING_COACH_ENABLED=true} 일 때만 서비스와
 * 경로({@code /v2/recording-coaches})가 생긴다 — 끄면 경로가 없어 404 이고, OpenAPI 스냅샷에도 들지 않는다(관리용 경로와
 * 같은 조건부 빈).
 *
 * <p>Client 는 한정자 없이 받는다 — @Primary 인 코칭 키 클라이언트(GEMINI_COACH_API_KEY)가 들어온다. 모델은
 * {@code ACTTUB_RECORDING_COACH_MODEL}, 비면 영상 코치와 같은 {@code GEMINI_MODEL}.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = RecordingCoachConfiguration.SWITCH, havingValue = "true")
public class RecordingCoachConfiguration {

    public static final String SWITCH = "ACTTUB_RECORDING_COACH_ENABLED";

    @Bean
    RecordingCoachModel recordingCoachModel(
            Client client,
            ObjectProvider<ObjectStorage> storage,
            @Value("${ACTTUB_RECORDING_COACH_MODEL:${GEMINI_MODEL:gemini-3-flash-preview}}") String model,
            FailureReporter failures) {
        return new GeminiRecordingCoachModel(client, storage::getObject, model, failures);
    }

    @Bean
    RecordingCoachService recordingCoachService(
            RecordingCoachRepository coaches, RecordingCoachModel model, RecordingSounds sounds, Clock clock) {
        return new RecordingCoachService(coaches, model, sounds, clock);
    }

    /** 소리 재기는 발음 채점 서비스(apps/pron)의 {@code /measure} 를 쓴다. 주소가 없으면 재지 않고 코치는 질문만 한다. */
    @Bean
    RecordingSounds recordingSounds(
            @Value("${PRON_SCORER_URL:}") String scorerUrl, ObjectProvider<ObjectStorage> storage, ObjectMapper mapper) {
        if (scorerUrl == null || scorerUrl.isBlank()) {
            return RecordingSounds.NONE;
        }
        return new HttpRecordingSounds(scorerUrl, storage::getObject, mapper);
    }
}
