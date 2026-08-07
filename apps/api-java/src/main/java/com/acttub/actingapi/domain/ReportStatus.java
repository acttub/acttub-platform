package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum ReportStatus implements PgEnum {
    PENDING("pending"), ACTIONED("actioned"), DISMISSED("dismissed");
    private final String value; ReportStatus(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ReportStatus>{public JpaConverter(){super(ReportStatus.class);}}
}
