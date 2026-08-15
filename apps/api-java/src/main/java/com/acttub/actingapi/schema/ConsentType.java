package com.acttub.actingapi.schema;
import jakarta.persistence.Converter;
public enum ConsentType implements PgEnum {
    TERMS("terms"), PRIVACY("privacy"), AI_ANALYSIS("ai_analysis");
    private final String value; ConsentType(String value) { this.value=value; } public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ConsentType>{public JpaConverter(){super(ConsentType.class);}}
}
