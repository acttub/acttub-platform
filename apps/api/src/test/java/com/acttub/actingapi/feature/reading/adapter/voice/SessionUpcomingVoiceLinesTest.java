package com.acttub.actingapi.feature.reading.adapter.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LineView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionCardView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.app.UpcomingVoiceLines.Line;
import org.junit.jupiter.api.Test;

/** 내 회차·내 대본에서만 다음 상대 대사를 고른다(SOMA-949). */
class SessionUpcomingVoiceLinesTest {
    private final UUID user = UUID.randomUUID();
    private final UUID session = UUID.randomUUID();
    private final UUID script = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
    private final UUID partner = UUID.randomUUID();
    private final SessionRepository sessions = mock(SessionRepository.class);
    private final ScriptRepository scripts = mock(ScriptRepository.class);
    private final SessionUpcomingVoiceLines upcoming = new SessionUpcomingVoiceLines(sessions, scripts);

    @Test
    void picksFromMySessionAndScript() {
        SessionCardView card = mock(SessionCardView.class);
        when(card.myCharacterIds()).thenReturn(List.of(me));
        SessionDetailView detail = mock(SessionDetailView.class);
        when(detail.card()).thenReturn(card);
        when(detail.scriptId()).thenReturn(script);
        when(sessions.find(user, session)).thenReturn(detail);
        ScriptView view = mock(ScriptView.class);
        when(view.characters()).thenReturn(List.of(
                new CharacterView(me, "서연", 0, null, "F2", null, null, 1, List.of(), false),
                new CharacterView(partner, "지호", 1, null, "M1", null, null, 2, List.of(), false)));
        when(view.lines()).thenReturn(List.of(
                new LineView(UUID.randomUUID(), 1, "dialogue", partner, "하나", 1, null, null),
                new LineView(UUID.randomUUID(), 2, "dialogue", me, "내 줄", 2, null, null),
                new LineView(UUID.randomUUID(), 3, "dialogue", partner, "둘", 3, null, null)));
        when(scripts.find(user, script)).thenReturn(view);

        assertThat(upcoming.after(user, session, "하나", "M1", 3)).containsExactly(new Line("둘", "M1"));
    }

    @Test
    void notMySessionOrScriptGivesNothing() {
        assertThat(upcoming.after(user, session, "하나", "M1", 3)).isEmpty();
        SessionDetailView detail = mock(SessionDetailView.class);
        when(detail.scriptId()).thenReturn(script);
        when(sessions.find(user, session)).thenReturn(detail);
        assertThat(upcoming.after(user, session, "하나", "M1", 3)).isEmpty();
    }
}
