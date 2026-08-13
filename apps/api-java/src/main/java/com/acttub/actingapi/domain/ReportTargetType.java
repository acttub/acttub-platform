package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum ReportTargetType implements PgEnum {
    POST("post"), COMMENT("comment");
    private final String value; ReportTargetType(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ReportTargetType>{public JpaConverter(){super(ReportTargetType.class);}}
}
