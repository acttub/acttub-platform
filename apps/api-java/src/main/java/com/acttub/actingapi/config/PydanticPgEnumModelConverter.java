package com.acttub.actingapi.config;

import java.lang.reflect.Type;
import java.util.Arrays;
import java.util.Iterator;

import com.acttub.actingapi.domain.PgEnum;
import com.fasterxml.jackson.databind.JavaType;
import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.core.converter.ModelConverter;
import io.swagger.v3.core.converter.ModelConverterContext;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;

/** Documents native Postgres enums with their wire values instead of Java constant names. */
final class PydanticPgEnumModelConverter implements ModelConverter {
    @Override
    @SuppressWarnings("rawtypes")
    public Schema resolve(
            AnnotatedType type,
            ModelConverterContext context,
            Iterator<ModelConverter> chain) {
        Class<?> rawClass = rawClass(type.getType());
        if (rawClass == null || !rawClass.isEnum() || !PgEnum.class.isAssignableFrom(rawClass)) {
            return chain.hasNext() ? chain.next().resolve(type, context, chain) : null;
        }

        String componentName = rawClass.getSimpleName();
        StringSchema component = new StringSchema();
        component.setEnum(Arrays.stream(rawClass.getEnumConstants())
                .map(constant -> ((PgEnum) constant).dbValue())
                .toList());
        context.defineModel(componentName, component, type, null);
        return new Schema<>().$ref("#/components/schemas/" + componentName);
    }

    private static Class<?> rawClass(Type type) {
        if (type instanceof Class<?> rawClass) {
            return rawClass;
        }
        if (type instanceof JavaType javaType) {
            return javaType.getRawClass();
        }
        return null;
    }
}
