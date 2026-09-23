package com.acttub.actingapi.support;

import com.acttub.actingapi.feature.coach.adapter.web.LegacyCoachTestController;
import com.acttub.actingapi.feature.coach.app.CoachService;
import com.acttub.actingapi.feature.report.adapter.web.LegacyReportTestController;
import com.acttub.actingapi.feature.report.app.ReportService;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;

/**
 * 이전 원장·저장 형식의 회귀를 확인할 때만 쓰는 옛 HTTP 어댑터다. 이전 데이터와 진행 중 원장은 유지하지만
 * 운영 서버가 옛 코치·리포트 쓰기를 다시 받지는 않는다. 현재 경로의 검증은 이 구성을 import하지 않는다.
 */
@org.springframework.context.annotation.Profile("legacy-practice-test")
@TestConfiguration(proxyBeanMethods = false)
@Import({CoachService.class, ReportService.class, LegacyCoachTestController.class, LegacyReportTestController.class})
public class LegacyPracticeApiFixture { }
