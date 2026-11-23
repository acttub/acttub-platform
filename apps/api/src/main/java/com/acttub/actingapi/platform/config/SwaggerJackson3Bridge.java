package com.acttub.actingapi.platform.config;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import com.fasterxml.jackson.databind.AnnotationIntrospector;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.introspect.AnnotatedClass;
import com.fasterxml.jackson.databind.introspect.NopAnnotationIntrospector;
import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.core.converter.ModelConverter;
import io.swagger.v3.core.converter.ModelConverterContext;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.core.util.Json31;
import io.swagger.v3.oas.models.media.Schema;

/**
 * OpenAPI 문서를 만드는 swagger-core 2.2(springdoc 3.2)는 DTO 를 Jackson 2 로 읽는다. 앱의 JSON 은 Jackson 3 이라,
 * Jackson 2 는 Jackson 3 의 databind 주석과 타입을 모른다. 이 클래스가 그 둘을 Jackson 2 쪽에 이어 준다(SOMA-1103).
 *
 * <ul>
 *   <li>{@code tools.jackson.databind.annotation.JsonNaming}: swagger 의 Jackson 2 매퍼({@link Json31}·{@link Json})가
 *       같은 이름 규칙을 쓰게 한다. 없으면 snake_case 필드가 문서에서 camelCase 가 된다.</li>
 *   <li>Jackson 3 {@code JsonNode}·{@code ObjectNode}·{@code ArrayNode}: Jackson 2 의 같은 타입으로 바꿔 넘긴다. 없으면
 *       노드 클래스를 일반 객체로 풀어 {@code JsonNodeType} 같은 스키마가 생긴다.</li>
 * </ul>
 *
 * <p>Jackson 2 를 import 해도 되는 곳은 swagger 와 맞닿은 이 패키지의 이 파일뿐이다({@code JacksonImportBoundaryTest}).
 * 응답의 필드 이름과 문서의 필드 이름이 같은지는 {@code WireNameParityTest} 가 모든 {@code @JsonNaming} 클래스에서 본다.
 */
final class SwaggerJackson3Bridge implements ModelConverter {

    private static final AtomicBoolean INSTALLED = new AtomicBoolean();

    /** 새 이름 규칙을 쓰면 여기에 Jackson 2 의 같은 규칙을 더한다. 없으면 문서를 만들 때 실패한다. */
    private static final Map<Class<?>, Class<?>> NAMING = Map.of(
            tools.jackson.databind.PropertyNamingStrategies.SnakeCaseStrategy.class,
            com.fasterxml.jackson.databind.PropertyNamingStrategies.SnakeCaseStrategy.class);

    private static final Map<Class<?>, Class<?>> NODES = Map.of(
            tools.jackson.databind.JsonNode.class, com.fasterxml.jackson.databind.JsonNode.class,
            tools.jackson.databind.node.ObjectNode.class, com.fasterxml.jackson.databind.node.ObjectNode.class,
            tools.jackson.databind.node.ArrayNode.class, com.fasterxml.jackson.databind.node.ArrayNode.class);

    private static final AnnotationIntrospector JACKSON3_NAMING = new NopAnnotationIntrospector() {
        @Override
        public Object findNamingStrategy(AnnotatedClass annotated) {
            var naming = annotated.getRawType().getAnnotation(tools.jackson.databind.annotation.JsonNaming.class);
            if (naming == null) {
                return null;
            }
            Class<?> jackson2 = NAMING.get(naming.value());
            if (jackson2 == null) {
                throw new IllegalStateException("no Jackson 2 naming strategy for " + naming.value().getName());
            }
            return jackson2;
        }
    };

    SwaggerJackson3Bridge() {
        installNaming();
    }

    /** swagger 의 Jackson 2 매퍼가 Jackson 3 {@code @JsonNaming} 을 읽게 한다. 여러 번 불러도 한 번만 건다. */
    static void installNaming() {
        if (INSTALLED.compareAndSet(false, true)) {
            for (ObjectMapper mapper : List.of(Json31.mapper(), Json.mapper())) {
                mapper.setAnnotationIntrospector(AnnotationIntrospector.pair(
                        JACKSON3_NAMING, mapper.getSerializationConfig().getAnnotationIntrospector()));
            }
        }
    }

    @Override
    @SuppressWarnings("rawtypes")
    public Schema resolve(AnnotatedType type, ModelConverterContext context, Iterator<ModelConverter> chain) {
        Class<?> raw = rawClass(type.getType());
        Class<?> jackson2 = raw == null ? null : NODES.get(raw);
        if (jackson2 == null && raw != null && tools.jackson.databind.JsonNode.class.isAssignableFrom(raw)) {
            jackson2 = com.fasterxml.jackson.databind.JsonNode.class;
        }
        AnnotatedType next = jackson2 == null ? type : new AnnotatedType(jackson2)
                .name(type.getName())
                .parent(type.getParent())
                .jsonUnwrappedHandler(type.getJsonUnwrappedHandler())
                .skipOverride(type.isSkipOverride())
                .schemaProperty(type.isSchemaProperty())
                .ctxAnnotations(type.getCtxAnnotations())
                .resolveAsRef(type.isResolveAsRef())
                .jsonViewAnnotation(type.getJsonViewAnnotation())
                .includePropertiesWithoutJSONView(type.isIncludePropertiesWithoutJSONView())
                .skipSchemaName(type.isSkipSchemaName())
                .skipJsonIdentity(type.isSkipJsonIdentity())
                .propertyName(type.getPropertyName())
                .components(type.getComponents());
        return chain.hasNext() ? chain.next().resolve(next, context, chain) : null;
    }

    /** swagger 는 타입을 {@link Class}·{@link ParameterizedType}·Jackson 2 {@link JavaType} 로 넘긴다. */
    static Class<?> rawClass(Type type) {
        return switch (type) {
            case Class<?> raw -> raw;
            case JavaType javaType -> javaType.getRawClass();
            case ParameterizedType parameterized when parameterized.getRawType() instanceof Class<?> raw -> raw;
            case null, default -> null;
        };
    }
}
