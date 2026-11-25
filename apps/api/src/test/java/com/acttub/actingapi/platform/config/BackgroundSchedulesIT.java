package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.scheduling.config.TaskExecutionOutcome;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 테스트 공통 설정({@code src/test/resources/application.properties})이 끄는 배경 작업을 모두 켜고, 실제 컨텍스트에서 저마다 한 번
 * 돌아 실패 없이 끝나는지 본다. 다른 테스트는 이 작업들을 끄고 워커를 직접 부르므로 스케줄러가 서고 도는 것은 여기서 본다.
 *
 * <p>운영 기본값은 모두 켜짐이다({@code matchIfMissing = true}). 처음 지연은 0으로, 크론은 매초로 줄인다. 저장소가 있어야 분석 워커가
 * 서므로 저장소는 가짜를 둔다. 스케줄러는 실패를 잡아 보고만 하므로, 보고가 하나도 없는지까지 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ANALYSIS_WORKER_ENABLED=true",
    "ACCOUNT_CLEANUP_ENABLED=true",
    "ACCOUNT_HOUSEKEEPING_ENABLED=true",
    "CHALLENGE_SETTLEMENT_ENABLED=true",
    "CHALLENGE_NOTIFICATION_PUSH_ENABLED=true",
    "CHALLENGE_VIEW_DIGEST_ENABLED=true",
    "EXIT_SURVEY_SYNC_ENABLED=true",
    "SCRIPT_UPLOAD_SWEEP_ENABLED=true",
    "COMMUNITY_IMAGE_SWEEP_ENABLED=true",
    "SCRIPT_SPLIT_INITIAL_DELAY_MS=0",
    "CHALLENGE_REPORT_INITIAL_DELAY_MS=0",
    "ACCOUNT_CLEANUP_INITIAL_DELAY_MS=0",
    "CHALLENGE_SETTLEMENT_INITIAL_DELAY_MS=0",
    "CHALLENGE_NOTIFICATION_PUSH_INITIAL_DELAY_MS=0",
    "EXIT_SURVEY_SYNC_INITIAL_DELAY_MS=0",
    "ACCOUNT_HOUSEKEEPING_CRON=* * * * * *",
    "AD_SERVES_CLEANUP_CRON=* * * * * *",
    "CHALLENGE_VIEW_DIGEST_CRON=* * * * * *",
    "SCRIPT_UPLOAD_SWEEP_CRON=* * * * * *",
    "COMMUNITY_IMAGE_SWEEP_CRON=* * * * * *"
})
@Import(RecordingFailureReporter.Fixture.class)
class BackgroundSchedulesIT {
    /** 공통 설정이 끄는 속성마다 그 속성이 세우는 예약 작업(클래스.메서드). */
    private static final List<String> EXPECTED = List.of(
            "AnalysisWorkerScheduler.poll",
            "AnalysisWorkerScheduler.sweep",
            "MemoryWorkerScheduler.poll",
            "ScriptSplitScheduler.poll",
            "ChallengeReportScheduler.poll",
            "AccountCleanupScheduler.run",
            "AccountHousekeepingScheduler.run",
            "AdServesCleanupScheduler.run",
            "ChallengeSettlementScheduler.run",
            "NotificationPushScheduler.run",
            "EntryViewDigestScheduler.run",
            "ExitSurveySyncScheduler.run",
            "ScriptUploadSweepScheduler.run",
            "CommunityImageSweepScheduler.run");

    @MockitoBean
    ObjectStorage storage;

    @Autowired
    ObjectProvider<ScheduledTaskHolder> holders;

    @Autowired
    RecordingFailureReporter failures;

    @Test
    void everyScheduleTheTestDefaultsTurnOffStartsAndRunsOnceWithoutAReportedFailure() {
        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            Map<String, TaskExecutionOutcome.Status> outcomes = outcomes();
            assertThat(outcomes).as("세워진 예약 작업").containsKeys(EXPECTED.toArray(String[]::new));
            assertThat(EXPECTED).allSatisfy(name -> assertThat(outcomes.get(name)).as(name).isEqualTo(TaskExecutionOutcome.Status.SUCCESS));
        });
        assertThat(failures.reports()).as("스케줄러가 잡아 보고한 실패").isEmpty();
    }

    private Map<String, TaskExecutionOutcome.Status> outcomes() {
        Map<String, TaskExecutionOutcome.Status> outcomes = new LinkedHashMap<>();
        holders.forEach(holder -> {
            for (ScheduledTask scheduled : holder.getScheduledTasks()) {
                // 실행기는 결과를 적는 겉감에 싸여 있고, 겉감의 이름은 안의 메서드 실행기의 「패키지.클래스.메서드」다.
                String qualified = scheduled.getTask().toString();
                String[] parts = qualified.split("\\.");
                String name = parts.length < 2 ? qualified : parts[parts.length - 2] + "." + parts[parts.length - 1];
                outcomes.put(name, scheduled.getTask().getLastExecutionOutcome().status());
            }
        });
        return outcomes;
    }
}
