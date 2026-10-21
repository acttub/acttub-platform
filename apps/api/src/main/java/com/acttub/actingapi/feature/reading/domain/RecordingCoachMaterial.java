package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 리딩 녹음 코치(reading.recording-coach, 실험)가 모델에 보일 재료 — 구간의 대본 줄과 그 회차의 내 대사 녹음.
 *
 * <p>무엇을 "소리가 든 녹음"으로 볼지와 대본을 어떤 글로 펼칠지, 모델 출력에서 숨은 칸을 어떻게 걷을지를 여기서 정한다.
 * 저장·모델 호출은 모른다.
 *
 * <p>소리가 든 녹음: 기기가 받아쓴 글이 있으면(stt) 그 글이 비지 않아야 하고, 받아쓰기가 없으면(none) 길이가
 * {@link #SILENT_MAX_MS} 보다 길어야 한다. 10/19 QA 에서 말하지 않아도 리딩이 끝나 빈 녹음이 남은 일이 있어서다.
 * 같은 줄을 다시 녹음했으면 마지막 시도만 쓴다(저장소가 그렇게 준다).
 */
public final class RecordingCoachMaterial {

    /** 소리가 든 내 대사 녹음이 이만큼은 있어야 코치를 연다(리딩 완료 화면 카드 조건, SOMA-791). */
    public static final int MIN_CLIPS = 3;
    /** 한 번에 모델에 보이는 녹음 수. 넘으면 앞에서부터 이만큼만 쓴다. */
    public static final int MAX_CLIPS = 20;
    /** 인라인으로 보내는 소리의 합계 상한(Gemini 인라인 요청 20MB 아래). 넘는 녹음부터 뺀다. */
    public static final long MAX_TOTAL_BYTES = 15L * 1024 * 1024;
    /** 받아쓰기가 없는 녹음은 이보다 짧으면 소리가 없는 것으로 본다. */
    public static final int SILENT_MAX_MS = 800;

    private static final Pattern DESIGN = Pattern.compile("<설계>(.*?)</설계>", Pattern.DOTALL);
    private static final Pattern CHOSEN = Pattern.compile("고른\\s*녹음\\s*[:：]\\s*(\\d+)");

    private RecordingCoachMaterial() {
    }

    /** 구간 안의 대본 한 줄. {@code characterName} 은 지문·장면이면 {@code null}. */
    public record Line(UUID id, int ordinal, String kind, String text, UUID characterId, String characterName) {
    }

    /** 그 회차에서 한 줄의 마지막 녹음. {@code transcriptSource} 는 stt·none. */
    public record Recording(
            UUID lineId,
            String objectKey,
            String contentType,
            int durationMs,
            long byteSize,
            String transcript,
            String transcriptSource) {
    }

    /** 모델에 보일 녹음 하나. {@code label} 은 "녹음 n" 이고 n 은 1부터다. {@code text} 는 그 줄의 대본 글(빠르기 계산용). */
    public record Clip(int number, String label, UUID lineId, String objectKey, String contentType, String text) {
    }

    /** 모델에 보일 것 전부. */
    public record Prepared(String script, List<Clip> clips) {
        public UUID lineOf(Integer clipNumber) {
            if (clipNumber == null) {
                return null;
            }
            return clips.stream().filter(c -> c.number() == clipNumber).map(Clip::lineId).findFirst().orElse(null);
        }
    }

    /** 모델 출력을 나눈 것. {@code design} 은 배우에게 보이지 않는 칸, {@code chosenClip} 은 "고른 녹음: n" 의 n. */
    public record Output(String design, String message, Integer chosenClip) {
    }

    public static boolean audible(Recording recording) {
        if ("stt".equals(recording.transcriptSource())) {
            return recording.transcript() != null && !recording.transcript().isBlank();
        }
        return recording.durationMs() > SILENT_MAX_MS;
    }

    /**
     * 내 배역의 대사 줄 가운데 소리가 든 녹음이 있는 줄만 대본 순서대로 고른다.
     *
     * @param lines 구간의 줄, 순서는 상관없다
     * @param myCharacterIds 이 회차에서 배우가 읽은 배역
     * @param recordings 줄마다 마지막 녹음
     */
    public static Prepared prepare(List<Line> lines, Set<UUID> myCharacterIds, List<Recording> recordings) {
        Map<UUID, Recording> byLine = new LinkedHashMap<>();
        for (Recording recording : recordings) {
            if (recording.lineId() != null && audible(recording)) {
                byLine.put(recording.lineId(), recording);
            }
        }
        List<Line> ordered = lines.stream().sorted((a, b) -> Integer.compare(a.ordinal(), b.ordinal())).toList();
        List<Clip> clips = new ArrayList<>();
        Map<UUID, Integer> numbers = new LinkedHashMap<>();
        long total = 0;
        for (Line line : ordered) {
            if (clips.size() >= MAX_CLIPS) {
                break;
            }
            if (!"dialogue".equals(line.kind()) || !myCharacterIds.contains(line.characterId())) {
                continue;
            }
            Recording recording = byLine.get(line.id());
            if (recording == null || total + recording.byteSize() > MAX_TOTAL_BYTES) {
                continue;
            }
            total += recording.byteSize();
            int number = clips.size() + 1;
            clips.add(new Clip(number, "녹음 " + number, line.id(), recording.objectKey(), recording.contentType(), line.text()));
            numbers.put(line.id(), number);
        }
        StringBuilder script = new StringBuilder("[대본]\n");
        int shown = 0;
        for (Line line : ordered) {
            shown++;
            script.append(shown).append(". ");
            if ("dialogue".equals(line.kind())) {
                boolean mine = myCharacterIds.contains(line.characterId());
                script.append(line.characterName() == null ? "?" : line.characterName());
                if (mine) {
                    Integer number = numbers.get(line.id());
                    script.append(number == null ? "(내 대사, 녹음 없음)" : "(내 대사, 녹음 " + number + ")");
                } else {
                    script.append("(상대 대사)");
                }
                script.append(": ");
            } else {
                script.append("[").append("scene".equals(line.kind()) ? "장면" : "지문").append("] ");
            }
            script.append(line.text().strip()).append('\n');
        }
        return new Prepared(script.toString(), List.copyOf(clips));
    }

    /** 숨은 칸을 걷고 배우에게 보낼 말만 남긴다. 숨은 칸이 닫히지 않았으면 여는 꼬리표 뒤를 모두 숨은 칸으로 본다. */
    public static Output parse(String raw) {
        String text = raw == null ? "" : raw;
        String design = null;
        Matcher matcher = DESIGN.matcher(text);
        if (matcher.find()) {
            design = matcher.group(1).strip();
            text = text.substring(0, matcher.start()) + text.substring(matcher.end());
        } else {
            int open = text.indexOf("<설계>");
            if (open >= 0) {
                design = text.substring(open + "<설계>".length()).strip();
                text = text.substring(0, open);
            }
        }
        text = text.replace("</설계>", "").strip();
        Integer chosen = null;
        if (design != null) {
            Matcher number = CHOSEN.matcher(design);
            while (number.find()) {
                chosen = Integer.parseInt(number.group(1));
            }
        }
        return new Output(design, text, chosen);
    }

    /**
     * 코치가 소리를 평가하는 말. 프롬프트로 막아도 둘째 차례에 "잘 맞네요", "잘 어울려요", "소리로는 충분하니"가 나왔다
     * (dev 10/21). 이런 말은 배우에게 녹음이 잘됐다는 판정으로 읽히는데, 서버가 잰 소리는 다르다는 것뿐이지 좋다는 근거가 아니다.
     */
    static final Pattern EVALUATIVE = Pattern.compile(
            "잘\\s*(맞|어울|전달|살|표현|드러|나타)|충분|훌륭|좋(아요|네요|았|은\\s*소리)|자연스러|어색|완벽|멋지|대단");

    /** 배우에게 보낼 말에 평가하는 말이 있으면 그 말. 없으면 {@code null}. */
    public static String evaluative(String message) {
        Matcher m = EVALUATIVE.matcher(message == null ? "" : message);
        return m.find() ? m.group() : null;
    }
}
