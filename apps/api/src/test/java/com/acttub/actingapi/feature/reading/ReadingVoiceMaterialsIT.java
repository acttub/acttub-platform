package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeOwners;
import com.acttub.actingapi.feature.practice.app.PracticesFromReading;
import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials;
import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials.Material;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리딩 녹음 코칭이 읽는 재료의 결과와 문장을 고정한다. 코칭을 시작하고 코치가 묻는 흐름은 {@link ReadingVoiceCoachingIT} 가
 * 본다. 여기서는 그 테스트가 밟지 않는 구간 밖의 줄, 배역 없는 줄, 다른 대본·다른 회차의 행, 남의 회차, 나가는 문장을 본다.
 *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 회차 행과 내 배역 배열을 따로 읽던 두 조회가
 * 하나가 되어 문장이 하나 줄었다. 결과 테스트는 고치지 않았다.
 */
class ReadingVoiceMaterialsIT extends ReadingRepositoryFixture {

    @Autowired
    ReadingVoiceMaterials materials;

    @Autowired
    PracticesFromReading practices;

    @Autowired
    PracticeOwners practiceOwners;

    @Test
    @DisplayName("리딩 회차로 시작한 코칭 회차는 practice 가 답한다: 그 회차의 코칭 회차, 이어 간 회차가 가리키는 리딩 회차, 묶음. 남의 것·없는 것·리딩으로 시작하지 않은 것은 null 이다")
    void practiceAnswersWhichPracticeAReadingSessionStarted() {
        UUID owner = member();
        UUID script = script(owner);
        UUID first = line(script, 1, "dialogue", character(script, "니나", 0), "안녕");
        UUID session = session(owner, script, first, first);
        UUID root = practice(owner, null, 1, session, false);
        UUID continued = practice(owner, root, 2, null, true);
        UUID fromVideo = practice(owner, null, 1, null, true);
        UUID stranger = member();

        assertThat(practices.practiceOf(owner, session)).isEqualTo(root);
        assertThat(practices.practiceOf(stranger, session)).isNull();
        assertThat(practices.practiceOf(owner, UUID.randomUUID())).isNull();
        assertThat(practices.readingSessionOf(owner, root)).isEqualTo(session);
        assertThat(practices.readingSessionOf(owner, continued)).as("영상으로 이은 회차도 첫 회차의 리딩 회차").isEqualTo(session);
        assertThat(practices.readingSessionOf(owner, fromVideo)).isNull();
        assertThat(practices.readingSessionOf(stranger, root)).isNull();
        assertThat(practiceOwners.groupOf(owner, continued)).isEqualTo(root);
        assertThat(practiceOwners.groupOf(stranger, continued)).isNull();
        assertThat(practiceOwners.groupOf(owner, UUID.randomUUID())).isNull();

        assertThat(statementsOf(() -> practices.practiceOf(owner, session))).containsExactly("select practices");
        assertThat(statementsOf(() -> practices.readingSessionOf(owner, continued))).containsExactly("select practices");
        assertThat(statementsOf(() -> practiceOwners.groupOf(owner, continued))).containsExactly("select practices");
    }

    /** 묶음에 열린 회차는 하나뿐이라({@code uq_practices_open_root}) 이어 간 묶음의 앞 회차는 닫아 둔다. */
    private UUID practice(UUID owner, UUID root, int ordinal, UUID readingSession, boolean open) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,root_id,ordinal,stage,close_reason,experience_version,blockage_kind,sub_branch,
                                      situation,goal,reading_session_id)
                VALUES (?,?,?,?,?,?,'legacy','분석','캐릭터 분석','장면','목표',?)
                """, id, owner, root == null ? id : root, ordinal, open ? "conversing" : "closed",
                open ? null : "conversation_closed", readingSession);
        return id;
    }

    @Test
    @DisplayName("material: 내 배역, 구간(시작 줄~끝 줄) 안의 줄을 순서대로(배역 이름과 함께, 지문은 배역 없이), 그 회차의 줄마다 녹음을 낸다. 남의 회차·없는 회차는 null 이다")
    void materialReadsTheSessionsRangeAndRecordings() {
        UUID owner = member();
        UUID script = script(owner);
        UUID nina = character(script, "니나", 0);
        UUID kostya = character(script, "코스챠", 1);
        line(script, 1, "dialogue", nina, "구간 앞");
        UUID first = line(script, 2, "dialogue", nina, "안녕");
        UUID direction = line(script, 3, "direction", null, "사이");
        UUID last = line(script, 4, "dialogue", kostya, "왔구나");
        line(script, 5, "dialogue", nina, "구간 뒤");
        UUID session = session(owner, script, first, last, nina, kostya);
        UUID otherSession = session(owner, script, first, last, nina);
        recording(owner, session, first, 2, "reading/first.m4a");
        recording(owner, otherSession, last, 1, "reading/other-session.m4a");
        jdbc.update("UPDATE reading_recordings SET transcript='안녕', transcript_source='stt' WHERE object_key='reading/first.m4a'");
        UUID otherScript = script(owner);
        line(otherScript, 2, "dialogue", character(otherScript, "다른 배역", 0), "다른 대본의 줄");

        Material material = materials.material(owner, session);

        assertThat(material.myCharacterIds()).isEqualTo(Set.of(nina, kostya));
        assertThat(material.lines()).containsExactly(
                new ReadingVoiceMaterial.Line(first, 2, "dialogue", "안녕", nina, "니나"),
                new ReadingVoiceMaterial.Line(direction, 3, "direction", "사이", null, null),
                new ReadingVoiceMaterial.Line(last, 4, "dialogue", "왔구나", kostya, "코스챠"));
        assertThat(material.recordings()).containsExactly(
                new ReadingVoiceMaterial.Recording(first, "reading/first.m4a", "audio/mp4", 1200, 1000L, "안녕", "stt"));
        assertThat(materials.material(member(), session)).isNull();
        assertThat(materials.material(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("material: 「전체 듣기」 회차는 내 배역이 비어 있고 녹음이 없으면 녹음 목록도 비어 있다")
    void materialOfAListenAllSession() {
        UUID owner = member();
        UUID script = script(owner);
        UUID only = line(script, 1, "dialogue", character(script, "니나", 0), "안녕");
        UUID session = session(owner, script, only, only);

        Material material = materials.material(owner, session);

        assertThat(material.myCharacterIds()).isEmpty();
        assertThat(material.lines()).extracting(ReadingVoiceMaterial.Line::id).containsExactly(only);
        assertThat(material.recordings()).isEmpty();
    }

    @Test
    @DisplayName("material 이 보내는 문장: 회차 읽기 하나, 줄 하나, 녹음 하나다. 남의 회차면 회차 읽기에서 멈춘다")
    void materialSendsTheseStatements() {
        UUID owner = member();
        UUID script = script(owner);
        UUID only = line(script, 1, "dialogue", character(script, "니나", 0), "안녕");
        UUID session = session(owner, script, only, only);

        assertThat(statementsOf(() -> materials.material(owner, session))).containsExactly(
                "select reading_sessions", "select script_lines", "select reading_recordings");
        assertThat(statementsOf(() -> materials.material(member(), session))).containsExactly("select reading_sessions");
    }
}
