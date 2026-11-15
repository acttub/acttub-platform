package com.acttub.actingapi.support;

import java.util.List;
import java.util.Map;

import org.flywaydb.core.Flyway;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;
import org.springframework.test.context.TestContextAnnotationUtils;

/**
 * {@code @SpringBootTest} 컨텍스트가 <b>새로 뜰 때마다</b> 빈 DB 를 하나 만들어 붙인다
 * ({@code src/test/resources/META-INF/spring.factories} 로 등록).
 *
 * <p>예전에는 클래스마다 자기 이름의 DB 를 {@code @DynamicPropertySource} 로 붙였다. 그 메서드가 컨텍스트 캐시
 * 키에 들어가 설정이 같은 클래스끼리도 컨텍스트를 나누지 못했고, 클래스마다 Spring 과 Flyway 가 새로 떴다(SOMA-1077).
 * 이 customizer 는 모든 클래스에 같은 인스턴스라 캐시 키를 가르지 않는다. 설정이 같은 클래스는 컨텍스트와 DB 를 함께
 * 쓰고, 설정이 다른 컨텍스트는 예전처럼 저마다 DB 를 가져 캐시에 남은 다른 컨텍스트의 배경 작업과 섞이지 않는다.
 *
 * <p>새 DB 는 마이그레이션을 JVM 에서 한 번만 돌린 템플릿을 복사해 만든다. 기동하는 Flyway 는 이력이 이미 끝까지
 * 있어 검증만 하고 지나간다. 빈 DB 에서 V1 부터 쌓는 경로는 {@code flyway} 패키지 테스트와 {@code HealthAndBootIT} 가 본다.
 */
public final class FreshDatabasePerContext implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(
            Class<?> testClass, List<ContextConfigurationAttributes> configAttributes) {
        return TestContextAnnotationUtils.hasAnnotation(testClass, SpringBootTest.class) ? Customizer.INSTANCE : null;
    }

    private enum Customizer implements ContextCustomizer {
        INSTANCE;

        private static String template;

        @Override
        public void customizeContext(ConfigurableApplicationContext context, MergedContextConfiguration config) {
            String name = PostgresContainerSupport.createDatabaseFrom("context", migratedTemplate());
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("freshTestDatabase", Map.of(
                    "spring.datasource.url", PostgresContainerSupport.jdbcUrlFor(name),
                    "spring.datasource.username", PostgresContainerSupport.POSTGRES.getUsername(),
                    "spring.datasource.password", PostgresContainerSupport.POSTGRES.getPassword())));
        }

        /** application.yml 의 spring.flyway 와 같은 위치·설정이다. 다르면 기동하는 Flyway 의 검증이 실패해 드러난다. */
        private static synchronized String migratedTemplate() {
            if (template == null) {
                String name = PostgresContainerSupport.createDatabaseName("context_template");
                Flyway.configure()
                        .dataSource(PostgresContainerSupport.jdbcUrlFor(name),
                                PostgresContainerSupport.POSTGRES.getUsername(),
                                PostgresContainerSupport.POSTGRES.getPassword())
                        .locations("classpath:db/migration")
                        .load()
                        .migrate();
                template = name;
            }
            return template;
        }
    }
}
