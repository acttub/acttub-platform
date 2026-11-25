package com.acttub.actingapi.feature.challenge.adapter.media;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Comparator;
import java.util.stream.Stream;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import com.acttub.actingapi.feature.challenge.app.EntryShareFrames;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.integration.media.FramedVideoComposer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 영상은 원본을 임시 디렉터리에 받아 틀 그림({@link ShareFrameOverlay})과 함께 {@link FramedVideoComposer} 로 합성해 올린다.
 * 미리보기는 저장소 주소에서 한 장면만 읽어 같은 틀을 씌운 JPEG 를 올린다. 임시 파일은 늘 지운다.
 */
@Component
class StorageEntryShareFrames implements EntryShareFrames {
    private static final int PROBE_URL_SECONDS = 120;
    private static final float JPEG_QUALITY = 0.86f;

    private final VideoStorage storage;
    private final FramedVideoComposer composer;

    @Autowired
    StorageEntryShareFrames(VideoStorage storage) { this(storage, new FramedVideoComposer()); }

    StorageEntryShareFrames(VideoStorage storage, FramedVideoComposer composer) { this.storage = storage; this.composer = composer; }

    @Override
    public void requireConfigured() { storage.requireConfigured(); }

    @Override
    public void renderVideo(ShareFrames.Card card, String sourceKey, String targetKey) {
        Path directory = null;
        try {
            // 임시 디렉터리는 모두가 쓰는 곳이라 본인만 들어가는 디렉터리로 만든다(원본 영상이 잠시 놓인다).
            directory = Files.createTempDirectory("acttub-frame-",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Path source = directory.resolve("source");
            storage.download(sourceKey, source);
            Path overlay = directory.resolve("overlay.png");
            ImageIO.write(ShareFrameOverlay.draw(card, ShareFrames.SCALE), "png", overlay.toFile());
            Path framed = composer.compose(source, overlay, ShareFrames.OUTPUT_WIDTH, ShareFrames.OUTPUT_HEIGHT,
                    ShareFrames.WINDOW.pixels(ShareFrames.SCALE));
            storage.upload(targetKey, "video/mp4", framed);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("share frame interrupted", interrupted);
        } catch (RuntimeException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new IllegalStateException("share frame failed", failure);
        } finally {
            delete(directory);
        }
    }

    @Override
    public void renderPreview(ShareFrames.Card card, String sourceKey, String targetKey) {
        Path directory = null;
        try {
            String url = storage.presignPlayback(sourceKey, PROBE_URL_SECONDS);
            if (url == null) throw new IllegalStateException("video storage is unavailable");
            BufferedImage still = ImageIO.read(new ByteArrayInputStream(composer.still(url)));
            if (still == null) throw new IOException("ffmpeg still is not an image");
            directory = Files.createTempDirectory("acttub-frame-",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Path jpeg = directory.resolve("preview.jpg");
            writeJpeg(preview(card, still), jpeg);
            storage.upload(targetKey, "image/jpeg", jpeg);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("share frame preview interrupted", interrupted);
        } finally {
            delete(directory);
        }
    }

    /**
     * 미리보기 한 장 — 서버 영상과 같은 자리에 같은 틀이다. 프레임이 없으면({@code card.frame()} 이 null) 장면만 9:16 으로
     * 꽉 채운다(「없음」 미리보기).
     */
    static BufferedImage preview(ShareFrames.Card card, BufferedImage still) {
        double scale = (double) ShareFrames.PREVIEW_WIDTH / ShareFrames.WIDTH;
        int width = ShareFrames.PREVIEW_WIDTH;
        int height = (int) Math.round(ShareFrames.HEIGHT * scale);
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            ShareFrameOverlay.quality(g);
            if (card.frame() == null) {
                cover(g, still, 0, 0, width, height);
                return out;
            }
            int[] window = ShareFrames.WINDOW.pixels(scale);
            cover(g, still, window[0], window[1], window[2], window[3]);
            g.drawImage(ShareFrameOverlay.draw(card, scale), 0, 0, null);
            return out;
        } finally {
            g.dispose();
        }
    }

    /** 그림을 상자에 꽉 차게(가운데 잘라) 그린다 — ffmpeg 의 scale=increase,crop 과 같다. */
    private static void cover(Graphics2D g, BufferedImage image, int x, int y, int width, int height) {
        double[] crop = ShareFrames.coverCrop(image.getWidth(), image.getHeight(), width, height);
        g.drawImage(image, x, y, x + width, y + height, (int) Math.round(crop[0]), (int) Math.round(crop[1]),
                (int) Math.round(crop[0] + crop[2]), (int) Math.round(crop[1] + crop[3]), null);
    }

    private static void writeJpeg(BufferedImage image, Path target) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (ImageOutputStream out = ImageIO.createImageOutputStream(target.toFile())) {
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
            writer.setOutput(out);
            writer.write(null, new IIOImage(image, null, null), param);
        } finally {
            writer.dispose();
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
