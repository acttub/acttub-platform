package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum TurnRole implements PgEnum {
    AI("ai"), ACTOR("actor");
    private final String value; TurnRole(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<TurnRole>{public JpaConverter(){super(TurnRole.class);}}
}
