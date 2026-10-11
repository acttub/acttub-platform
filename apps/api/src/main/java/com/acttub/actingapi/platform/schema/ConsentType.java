package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum ConsentType implements PgEnum {
    TERMS("terms"), PRIVACY("privacy"), AI_ANALYSIS("ai_analysis"), RETENTION("retention"), CLOUD_VOICE("cloud_voice"), SCRIPT_SPLIT("script_split"),
    MARKETING_EMAIL("marketing_email"), MARKETING_PUSH("marketing_push");
    private final String value; ConsentType(String value) { this.value=value; } public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ConsentType>{public JpaConverter(){super(ConsentType.class);}}
}
