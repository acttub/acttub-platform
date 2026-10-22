package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.schema.MemoryField;
import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.core.converter.ModelConverterContextImpl;
import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.oas.models.media.Schema;
import org.junit.jupiter.api.Test;

class PydanticPgEnumModelConverterTest {

    record Holder(MemoryField field) {
    }

    @Test
    void postgresEnumIsDocumentedWithItsWireValues() {
        ModelConverters converters = new ModelConverters();
        converters.addConverter(new PydanticPgEnumModelConverter());

        Map<String, Schema> schemas = converters.readAll(Holder.class);

        assertThat(schemas.get("MemoryField").getEnum()).isEqualTo(List.of(
                "goal", "blockage", "speech_self", "speech_actual", "wants", "habits", "avoid", "tone",
                "coaching_profile"));
        assertThat(((Schema<?>) schemas.get("Holder").getProperties().get("field")).get$ref())
                .isEqualTo("#/components/schemas/MemoryField");
    }

    @Test
    void otherTypesGoDownTheChainAndTheEndOfTheChainResolvesNothing() {
        var converter = new PydanticPgEnumModelConverter();
        var context = new ModelConverterContextImpl(converter);

        assertThat(converter.resolve(new AnnotatedType(String.class), context, Collections.emptyIterator()))
                .isNull();
        assertThat(converter.resolve(
                new AnnotatedType(Holder.class.getRecordComponents()[0].getGenericType()),
                context,
                Collections.emptyIterator()))
                .isNotNull();
        assertThat(converter.resolve(
                new AnnotatedType(List.class.getTypeParameters()[0]), context, Collections.emptyIterator()))
                .isNull();
    }
}
