package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.RecordingCoachDtos.CoachResponse;
import com.acttub.actingapi.feature.reading.adapter.web.RecordingCoachDtos.ReplyRequest;
import com.acttub.actingapi.feature.reading.adapter.web.RecordingCoachDtos.StartRequest;
import com.acttub.actingapi.feature.reading.app.RecordingCoachService;
import com.acttub.actingapi.platform.security.AccessGate;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리딩 녹음 코치 (reading.recording-coach, 실험, SOMA-791). 스위치를 켠 배포에만 있다.
 *
 * <p><b>회원 전용</b>이다 — 경로가 {@code /v2/reading/**} 밖이라 웹 게스트의 기능 표에 들지 않는다. 배우의 소리를 AI 가
 * 듣는 일이라 리딩(AI 분석 동의 없음)이 아니라 회원 필수 동의(ai_analysis)의 범위에 둔다.
 */
@RestController
@RequestMapping("/v2/recording-coaches")
@ConditionalOnProperty(name = "ACTTUB_RECORDING_COACH_ENABLED", havingValue = "true")
class RecordingCoachController {
    private final RecordingCoachService coaches;
    private final AccessGate auth;

    RecordingCoachController(RecordingCoachService coaches, AccessGate auth) {
        this.coaches = coaches;
        this.auth = auth;
    }

    /** 회차의 녹음으로 첫 차례를 만든다. 그 회차에 이미 있으면 그것을 200 으로 돌려준다. */
    @PostMapping
    ResponseEntity<CoachResponse> start(@Valid @RequestBody StartRequest body, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        RecordingCoachService.Started started = coaches.start(userId, body.readingSessionId());
        return ResponseEntity.status(started.created() ? 201 : 200).body(CoachResponse.of(started.coach()));
    }

    @GetMapping("/{coach_id}")
    CoachResponse get(@PathVariable("coach_id") UUID coachId, HttpServletRequest request) {
        return CoachResponse.of(coaches.get(auth.gatedUser(request).id(), coachId));
    }

    /** 배우의 답에 둘째 차례로 답한다. 이미 답한 대화면 지금 값을 그대로 돌려준다. */
    @PostMapping("/{coach_id}/reply")
    CoachResponse reply(
            @PathVariable("coach_id") UUID coachId,
            @Valid @RequestBody ReplyRequest body,
            HttpServletRequest request) {
        return CoachResponse.of(coaches.reply(auth.gatedUser(request).id(), coachId, body.text()));
    }
}
