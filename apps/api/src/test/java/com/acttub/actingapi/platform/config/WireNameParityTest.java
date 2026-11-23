package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.JavaType;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.annotation.JsonNaming;
import tools.jackson.databind.jsonFormatVisitors.JsonFormatVisitorWrapper;
import tools.jackson.databind.jsonFormatVisitors.JsonObjectFormatVisitor;
import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.oas.models.media.Schema;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.context.annotation.Import;
import org.springframework.core.type.filter.AnnotationTypeFilter;

/**
 * 응답에 실리는 필드 이름과 OpenAPI 문서(웹 타입 생성원)의 필드 이름이 같은지 본다(SOMA-1103).
 *
 * <p>실제 응답은 앱의 JSON 매퍼가, 문서는 springdoc 이 쓰는 swagger-core 가 같은 DTO 주석을 각자 읽어 이름을 정한다.
 * 둘이 어긋나면 웹이 생성한 타입과 실제 응답이 조용히 달라진다. {@code @JsonNaming} 이 붙은 모든 클래스에서 두 쪽의
 * 이름 목록을 견준다. {@code OpenApiSnapshotIT} 는 문서가 커밋된 스냅샷과 같은지만 보므로 이 대조를 하지 않는다.
 */
@JsonTest
@Import(JacksonConfig.class)
class WireNameParityTest {

    @Autowired
    ObjectMapper mapper;

    @Test
    @DisplayName("@JsonNaming 이 붙은 모든 DTO 에서 실제 응답의 필드 이름과 OpenAPI 스키마의 속성 이름이 같다")
    void responseNamesMatchDocumentedNames() throws Exception {
        List<Class<?>> named = namedClasses();
        assertThat(named).as("@JsonNaming 이 붙은 클래스를 찾았다").hasSizeGreaterThan(200);

        Map<String, List<String>> mismatches = new LinkedHashMap<>();
        for (Class<?> type : named) {
            List<String> runtime = runtimeNames(type);
            List<String> documented = documentedNames(type);
            if (!runtime.equals(documented)) {
                mismatches.put(type.getName(), List.of("응답 " + runtime, "문서 " + documented));
            }
        }
        assertThat(mismatches).isEmpty();
    }

    static List<Class<?>> namedClasses() throws ClassNotFoundException {
        var scanner = new ClassPathScanningCandidateComponentProvider(false) {
            @Override
            protected boolean isCandidateComponent(
                    org.springframework.beans.factory.annotation.AnnotatedBeanDefinition definition) {
                return true;
            }
        };
        scanner.addIncludeFilter(new AnnotationTypeFilter(JsonNaming.class));
        List<Class<?>> types = new ArrayList<>();
        for (var definition : scanner.findCandidateComponents("com.acttub.actingapi")) {
            types.add(Class.forName(definition.getBeanClassName()));
        }
        types.sort(java.util.Comparator.comparing(Class::getName));
        return types;
    }

    private List<String> runtimeNames(Class<?> type) throws Exception {
        List<String> names = new ArrayList<>();
        mapper.acceptJsonFormatVisitor(type, new JsonFormatVisitorWrapper.Base() {
            @Override
            public JsonObjectFormatVisitor expectObjectFormat(JavaType objectType) {
                return new JsonObjectFormatVisitor.Base(getContext()) {
                    @Override
                    public void property(BeanProperty property) {
                        names.add(property.getName());
                    }

                    @Override
                    public void optionalProperty(BeanProperty property) {
                        names.add(property.getName());
                    }
                };
            }
        });
        return names;
    }

    @SuppressWarnings("rawtypes")
    private static List<String> documentedNames(Class<?> type) {
        Schema schema = new ModelConverters(true).resolveAsResolvedSchema(new AnnotatedType(type).resolveAsRef(false)).schema;
        return schema == null || schema.getProperties() == null ? List.of() : new ArrayList<String>(schema.getProperties().keySet());
    }
}
