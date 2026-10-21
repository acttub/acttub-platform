package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 분석 완료를 여럿에게 알린다(SOMA-780: 알림과 첫 질문 미리 쓰기). */
class AnalysisCompletionListenerTest {
    final UUID session = UUID.randomUUID();
    final UUID owner = UUID.randomUUID();

    @Test void everyListenerHearsEvenWhenOthersFailAndTheFailuresComeBackTogether() {
        var heard = new ArrayList<String>();
        AnalysisCompletionListener push = id -> heard.add("push " + id);
        AnalysisCompletionListener broken = id -> { throw new IllegalStateException("push down"); };
        AnalysisCompletionListener alsoBroken = id -> { throw new IllegalStateException("second"); };
        AnalysisCompletionListener coach = new AnalysisCompletionListener() {
            @Override public void onAnalysisComplete(UUID id) { heard.add("coach without owner " + id); }
            @Override public void onAnalysisComplete(UUID id, UUID user) { heard.add("coach " + id + " " + user); }
        };
        var all = AnalysisCompletionListener.all(List.of(push, broken, coach, alsoBroken));

        assertThatThrownBy(() -> all.onAnalysisComplete(session, owner)).hasMessage("push down")
                .satisfies(failure -> assertThat(failure.getSuppressed()).hasSize(1));
        assertThat(heard).containsExactly("push " + session, "coach " + session + " " + owner);

        heard.clear();
        assertThatThrownBy(() -> all.onAnalysisComplete(session)).hasMessage("push down");
        assertThat(heard).containsExactly("push " + session, "coach " + session + " null");
    }

    @Test void noneOrOneListenerNeedsNoWrapper() {
        assertThat(AnalysisCompletionListener.all(null)).isNull();
        assertThat(AnalysisCompletionListener.all(List.of())).isNull();
        AnalysisCompletionListener only = id -> { };
        assertThat(AnalysisCompletionListener.all(List.of(only))).isSameAs(only);
        var heard = new ArrayList<UUID>();
        AnalysisCompletionListener plain = heard::add;
        plain.onAnalysisComplete(session, owner);
        assertThat(heard).as("주인을 모르는 쪽은 회차만 받는다").containsExactly(session);
    }
}
