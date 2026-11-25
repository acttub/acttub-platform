package com.acttub.actingapi.feature.coach;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;

/**
 * 코치 저장소(대화·노트·평가·일지)가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정하는 테스트(apps/api/CONTRACT.md
 * §5-9). 네이티브 SQL 을 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨다. 설정을 여기 한 곳에 두어 이 테스트들이 Spring 컨텍스트
 * 하나를 함께 쓴다 — 설정이 다른 테스트마다 컨텍스트가 하나씩 더 떠 테스트 JVM 힙을 차지한다.
 *
 * <p>무료 한도({@code BILLING_FREE_LIMITS_ENABLED})를 켠 설정이다. 한도가 걸리지 않는 쪽은 Pro 회원과 옛 갈래 대화로 본다. 모델은
 * {@link CoachConversationIT.StubGenerator} 가 대신한다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "BILLING_WEB_ENABLED=true",
    "BILLING_WEB_RETURN_URL=https://acttub.com/pricing/result",
    "BILLING_FREE_LIMITS_ENABLED=true",
    "BILLING_LEGACY_SIGNUP_BEFORE=2000-01-01T00:00:00Z",
    "BILLING_PUBLIC_ORIGIN=https://billing.acttub.test",
    "BILLING_TOSS_CLIENT_KEY=test_ck_fakefakefake1234",
    "BILLING_TOSS_SECRET_KEY=test_sk_fakefakefake1234",
    "BILLING_RENEWAL_POLL_MS=3600000",
    "BILLING_RENEWAL_INITIAL_DELAY_MS=3600000",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.coach.CoachStoreFixture$Recorder"
})
@AutoConfigureMockMvc
@Import({CoachStoreFixture.class, RecordingFailureReporter.Fixture.class, CoachConversationIT.Fixture.class})
@interface CoachStoreTest {
}
