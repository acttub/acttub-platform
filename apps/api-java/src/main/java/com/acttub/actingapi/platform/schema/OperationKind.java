package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum OperationKind implements PgEnum {
    // 순서는 `pg_enum.enumsortorder` 다. memory_update 는 `0013` 이 ADD VALUE 로 뒤에 붙였다.
    ANALYZE("analyze"), COACH_START("coach_start"), COACH_REPLY("coach_reply"), REPORT("report"),
    MEMORY_UPDATE("memory_update");
    private final String value; OperationKind(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<OperationKind>{public JpaConverter(){super(OperationKind.class);}}
}
