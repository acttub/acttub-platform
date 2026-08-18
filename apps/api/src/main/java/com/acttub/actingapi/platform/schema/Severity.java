package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum Severity implements PgEnum {
    HIGH("high"), MID("mid"), LOW("low");
    private final String value; Severity(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<Severity>{public JpaConverter(){super(Severity.class);}}
}
