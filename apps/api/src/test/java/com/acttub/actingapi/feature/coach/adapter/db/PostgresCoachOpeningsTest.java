package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.coach.app.CoachOpenings;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PostgresCoachOpeningsTest {
    @Test void anAccountAlwaysGetsTheSameSideAndAccountsSplitRoughlyInHalf() {
        UUID one = UUID.fromString("11111111-1111-1111-1111-111111111111");
        assertThat(PostgresCoachOpenings.byAccount(one)).isEqualTo(PostgresCoachOpenings.byAccount(one));
        long b = IntStream.range(0, 2000).mapToObj(i -> UUID.nameUUIDFromBytes(("u" + i).getBytes()))
                .filter(id -> CoachOpenings.B.equals(PostgresCoachOpenings.byAccount(id))).count();
        assertThat(b).isBetween(900L, 1100L);
    }

    @Test void sideIsTheParityOfTheFirstByteOfTheOpeningPrefixedHash() throws Exception {
        for (int i = 0; i < 50; i++) {
            UUID id = UUID.nameUUIDFromBytes(("p" + i).getBytes());
            byte first = MessageDigest.getInstance("SHA-256").digest(("coach-opening:" + id).getBytes(StandardCharsets.UTF_8))[0];
            assertThat(PostgresCoachOpenings.byAccount(id)).isEqualTo((first & 1) == 0 ? CoachOpenings.A : CoachOpenings.B);
        }
    }

    @Test void theSplitIsIndependentOfTheFlowSplit() {
        long same = IntStream.range(0, 2000).mapToObj(i -> UUID.nameUUIDFromBytes(("v" + i).getBytes()))
                .filter(id -> PostgresCoachOpenings.byAccount(id).equals(PostgresCoachFlows.byAccount(id))).count();
        assertThat(same).isBetween(900L, 1100L);
    }

    @Test void noneAssignsEveryoneToA() {
        assertThat(CoachOpenings.NONE.assign(null)).isEqualTo(CoachOpenings.A);
    }
}
