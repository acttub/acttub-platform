package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
/**
 * 배우 기억의 칸. <b>이 선언 순서가 화면이 읽는 순서다</b> (`0012_actor_memory.py` 에서 왔다).
 *
 * <p>컬럼이 text 라 DB 는 이 순서를 모른다 — 지키는 것은
 * {@code PostgresMemoryRepository#list} 의 {@code ORDER BY CASE} 다 (SOMA-462).
 */
public enum ActorMemoryField implements PgEnum {
    GENDER("gender"), AGE("age"), GOAL("goal"), BLOCKAGE("blockage"),
    SPEECH_SELF("speech_self"), SPEECH_ACTUAL("speech_actual");
    private final String value; ActorMemoryField(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ActorMemoryField>{public JpaConverter(){super(ActorMemoryField.class);}}
}
