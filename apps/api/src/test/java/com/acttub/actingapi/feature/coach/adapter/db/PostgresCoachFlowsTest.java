package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.coach.app.CoachFlows;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PostgresCoachFlowsTest {
    @Test void anAccountAlwaysGetsTheSameFlowAndAccountsSplitRoughlyInHalf() {
        UUID one = UUID.fromString("11111111-1111-1111-1111-111111111111");
        assertThat(PostgresCoachFlows.byAccount(one)).isEqualTo(PostgresCoachFlows.byAccount(one));
        long b = IntStream.range(0, 2000).mapToObj(i -> UUID.nameUUIDFromBytes(("u" + i).getBytes()))
                .filter(id -> CoachFlows.B.equals(PostgresCoachFlows.byAccount(id))).count();
        assertThat(b).isBetween(900L, 1100L);
    }

    @Test void advisorsGetTheFlowTheyHaveHadLessOfAndStartFromTheirAccountSide() {
        UUID advisor = UUID.fromString("22222222-2222-2222-2222-222222222222");
        assertThat(PostgresCoachFlows.alternate(advisor, 1, 2)).isEqualTo(CoachFlows.B);
        assertThat(PostgresCoachFlows.alternate(advisor, 3, 2)).isEqualTo(CoachFlows.A);
        assertThat(PostgresCoachFlows.alternate(advisor, 0, 0)).isEqualTo(PostgresCoachFlows.byAccount(advisor));
    }
}
