package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
/**
 * 옛 배우 기억 표({@code actor_memory_entries})의 칸 (`0012_actor_memory.py` 에서 왔다). 이 표를 칸 순서대로
 * 읽던 화면·워커는 지웠고, 지금은 엔티티 매핑과 값 검사만 이 목록을 쓴다.
 */
public enum ActorMemoryField implements PgEnum {
    GENDER("gender"), AGE("age"), GOAL("goal"), BLOCKAGE("blockage"),
    SPEECH_SELF("speech_self"), SPEECH_ACTUAL("speech_actual");
    private final String value; ActorMemoryField(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ActorMemoryField>{public JpaConverter(){super(ActorMemoryField.class);}}
}
