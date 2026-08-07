package com.acttub.actingapi.domain;
import static org.assertj.core.api.Assertions.*; import java.util.*; import org.junit.jupiter.api.Test;
class PgEnumCatalogVerifierTest {@Test void driftFailsBootVerifier(){assertThatThrownBy(()->PgEnumCatalogVerifier.verify(Map.of("user_status_t",List.of("active")))).isInstanceOf(IllegalStateException.class).hasMessageContaining("Postgres enum drift");}}
