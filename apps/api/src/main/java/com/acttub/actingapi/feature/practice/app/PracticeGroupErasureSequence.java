package com.acttub.actingapi.feature.practice.app;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;

/**
 * 연습 삭제에서 다른 기능의 기록을 정리하는 순서 (practice.library 「연습 삭제」, ADR-040). 표를 고치는 것은 각 표의 주인이고,
 * 여기는 순서만 안다.
 *
 * <p>순서는 {@link PracticeGroupErasureStep} 에 적힌 그대로다. 구현을 주입받은 순서(Spring 의 등록 순서)는 쓰지 않는다.
 * 자리마다 구현이 꼭 하나여야 하고, 빠지거나 겹치면 애플리케이션이 뜨지 않는다.
 */
@Service
public class PracticeGroupErasureSequence {

    private final Map<PracticeGroupErasureStep, PracticeGroupErasurePart> owners =
            new EnumMap<>(PracticeGroupErasureStep.class);

    public PracticeGroupErasureSequence(List<PracticeGroupErasurePart> parts) {
        for (PracticeGroupErasurePart part : parts) {
            for (PracticeGroupErasureStep step : part.steps()) {
                PracticeGroupErasurePart taken = owners.putIfAbsent(step, part);
                if (taken != null) {
                    throw new IllegalStateException("practice group erasure step " + step + " has two owners: "
                            + taken.getClass().getName() + ", " + part.getClass().getName());
                }
            }
        }
        Set<PracticeGroupErasureStep> unowned = EnumSet.allOf(PracticeGroupErasureStep.class);
        unowned.removeAll(owners.keySet());
        if (!unowned.isEmpty()) {
            throw new IllegalStateException("practice group erasure steps without an owner: " + unowned);
        }
    }

    /** <b>부르는 쪽의 트랜잭션 안에서</b> 부른다. */
    public void erase(ErasedPracticeGroup group) {
        for (PracticeGroupErasureStep step : PracticeGroupErasureStep.values()) {
            owners.get(step).erase(step, group);
        }
    }
}
