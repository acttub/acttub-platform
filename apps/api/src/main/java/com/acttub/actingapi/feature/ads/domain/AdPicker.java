package com.acttub.actingapi.feature.ads.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 칸 하나에 무엇을 띄울지 고른다(SOMA-876).
 *
 * <ol>
 *   <li>첫 연습을 끝내기 전이면 아무것도 없다(NONE) — 앱의 첫 사용자 홈과 같은 기준.</li>
 *   <li>연습 중 칸(PRACTICE)은 Pro 면 없고, 무료면 A/B 로 켠 사람만 받는다.</li>
 *   <li>칸과 규격 이미지가 맞는 학원 직접 광고(DIRECT).</li>
 *   <li>칸과 대상이 맞는 우리 앱 광고(HOUSE). Pro 에게 Pro 권유(대상 free)는 안 간다.</li>
 *   <li>없으면 AdMob 으로 채운다(NETWORK).</li>
 * </ol>
 * 같은 단계 후보가 여럿이면 priority 가 가장 큰 것들 중에서 사람·날마다 하나로 돌린다.
 */
public final class AdPicker {

    public enum Kind { DIRECT, HOUSE, NETWORK, NONE }

    /** 고른 결과. {@code ad} 는 DIRECT·HOUSE 일 때만 있다. */
    public record Pick(Kind kind, AdSlot slot, Ad ad) {
        static Pick none(AdSlot slot) {
            return new Pick(Kind.NONE, slot, null);
        }
    }

    /**
     * @param practiced  첫 연습(코칭 노트·리딩 완료·챌린지 참여)을 한 번이라도 끝냈는가
     * @param pro        Pro 인가
     * @param practiceOn 연습 중 칸 A/B 에서 켠 쪽인가
     */
    public record Viewer(UUID userId, boolean practiced, boolean pro, boolean practiceOn) {
    }

    private AdPicker() {
    }

    public static Pick pick(AdSlot slot, Viewer viewer, List<Ad> candidates, LocalDate day) {
        if (!viewer.practiced()) {
            return Pick.none(slot);
        }
        if (slot.phase() == AdSlot.Phase.PRACTICE && (viewer.pro() || !viewer.practiceOn())) {
            return Pick.none(slot);
        }
        List<Ad> direct = candidates.stream()
                .filter(ad -> Ad.DIRECT.equals(ad.kind()) && ad.targets(slot) && ad.imageFor(slot.size()) != null)
                .toList();
        if (!direct.isEmpty()) {
            return new Pick(Kind.DIRECT, slot, rotate(direct, viewer.userId(), slot, day));
        }
        List<Ad> house = candidates.stream()
                .filter(ad -> Ad.HOUSE.equals(ad.kind()) && ad.targets(slot) && audienceMatches(ad.audience(), viewer.pro())
                        && hasPath(ad) && (ad.imageFor(slot.size()) != null || !Ad.blank(ad.headline())))
                .toList();
        if (!house.isEmpty()) {
            return new Pick(Kind.HOUSE, slot, rotate(house, viewer.userId(), slot, day));
        }
        return new Pick(Kind.NETWORK, slot, null);
    }

    static boolean audienceMatches(String audience, boolean pro) {
        if (audience == null || "all".equals(audience)) {
            return true;
        }
        return pro ? "pro".equals(audience) : "free".equals(audience);
    }

    private static boolean hasPath(Ad ad) {
        return ad.appPath() != null && ad.appPath().startsWith("/");
    }

    private static Ad rotate(List<Ad> ads, UUID userId, AdSlot slot, LocalDate day) {
        int top = ads.stream().mapToInt(Ad::priority).max().orElse(0);
        List<Ad> best = ads.stream()
                .filter(ad -> ad.priority() == top)
                .sorted(Comparator.comparing(Ad::id))
                .toList();
        return best.get(bucket(userId + ":" + slot.key() + ":" + day, best.size()));
    }

    /**
     * 연습 중 칸 A/B 에서 켠 쪽인가. 사용자 id 해시로 고정 배정한다 — 같은 사람은 비율이 같으면 늘 같은 쪽이다.
     * {@code percent} 는 0~100, 범위 밖은 잘라 쓴다.
     */
    public static boolean practiceOn(UUID userId, int percent) {
        int clamped = Math.max(0, Math.min(100, percent));
        return bucket("ads-practice:" + userId, 100) < clamped;
    }

    static int bucket(String seed, int buckets) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(seed.getBytes(StandardCharsets.UTF_8));
            int value = ((hash[0] & 0xff) << 24) | ((hash[1] & 0xff) << 16) | ((hash[2] & 0xff) << 8) | (hash[3] & 0xff);
            return Math.floorMod(value, buckets);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
