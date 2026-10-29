package com.acttub.actingapi.feature.appconfig.adapter.web;

import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.appconfig.app.AppConfig;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 앱 설정(SOMA-939). 로그인 전(가입 화면)에도 쓰므로 인증 없이 준다 — 운영 값뿐이라 사람마다 다르지 않다. */
@RestController
@RequestMapping("/v2/app")
class AppConfigController {
    private final AppConfig config;

    AppConfigController(AppConfig config) {
        this.config = config;
    }

    @Operation(
            summary = "Get App Config",
            description = """
                    앱 출시 없이 바꾸는 운영 값 — 평가 요청 빈도, 리딩 자동 넘김·독백 판정 기준, 대본 같이 만들기 칩, 홈 오늘의 팁,
                    챌린지 영상 길이·기간. 서버 설정 APP_CONFIG_FILE 로 바꾸고 api 를 다시 띄우면 바뀐다. 앱은 못 받으면
                    마지막으로 받은 값(없으면 앱에 든 값)을 쓴다.""",
            operationId = "get_app_config_v2_app_config_get",
            tags = "v2-app")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AppConfigResponse.class)))
    @GetMapping("/config")
    ResponseEntity<AppConfigResponse> get() {
        return ResponseEntity.ok().cacheControl(CacheControl.noCache()).body(AppConfigResponse.of(config));
    }

    @Schema(name = "AppConfig", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AppConfigResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) RatingResponse rating,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ReadingResponse reading,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) CocreateResponse cocreate,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "언어(ko·en)별 홈 「오늘의 연기 팁」")
            Map<String, List<String>> homeTips,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ChallengeResponse challenge) {

        static AppConfigResponse of(AppConfig c) {
            var r = c.rating();
            var x = c.reading();
            var ch = c.challenge();
            return new AppConfigResponse(
                    new RatingResponse(r.coachEvery(), r.readingEvery(), r.minGapDays(), r.maxAsks()),
                    new ReadingResponse(x.vadThreshold(), x.silenceMs(), x.minSpeechMs(), x.maxListenMs(),
                            x.speechEndGraceMs(), x.advanceCoverage(), x.monologuePass(), x.monologueMissedBelow(),
                            x.monologueNextAt(), x.monologueTouchMin()),
                    new CocreateResponse(c.cocreate().emotions(), c.cocreate().situations()),
                    c.homeTips(),
                    new ChallengeResponse(ch.entryMinSeconds(), ch.entryMaxSeconds(), ch.durationsDays()));
        }
    }

    @Schema(name = "AppConfigRating", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "앱 평가 요청 — 코칭·리딩 몇 번마다 묻는지, 최소 간격(일), 최대 횟수")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RatingResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int coachEvery,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int readingEvery,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int minGapDays,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int maxAsks) {
    }

    @Schema(name = "AppConfigReading", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "리딩 자동 넘김(침묵 감지·말 끝 여유·말한 비율)과 독백 판정. monologue_pass 는 서버 판정과 같은 값")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReadingResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double vadThreshold,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int silenceMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int minSpeechMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int maxListenMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int speechEndGraceMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double advanceCoverage,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double monologuePass,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double monologueMissedBelow,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double monologueNextAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int monologueTouchMin) {
    }

    @Schema(name = "AppConfigCocreate", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "대본 같이 만들기 칩. 감정은 서버가 받는 목록 안의 값만, 보이는 순서대로")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CocreateResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> emotions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> situations) {
    }

    @Schema(name = "AppConfigChallenge", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "챌린지 참여 영상 길이(초)와 기간(일). 최대 길이·기간은 서버 규칙과 같은 값")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ChallengeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int entryMinSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int entryMaxSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Integer> durationsDays) {
    }
}
