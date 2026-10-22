package com.acttub.actingapi.feature.coach.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import jakarta.servlet.MultipartConfigElement;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

/** Durable coaching is deployment-controlled; disposable sessions remain dev-only. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "ACTTUB_DIRECT_VIDEO_ENABLED", havingValue = "true")
public class DirectVideoConfiguration {
    // Client 는 한정자 없이 받는다 — @Primary 인 코칭 키 클라이언트(GEMINI_COACH_API_KEY)가 들어온다.
    @Bean
    com.acttub.actingapi.integration.observation.DirectVideoModel directVideoModel(Client client,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model,
            GeminiDirectVideoModel.Hedge coachHedge) {
        return new GeminiDirectVideoModel(client, model).withHedge(coachHedge);
    }

    // 느린 요청 다시 보내기(SOMA-780). 분류·답 쓰기가 이 초 안에 오지 않으면 같은 요청을 한 번 더 보낸다. 0 이면 끈다(롤백).
    // 스트리밍(첫 조각 기준)은 12초다. 10/20 깨진 글자 뒤 실패로 한때 껐지만, 깨진 스트리밍 답을 끊어 다시 쓰는 걸러내기
    // (SOMA-731 #788)가 운영에 들어가 10/21 사용자 결정으로 다시 켰다. 끄려면 ACTTUB_COACH_HEDGE_STREAM_SECONDS=0.
    @Bean
    GeminiDirectVideoModel.Hedge coachHedge(
            @Value("${ACTTUB_COACH_HEDGE_CLASSIFY_SECONDS:6}") double classify,
            @Value("${ACTTUB_COACH_HEDGE_REPLY_SECONDS:20}") double reply,
            @Value("${ACTTUB_COACH_HEDGE_STREAM_SECONDS:12}") double stream) {
        return new GeminiDirectVideoModel.Hedge(seconds(classify), seconds(reply), seconds(stream));
    }

    private static java.time.Duration seconds(double value) {
        return value <= 0 ? java.time.Duration.ZERO : java.time.Duration.ofMillis(Math.round(value * 1000));
    }

    // 한 대화 안에서 올린 영상을 다시 쓴다(SOMA-735). 마지막으로 쓴 뒤 이 분만큼 안 쓰면 지운다. 0 이면 답마다 올리고 지운다(롤백).
    // 올린 파일에 배포 환경 이름표를 달아 배포 뒤에도 이어 쓰고, 아무도 기억하지 않는 이름표 파일은 ORPHAN 분 뒤 지운다(SOMA-780).
    // ACTTUB_COACH_VIDEO_LABELS=false 면 이름표 없이 예전처럼 서버가 꺼질 때 다 지운다(롤백).
    @Bean(destroyMethod = "close")
    com.acttub.actingapi.feature.coach.app.CoachVideoCache coachVideoCache(
            com.acttub.actingapi.integration.observation.DirectVideoModel model, FailureReporter failures, Clock clock,
            @Value("${ACTTUB_COACH_VIDEO_REUSE_MINUTES:20}") int minutes,
            @Value("${ACTTUB_COACH_VIDEO_LABELS:true}") boolean labels,
            @Value("${MONITORING_ENVIRONMENT:local}") String environment,
            @Value("${ACTTUB_COACH_VIDEO_ORPHAN_MINUTES:60}") int orphanMinutes) {
        return new com.acttub.actingapi.feature.coach.app.CoachVideoCache(model,
                java.time.Duration.ofMinutes(Math.max(0, minutes)), clock, failures,
                labels ? environment : null, java.time.Duration.ofMinutes(Math.max(0, orphanMinutes)));
    }

    // 분석 작업이 내려받은 원본으로 첫 질문용 영상을 미리 올린다(SOMA-780). false 면 첫 질문이 직접 올린다(롤백).
    @Bean
    @ConditionalOnProperty(name = "ACTTUB_COACH_VIDEO_WARMUP", havingValue = "true", matchIfMissing = true)
    com.acttub.actingapi.feature.coach.app.CoachVideoWarmup coachVideoWarmup(
            com.acttub.actingapi.integration.observation.DirectVideoModel model,
            com.acttub.actingapi.feature.coach.app.CoachVideoCache videoCache,
            com.acttub.actingapi.integration.storage.ObjectStorage storage,
            // 영상 올리기가 끝난 순간에도 준비를 시작한다(10/21). 코칭하지 않는 영상도 잠깐 올라갔다 10분 안에 지워진다.
            // false 면 예전처럼 분석 작업에서만 시작한다(롤백).
            @Value("${ACTTUB_COACH_VIDEO_UPLOAD_WARMUP:true}") boolean uploadWarmup,
            @Value("${ACTTUB_COACH_WARM_DIR:${java.io.tmpdir}}") String warmDir,
            com.acttub.actingapi.feature.coach.app.CoachLayerOne layerOne) {
        return new com.acttub.actingapi.feature.coach.app.CoachVideoWarmup(model, videoCache,
                uploadWarmup ? storage : null, uploadWarmup ? java.nio.file.Path.of(warmDir) : null).withLayerOne(layerOne);
    }

    // 코칭 1층 관찰 A/B(SOMA-815). 새 연습의 SHARE% 는 분석 작업 때 받아쓰기+관찰 모델을 뒤에서 돌리고 코치 지시문에 칸을 붙인다.
    // 0 이면 모두 끔(롤백). 관찰 모델은 ACTTUB_COACH_LAYER1_MODEL(기본 gemini-4-argon).
    @Bean(destroyMethod = "close")
    com.acttub.actingapi.feature.coach.app.CoachLayerOne coachLayerOne(
            org.springframework.beans.factory.ObjectProvider<com.acttub.actingapi.integration.observation.LayerOneObserver> observer,
            FailureReporter failures,
            @Value("${ACTTUB_COACH_LAYER1_SHARE:50}") int share) {
        return new com.acttub.actingapi.feature.coach.app.CoachLayerOne(observer.getIfAvailable(), share, failures);
    }

    @Bean
    com.acttub.actingapi.feature.coach.app.DirectVideoCoach directVideoCoach(
            com.acttub.actingapi.integration.observation.DirectVideoModel model,
            com.acttub.actingapi.feature.coach.app.CoachVideoSource videos,
            com.acttub.actingapi.integration.storage.ObjectStorage storage,
            FailureReporter failures, com.acttub.actingapi.platform.observability.LlmTelemetry telemetry,
            // 연습 루프가 기본이다 — 운영도 핫픽스(#388)로 이미 켜져 있다. false 를 명시하면 분류·과제 조립 경로로 돌아간다(롤백).
            @Value("${ACTTUB_DIRECT_VIDEO_PRACTICE_LOOP:true}") boolean practiceLoop,
            org.springframework.beans.factory.ObjectProvider<com.acttub.actingapi.feature.coach.app.CoachPersonas> personas,
            // 자문위원 코치 성격 비교(SOMA-622). false 면 모두 기본 성격이다(롤백).
            @Value("${ACTTUB_COACH_PERSONAS:true}") boolean personasEnabled,
            Client client,
            // 코치 모델 비교(SOMA-657). 새 대화의 SHARE% 는 코치 답을 이 모델로 쓴다. SHARE=0 이면 모두 GEMINI_MODEL(롤백).
            // 2026-10-20 끔(SOMA-780): 운영 서버에서 같은 영상으로 재 보니 3.8 이 첫 질문 12.8초·답장 6.8초로 기본 모델(7.4초·4.5초)보다
            // 느렸다. 사용자가 끄기로 정했다. 이미 b 로 시작한 대화도 기본 모델로 이어 간다. 다시 켜려면 SHARE=50.
            @Value("${GEMINI_COACH_MODEL_B:gemini-3.8-flash}") String modelB,
            @Value("${ACTTUB_COACH_MODEL_B_SHARE:0}") int modelBShare,
            org.springframework.beans.factory.ObjectProvider<com.acttub.actingapi.feature.coach.app.CoachFlows> flows,
            // 코치 흐름 비교(SOMA-636). false 면 모두 지금 흐름(A)이다(롤백).
            @Value("${ACTTUB_COACH_FLOW_AB:true}") boolean flowAb,
            com.acttub.actingapi.feature.coach.app.CoachVideoCache videoCache,
            GeminiDirectVideoModel.Hedge coachHedge,
            // 정정에 답하는 '내려놓기'는 영상을 붙이지 않고 글만 보내 쓴다(SOMA-780). 영상이 붙으면 생각 루프에 빠져 15~20초 걸렸다.
            // false 면 예전처럼 영상과 함께 쓴다(롤백).
            @Value("${ACTTUB_COACH_LET_GO_WITHOUT_VIDEO:true}") boolean letGoWithoutVideo,
            // 답장(첫 질문이 아닌 턴)은 생각 단계를 MINIMAL 로 보낸다(SOMA-780). LOW 에서 가끔 생각 루프에 빠져 20~28초 걸렸다.
            // false 면 모두 LOW(롤백).
            @Value("${ACTTUB_COACH_FOLLOWUP_MINIMAL_THINKING:true}") boolean followUpMinimalThinking,
            com.acttub.actingapi.feature.coach.app.CoachLayerOne layerOne) {
        var alternate = modelB == null || modelB.isBlank() || modelBShare <= 0 ? null
                : new GeminiDirectVideoModel(client, modelB.strip()).withHedge(coachHedge);
        return new com.acttub.actingapi.feature.coach.app.DirectVideoCoach(model, videos, storage, failures, telemetry, practiceLoop,
                personasEnabled ? personas.getIfAvailable(() -> com.acttub.actingapi.feature.coach.app.CoachPersonas.NONE)
                        : com.acttub.actingapi.feature.coach.app.CoachPersonas.NONE,
                alternate, modelBShare,
                flowAb ? flows.getIfAvailable(() -> com.acttub.actingapi.feature.coach.app.CoachFlows.NONE)
                        : com.acttub.actingapi.feature.coach.app.CoachFlows.NONE,
                videoCache, letGoWithoutVideo, followUpMinimalThinking, layerOne);
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com'")
    DirectVideoSessions directVideoSessions(Client client, FailureReporter failures, Clock clock,
            @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String model) {
        return new DirectVideoSessions(new GeminiDirectVideoModel(client, model), failures, clock);
    }

    @Bean
    @ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com'")
    MultipartConfigElement directVideoMultipartConfig() {
        MultipartConfigFactory factory = new MultipartConfigFactory();
        factory.setMaxFileSize(DataSize.ofMegabytes(50));
        factory.setMaxRequestSize(DataSize.ofMegabytes(51));
        factory.setFileSizeThreshold(DataSize.ofBytes(0));
        return factory.createMultipartConfig();
    }
}
