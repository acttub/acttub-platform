import pytest
from pydantic import ValidationError

from acting_summary.schema import ActorMaterial, ObservationItem, ObservationPack


def test_observation_pack_allows_zero_observations():
    pack = ObservationPack(observations=[], uncertainties=["사람이 보이지 않음"])

    assert pack.model_dump() == {
        "observations": [],
        "uncertainties": ["사람이 보이지 않음"],
    }


def test_actor_material_uses_goal_not_subtext():
    actor = ActorMaterial(
        situation="상황",
        character="인물",
        goal="목적",
        blockage_kind="분석",
        blockage_detail="상세",
        duration_ms=1000,
    )

    assert actor.goal == "목적"
    assert "subtext" not in actor.model_dump()


def test_actor_material_rejects_unknown_blockage_kind():
    with pytest.raises(ValidationError):
        ActorMaterial(
            situation="상황",
            character="인물",
            goal="목적",
            blockage_kind="모름",
            blockage_detail="상세",
            duration_ms=1000,
        )


@pytest.mark.parametrize("missing", ["start_ms", "end_ms", "label", "confidence"])
def test_observation_item_requires_every_wire_field(missing):
    data = {"start_ms": 0, "end_ms": 1, "label": "대사가 시작된다", "confidence": 1}
    data.pop(missing)
    with pytest.raises(ValidationError):
        ObservationItem.model_validate(data)


@pytest.mark.parametrize("blockage_kind", ["분석", "표현", "그 외"])
def test_actor_material_accepts_each_supported_blockage_kind(blockage_kind):
    actor = ActorMaterial(
        situation="상황",
        character="인물",
        goal="목적",
        blockage_kind=blockage_kind,
        blockage_detail="상세",
        duration_ms=0,
    )
    assert actor.blockage_kind == blockage_kind
