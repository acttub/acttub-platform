package com.acttub.actingapi.feature.reading.adapter.voice;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.coach.app.CoachReadingAudio;
import com.acttub.actingapi.feature.practice.app.ReadingVoice;
import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials;
import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials.Material;
import com.acttub.actingapi.feature.reading.app.RecordingSounds;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues;
import com.acttub.actingapi.integration.media.AudioJoiner;
import com.acttub.actingapi.integration.storage.ObjectStorage;

/**
 * 리딩 녹음 코칭(reading.voice-coaching, SOMA-791). 코칭 시작 전 확인(연습 도메인)과 코치가 올릴 소리·글(코치 도메인)을 준다.
 * 소리 든 내 대사 녹음만 대본 순서대로 골라({@link ReadingVoiceMaterial#prepare}) 내려받아 잇고, 서버가 잰 소리 단서를 붙인다.
 */
public class ReadingVoiceCoaching implements ReadingVoice, CoachReadingAudio {

    private final ReadingVoiceMaterials materials;
    private final Supplier<ObjectStorage> storage;
    private final RecordingSounds sounds;
    private final AudioJoiner joiner;
    /** 회차·녹음별 모델 글. 오래된 것부터 버린다. */
    private final Map<String, String> texts = java.util.Collections.synchronizedMap(new java.util.LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > 200;
        }
    });

    public ReadingVoiceCoaching(ReadingVoiceMaterials materials, Supplier<ObjectStorage> storage, RecordingSounds sounds,
            AudioJoiner joiner) {
        this.materials = materials;
        this.storage = storage;
        this.sounds = sounds == null ? RecordingSounds.NONE : sounds;
        this.joiner = joiner;
    }

    @Override
    public Check check(UUID userId, UUID readingSessionId) {
        Material material = materials.material(userId, readingSessionId);
        if (material == null) return Check.NOT_FOUND;
        return prepared(material).clips().size() >= ReadingVoiceMaterial.MIN_CLIPS ? Check.READY : Check.NOT_ENOUGH_AUDIO;
    }

    /** 리딩 완료 화면 카드: 열 수 있는지와 이미 시작한 코칭 회차. */
    public Availability availability(UUID userId, UUID readingSessionId) {
        Check check = check(userId, readingSessionId);
        if (check == Check.NOT_FOUND) return null;
        return new Availability(check == Check.READY, materials.practiceOf(userId, readingSessionId));
    }

    public record Availability(boolean available, UUID practiceId) {
    }

    @Override
    public CoachReadingAudio.Prepared prepare(UUID userId, UUID practiceId, boolean withAudio) {
        UUID readingSessionId = materials.readingSessionOf(userId, practiceId);
        if (readingSessionId == null) return null;
        Material material = materials.material(userId, readingSessionId);
        if (material == null) return null;
        ReadingVoiceMaterial.Prepared prepared = prepared(material);
        if (prepared.clips().isEmpty()) return null;
        Map<UUID, Integer> durations = new LinkedHashMap<>();
        for (ReadingVoiceMaterial.Recording recording : material.recordings()) {
            if (recording.lineId() != null) durations.put(recording.lineId(), recording.durationMs());
        }
        // 같은 녹음이면 같은 열쇠다 — 다시 녹음하면 객체 키가 바뀌어 새로 올린다.
        String sourceKey = readingSessionId + ":" + Integer.toHexString(String.join("|",
                prepared.clips().stream().map(Clip::objectKey).toList()).hashCode());
        // 소리 재기는 녹음을 내려받아 채점 서비스를 부른다 — 같은 녹음이면 턴마다 다시 재지 않고 처음 만든 글을 쓴다.
        String text = texts.computeIfAbsent(practiceId + ":" + sourceKey, key -> ReadingVoiceMaterial.modelText(prepared, durations,
                RecordingSoundCues.block(RecordingSoundCues.pick(prepared.clips(), sounds.measure(prepared.clips())))));
        Path audio = withAudio ? join(prepared.clips()) : null;
        return new CoachReadingAudio.Prepared(audio, "audio/wav", sourceKey, text);
    }

    private static ReadingVoiceMaterial.Prepared prepared(Material material) {
        return ReadingVoiceMaterial.prepare(material.lines(), material.myCharacterIds(), material.recordings());
    }

    private Path join(List<Clip> clips) {
        Path folder = null;
        List<Path> downloaded = new ArrayList<>();
        try {
            // 배우의 목소리라 주인만 읽고 쓰게 만든다. 이은 파일은 같은 폴더 밖(임시 폴더 바로 아래)에 둔다.
            folder = Files.createTempDirectory("reading-voice-", PosixFilePermissions.asFileAttribute(
                    PosixFilePermissions.fromString("rwx------")));
            for (Clip clip : clips) {
                Path local = folder.resolve("clip-" + clip.number() + ".m4a");
                storage.get().downloadToPath(clip.objectKey(), local);
                downloaded.add(local);
            }
            Path joined = joiner.join(downloaded, ReadingVoiceMaterial.GAP_MS);
            Path moved = Files.createTempFile("reading-voice-", ".wav", PosixFilePermissions.asFileAttribute(
                    PosixFilePermissions.fromString("rw-------")));
            return Files.move(joined, moved, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        } finally {
            for (Path local : downloaded) {
                try { Files.deleteIfExists(local); } catch (IOException ignored) { }
            }
            if (folder != null) {
                try (var rest = Files.list(folder)) {
                    for (Path left : rest.toList()) Files.deleteIfExists(left);
                    Files.deleteIfExists(folder);
                } catch (IOException ignored) { }
            }
        }
    }
}
