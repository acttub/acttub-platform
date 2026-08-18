package com.acttub.actingapi.feature.admin;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminCloseReasonCount;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminFunnelStep;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminStats;
import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.BeanDescription;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 관리자 응답 모델의 <b>필드와 순서</b>가 바뀌지 않았는지 확인한다.
 *
 * <p>⚠ <b>OpenAPI 스냅샷이 이 셋을 덮지 않는다.</b> 관리자 엔드포인트는 조건부 빈이라
 * ({@code @ConditionalOnExpression}) 토큰 없이 뜨는 기본 컨텍스트의 springdoc 출력에 나오지
 * 않는다 — {@code OpenApiSnapshotIT} 의 스냅샷에 {@code AdminStats} 가 없는 것을 확인했다.
 * 여기가 유일한 그물이다.
 *
 * <p>기대값은 {@code frozen/} 의 커밋된 fixture 이고, 왜 커밋해도 되는지는
 * {@link FrozenValue} 에 있다.
 */
class AdminSchemaSnapshotTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Map<Class<?>, String> FIXTURES = Map.of(
            AdminStats.class, "admin-fields-AdminStats.txt",
            AdminFunnelStep.class, "admin-fields-AdminFunnelStep.txt",
            AdminCloseReasonCount.class, "admin-fields-AdminCloseReasonCount.txt");

    @Test
    @DisplayName("관리자 응답 모델 셋의 필드와 순서가 동결된 값과 같다")
    void statsAndNestedModelsHaveExactlyTheFrozenFieldsInOrder() {
        FIXTURES.forEach((type, fixture) -> {
            BeanDescription description = MAPPER.getSerializationConfig()
                    .introspect(MAPPER.constructType(type));
            List<String> actual = description.findProperties().stream()
                    .map(property -> property.getName())
                    .toList();

            assertThat(actual)
                    .as(type.getSimpleName())
                    .containsExactlyElementsOf(FrozenValue.linesOf(fixture));
        });
    }
}
