package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum OperationKind implements PgEnum {
    ANALYZE("analyze"), COACH_START("coach_start"), COACH_REPLY("coach_reply"), REPORT("report");
    private final String value; OperationKind(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<OperationKind>{public JpaConverter(){super(OperationKind.class);}}
}
