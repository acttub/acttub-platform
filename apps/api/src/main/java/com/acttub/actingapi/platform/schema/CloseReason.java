package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum CloseReason implements PgEnum {
    GAP_STATED("gap_stated"), EXHAUSTED("exhausted"), LIMIT("limit"), USER_ENDED("user_ended"),
    ACTOR_FINISHED("actor_finished"), TURN_BUDGET("turn_budget"),
    INTERRUPTED("interrupted"), SYSTEM_FAILURE("system_failure");
    private final String value; CloseReason(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<CloseReason>{public JpaConverter(){super(CloseReason.class);}}
}
