package com.acttub.actingapi.feature.appversion.domain;

import java.util.Comparator;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 스토어에 나간 앱 판(1.2.3, SOMA-1150). 앱 판은 {@code apps/mobile/app.json} 의 {@code version} 이라 늘 세 자리다.
 * 두 자리(1.2)는 1.2.0 으로 읽고, 네 자리·꼬리표(1.2.3-beta)는 판으로 보지 않는다.
 */
public record AppVersion(int major, int minor, int patch) implements Comparable<AppVersion> {

    private static final Pattern WHOLE = Pattern.compile("(\\d{1,6})\\.(\\d{1,6})(?:\\.(\\d{1,6}))?");
    /** 글 안의 판. 앞뒤에 숫자·점이 붙어 있으면(1.2.3.4) 판으로 보지 않는다. */
    private static final Pattern INSIDE =
            Pattern.compile("(?<![\\d.])(\\d{1,6})\\.(\\d{1,6})(?:\\.(\\d{1,6}))?(?![\\d.])");
    private static final Comparator<AppVersion> ORDER = Comparator.comparingInt(AppVersion::major)
            .thenComparingInt(AppVersion::minor)
            .thenComparingInt(AppVersion::patch);

    public AppVersion {
        if (major < 0 || minor < 0 || patch < 0) {
            throw new IllegalArgumentException("판은 음수가 아니다");
        }
    }

    /** 글 전체가 판일 때만 읽는다. */
    public static Optional<AppVersion> parse(String text) {
        if (text == null) {
            return Optional.empty();
        }
        Matcher matcher = WHOLE.matcher(text.strip());
        return matcher.matches() ? Optional.of(of(matcher)) : Optional.empty();
    }

    /** 글 안의 첫 판. Play 출시 이름({@code 1.2.0}·{@code 28 (1.2.0)})에서 판을 꺼낸다. */
    public static Optional<AppVersion> find(String text) {
        if (text == null) {
            return Optional.empty();
        }
        Matcher matcher = INSIDE.matcher(text);
        return matcher.find() ? Optional.of(of(matcher)) : Optional.empty();
    }

    private static AppVersion of(Matcher matcher) {
        String patch = matcher.group(3);
        return new AppVersion(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)),
                patch == null ? 0 : Integer.parseInt(patch));
    }

    /** 잔판을 0으로 — 1.2.7 → 1.2.0. 최소 판은 이 값으로만 올린다. */
    public AppVersion minorFloor() {
        return new AppVersion(major, minor, 0);
    }

    @Override
    public int compareTo(AppVersion other) {
        return ORDER.compare(this, other);
    }

    @Override
    public String toString() {
        return major + "." + minor + "." + patch;
    }
}
