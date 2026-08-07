package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum OperationStatus implements PgEnum {
    PENDING("pending"), RUNNING("running"), SUCCEEDED("succeeded"), FAILED("failed");
    private final String value; OperationStatus(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<OperationStatus>{public JpaConverter(){super(OperationStatus.class);}}
}
