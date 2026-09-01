package com.acttub.actingapi.platform.schema;

import java.util.List;

import jakarta.persistence.Query;
import jakarta.persistence.Tuple;

/** Hibernate native query 결과를 별칭 기반 {@link Tuple} 목록으로 읽는다. */
public final class NativeTuples {
    private NativeTuples() {
    }

    @SuppressWarnings("unchecked")
    public static List<Tuple> list(Query query) {
        return query.getResultList();
    }
}
