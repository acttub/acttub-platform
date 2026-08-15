package com.acttub.actingapi.schema;
import jakarta.persistence.Converter;
public enum SessionStatus implements PgEnum {
    OPEN("open"), CLOSED("closed");
    private final String value; SessionStatus(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<SessionStatus>{public JpaConverter(){super(SessionStatus.class);}}
}
