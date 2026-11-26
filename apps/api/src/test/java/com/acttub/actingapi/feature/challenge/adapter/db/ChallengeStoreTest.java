package com.acttub.actingapi.feature.challenge.adapter.db;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * 챌린지 저장소가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정하는 테스트(apps/api/CONTRACT.md §5-9). 네이티브 SQL 을
 * JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨다. 설정을 여기 한 곳에 두어 이 테스트들이 Spring 컨텍스트 하나를 함께 쓴다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.challenge.adapter.db.ChallengeStoreFixture$Recorder"
})
@Import(ChallengeStoreFixture.class)
@interface ChallengeStoreTest {
}
