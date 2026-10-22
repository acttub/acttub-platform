package com.acttub.actingapi.feature.challenge.adapter.media;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Comparator;
import java.util.stream.Stream;
import com.acttub.actingapi.feature.challenge.app.EntryMosaics;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.integration.media.FaceMosaicRenderer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** 원본을 임시 디렉터리에 받아 {@link FaceMosaicRenderer} 로 가리고 모자이크본을 올린다. 임시 파일은 늘 지운다. */
@Component
class StorageEntryMosaics implements EntryMosaics {
    private final VideoStorage storage;
    private final FaceMosaicRenderer renderer;

    @Autowired
    StorageEntryMosaics(VideoStorage storage) { this(storage, new FaceMosaicRenderer()); }

    StorageEntryMosaics(VideoStorage storage, FaceMosaicRenderer renderer) { this.storage = storage; this.renderer = renderer; }

    @Override
    public boolean available() { return storage.configured() && renderer.available(); }

    @Override
    public boolean render(String objectKey, String mosaicKey) {
        Path directory = null;
        try {
            // 임시 디렉터리는 모두가 쓰는 곳이라 본인만 들어가는 디렉터리로 만든다(원본 영상이 잠시 놓인다).
            directory = Files.createTempDirectory("acttub-mosaic-",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Path source = directory.resolve("source");
            storage.download(objectKey, source);
            Path mosaic = renderer.render(source);
            storage.upload(mosaicKey, "video/mp4", mosaic);
            return true;
        } catch (FaceMosaicRenderer.NoFaceFound none) {
            return false;
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("face mosaic interrupted", interrupted);
        } catch (RuntimeException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new IllegalStateException("face mosaic failed", failure);
        } finally {
            delete(directory);
        }
    }

    private static void delete(Path directory) {
        if (directory == null) return;
        try (Stream<Path> paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
        } catch (IOException ignored) {
            // 남은 임시 파일은 다음 기동의 임시 디렉터리 정리에 맡긴다.
        }
    }
}
