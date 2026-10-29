package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;

/**
 * 상대역 목소리 (reading.cast). 배역마다 「내 배역이 아닐 때 읽을 목소리」를 정한다. 대본의 모든 배역을 저장 순서로
 * 세워 정하므로 어느 배역으로 연습하든 같은 배역은 같은 목소리다.
 *
 * <p>자동(저장값 NULL) 배역의 규칙 (SOMA-670) — 앱이 같은 규칙을 그대로 따라 한다.
 * <ol>
 *   <li>고정한 프리셋(목록 안의 값만)을 먼저 「쓴 것」으로 센다.</li>
 *   <li>자동 배역을 저장 순서로 돌며, 성별을 알면 성별·나이대의 선호 목록에서 아직 쓰지 않은 첫 프리셋을 준다. 그 성별을 다
 *       썼으면 목록의 첫 값(겹침 허용).</li>
 *   <li>성별을 모르면, 대본에서 성별을 아는 배역과 앞서 성별을 짐작해 준 배역을 세어 적은 쪽 성별의 「나이대 모름」 목록에서
 *       아직 쓰지 않은 첫 프리셋을 준다(SOMA-912 — 여자 둘에 성별 모를 남자 하나인 대본이 순환의 F1 을 받아 남자 배역을 여자
 *       목소리로 읽었다). 양쪽 수가 같으면 F1·M1·F2·M2… 순환을 이어 돌되 쓴 프리셋은 건너뛴다. 다 썼으면 순환 자리의 값을 그대로 준다.</li>
 *   <li>준 값도 「쓴 것」에 더한다.</li>
 * </ol>
 *
 * <p>저장값은 32자 이내 아무 문자열이지만(ScriptRules), 기기에 내장된 프리셋이 아니면 자동으로 다룬다 — 기기가
 * 읽을 수 없는 값이라서다. 그런 값은 쓴 것으로 세지 않는다.
 */
public final class VoiceAssignment {

    /** 남녀가 번갈아 나오게 섞은 자동 순서. 기기 프리셋 전부이기도 하다. */
    private static final List<String> AUTO_ROTATION = List.of("F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5");

    /** 10개 프리셋의 실측 음높이로 고른 선호 순서. 어린이는 청년 목록을 쓴다. 키 {@code null} 은 나이대 모름. */
    private static final Map<CharacterAgeBand, List<String>> MALE = Map.of(
            CharacterAgeBand.CHILD, List.of("M1", "M4", "M3", "M2", "M5"),
            CharacterAgeBand.YOUNG, List.of("M1", "M4", "M3", "M2", "M5"),
            CharacterAgeBand.ADULT, List.of("M3", "M4", "M2", "M1", "M5"),
            CharacterAgeBand.SENIOR, List.of("M5", "M2", "M3", "M4", "M1"));
    private static final List<String> MALE_UNKNOWN_AGE = List.of("M1", "M3", "M4", "M2", "M5");
    private static final Map<CharacterAgeBand, List<String>> FEMALE = Map.of(
            CharacterAgeBand.CHILD, List.of("F2", "F4", "F1", "F3", "F5"),
            CharacterAgeBand.YOUNG, List.of("F2", "F4", "F1", "F3", "F5"),
            CharacterAgeBand.ADULT, List.of("F1", "F3", "F4", "F5", "F2"),
            CharacterAgeBand.SENIOR, List.of("F5", "F3", "F1", "F4", "F2"));
    private static final List<String> FEMALE_UNKNOWN_AGE = List.of("F1", "F2", "F3", "F4", "F5");

    private VoiceAssignment() {
    }

    /**
     * 배역 하나의 입력.
     *
     * @param preset 저장된 프리셋. {@code null} 은 자동
     * @param gender 모르면 {@code null}
     * @param ageBand 모르면 {@code null}
     */
    public record Cast(String preset, CharacterGender gender, CharacterAgeBand ageBand) {
    }

    /** 성별·나이대를 모르는 대본 — 고정값을 뺀 F1·M1·F2·M2… 순환이다. */
    public static List<String> voices(List<String> presets) {
        List<Cast> cast = new ArrayList<>(presets.size());
        for (String preset : presets) {
            cast.add(new Cast(preset, null, null));
        }
        return assign(cast);
    }

    /**
     * @param cast 배역들, 저장 순서대로
     * @return 같은 순서의 목소리. 프리셋이면 그 값, 아니면 위 규칙의 값
     */
    public static List<String> assign(List<Cast> cast) {
        Set<String> used = new HashSet<>();
        for (Cast role : cast) {
            if (known(role.preset())) {
                used.add(role.preset());
            }
        }
        int male = 0;
        int female = 0;
        for (Cast role : cast) {
            CharacterGender gender = role.gender();
            if (gender == CharacterGender.MALE) {
                male++;
            } else if (gender == CharacterGender.FEMALE) {
                female++;
            }
        }
        List<String> voices = new ArrayList<>(cast.size());
        int pointer = 0;
        for (Cast role : cast) {
            if (known(role.preset())) {
                voices.add(role.preset());
                continue;
            }
            String pick;
            List<String> preferred = preferences(role.gender(), role.ageBand());
            if (preferred == null && male != female) {
                CharacterGender fewer = male < female ? CharacterGender.MALE : CharacterGender.FEMALE;
                preferred = preferences(fewer, role.ageBand());
                if (fewer == CharacterGender.MALE) {
                    male++;
                } else {
                    female++;
                }
            }
            if (preferred != null) {
                pick = preferred.stream().filter(preset -> !used.contains(preset)).findFirst().orElse(preferred.getFirst());
            } else {
                pick = null;
                for (int step = 0; step < AUTO_ROTATION.size(); step++) {
                    String candidate = AUTO_ROTATION.get((pointer + step) % AUTO_ROTATION.size());
                    if (!used.contains(candidate)) {
                        pick = candidate;
                        pointer += step + 1;
                        break;
                    }
                }
                if (pick == null) {
                    pick = AUTO_ROTATION.get(pointer % AUTO_ROTATION.size());
                    pointer++;
                }
            }
            used.add(pick);
            voices.add(pick);
        }
        return voices;
    }

    private static boolean known(String preset) {
        return preset != null && AUTO_ROTATION.contains(preset);
    }

    private static List<String> preferences(CharacterGender gender, CharacterAgeBand ageBand) {
        if (gender == null) {
            return null;
        }
        return switch (gender) {
            case MALE -> ageBand == null ? MALE_UNKNOWN_AGE : MALE.get(ageBand);
            case FEMALE -> ageBand == null ? FEMALE_UNKNOWN_AGE : FEMALE.get(ageBand);
        };
    }
}
