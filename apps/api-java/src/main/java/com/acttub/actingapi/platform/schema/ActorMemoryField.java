package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
/** 배우 기억의 칸. 순서는 `0012_actor_memory.py` 의 enum 정의 순서다. */
public enum ActorMemoryField implements PgEnum {
    GENDER("gender"), AGE("age"), GOAL("goal"), BLOCKAGE("blockage"),
    SPEECH_SELF("speech_self"), SPEECH_ACTUAL("speech_actual");
    private final String value; ActorMemoryField(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ActorMemoryField>{public JpaConverter(){super(ActorMemoryField.class);}}
}
