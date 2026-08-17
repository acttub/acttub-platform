package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum IntentImpact implements PgEnum {
    REVERSAL("반전"), WEAKENING("약화"), LOCAL("국소");
    private final String value; IntentImpact(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<IntentImpact>{public JpaConverter(){super(IntentImpact.class);}}
}
