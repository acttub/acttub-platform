package com.acttub.actingapi.feature.reading.adapter.voice;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.app.UpcomingVoiceLines;

/** 회차·대본 저장소에서 다음 상대 대사를 고른다(SOMA-949). 내 회차·내 대본이 아니면 빈 목록. */
public final class SessionUpcomingVoiceLines implements UpcomingVoiceLines {
    private final SessionRepository sessions;
    private final ScriptRepository scripts;

    public SessionUpcomingVoiceLines(SessionRepository sessions, ScriptRepository scripts) {
        this.sessions = sessions;
        this.scripts = scripts;
    }

    @Override
    public List<Line> after(UUID userId, UUID sessionId, String text, String preset, int count) {
        SessionDetailView session = sessions.find(userId, sessionId);
        if (session == null || session.scriptId() == null) return List.of();
        ScriptView script = scripts.find(userId, session.scriptId());
        if (script == null) return List.of();
        return UpcomingVoiceLines.pick(script.characters(), script.lines(), session.card().myCharacterIds(),
                session.startLineId(), session.endLineId(), text, preset, count);
    }

    /** 끝난 회차(지금 줄 없음)·남의 회차는 모른다고 답한다(SOMA-1000). */
    @Override
    public Integer ahead(UUID userId, UUID sessionId, String text, String preset) {
        SessionDetailView session = sessions.find(userId, sessionId);
        if (session == null || session.scriptId() == null || session.currentLineId() == null) return null;
        ScriptView script = scripts.find(userId, session.scriptId());
        if (script == null) return null;
        return UpcomingVoiceLines.aheadOf(script.characters(), script.lines(), session.card().myCharacterIds(),
                session.startLineId(), session.endLineId(), session.currentLineId(), text, preset);
    }
}
