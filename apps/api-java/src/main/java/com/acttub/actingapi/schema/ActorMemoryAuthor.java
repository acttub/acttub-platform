package com.acttub.actingapi.schema;
import jakarta.persistence.Converter;
/** 배우 기억의 칸을 누가 썼는지. 배우가 쓴 칸은 에이전트가 덮지 않는다. */
public enum ActorMemoryAuthor implements PgEnum {
    ACTOR("actor"), AGENT("agent");
    private final String value; ActorMemoryAuthor(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ActorMemoryAuthor>{public JpaConverter(){super(ActorMemoryAuthor.class);}}
}
