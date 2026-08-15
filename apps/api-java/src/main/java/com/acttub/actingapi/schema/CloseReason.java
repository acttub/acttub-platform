package com.acttub.actingapi.schema;
import jakarta.persistence.Converter;
public enum CloseReason implements PgEnum {
    GAP_STATED("gap_stated"), EXHAUSTED("exhausted"), LIMIT("limit"), USER_ENDED("user_ended");
    private final String value; CloseReason(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<CloseReason>{public JpaConverter(){super(CloseReason.class);}}
}
