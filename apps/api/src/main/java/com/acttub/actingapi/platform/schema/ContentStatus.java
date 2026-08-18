package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum ContentStatus implements PgEnum {
    VISIBLE("visible"), HIDDEN("hidden"), DELETED("deleted");
    private final String value; ContentStatus(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ContentStatus>{public JpaConverter(){super(ContentStatus.class);}}
}
