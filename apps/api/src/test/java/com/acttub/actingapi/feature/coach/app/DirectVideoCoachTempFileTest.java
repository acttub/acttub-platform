package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.junit.jupiter.api.Test;

/**
 * 코치가 내려받는 원본 영상 임시 파일은 공용 임시 폴더에 있어도 주인만 읽고 쓴다(미리 준비 경로와 같다). 자바의 임시 파일 기본 권한도
 * 같지만, 파일을 만드는 방법을 바꿔도 이 권한이 남는지 이 시험이 지킨다.
 */
class DirectVideoCoachTempFileTest {

    @Test void theDownloadedOriginalIsReadableAndWritableOnlyByItsOwnerAndIsDeletedAfterTheTurn() {
        var rig = new CoachTurnGoldenRig();
        var seen = new ArrayList<Set<PosixFilePermission>>();
        var paths = new ArrayList<Path>();
        doAnswer(call -> {
            Path path = call.getArgument(1);
            paths.add(path);
            seen.add(Files.getPosixFilePermissions(path));
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        }).when(rig.storage).downloadToPath(anyString(), any());
        rig.model.says(CoachTurnGoldenTest.OPENING);
        var result = rig.turn(CoachTurnGoldenRig.fresh(), null);
        rig.close();

        assertThat(result.reply().message()).isEqualTo("이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?");
        assertThat(seen).containsExactly(PosixFilePermissions.fromString("rw-------"));
        assertThat(paths).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(List.copyOf(rig.failures.reports())).isEmpty();
    }
}
