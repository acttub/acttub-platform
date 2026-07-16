from datetime import datetime, timezone
from uuid import UUID

import pytest

from acting_api.api_keys import main
from acting_api.db.store import ApiKeyRecord
from acting_api.security import hash_api_key

KEY_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


class FakeKeyStore:
    def __init__(self):
        self.created = None
        self.revoked = None
        self.records = []

    def create_api_key(self, **kwargs):
        self.created = kwargs
        record = ApiKeyRecord(
            id=KEY_ID,
            label=kwargs["label"],
            rate_limit_per_min=kwargs["rate_limit_per_min"],
            is_active=True,
            created_at=datetime(2026, 7, 16, tzinfo=timezone.utc),
            revoked_at=None,
        )
        self.records.append(record)
        return record

    def revoke_api_key(self, key_id):
        self.revoked = key_id
        return key_id == KEY_ID

    def list_api_keys(self):
        return self.records


def test_issue_prints_plaintext_once_and_stores_only_hash(capsys):
    store = FakeKeyStore()
    plain = "act_one-time-secret"
    assert (
        main(
            ["issue", "--label", "mobile", "--rate-limit-per-min", "17"],
            store=store,
            token_factory=lambda: plain,
        )
        == 0
    )
    output = capsys.readouterr().out
    assert output.count(plain) == 1
    assert store.created == {
        "key_hash": hash_api_key(plain),
        "label": "mobile",
        "rate_limit_per_min": 17,
    }
    assert plain not in repr(store.created)


def test_issue_rejects_non_positive_limit():
    with pytest.raises(SystemExit, match="must be positive"):
        main(
            ["issue", "--label", "bad", "--rate-limit-per-min", "0"],
            store=FakeKeyStore(),
        )


def test_revoke_by_uuid(capsys):
    store = FakeKeyStore()
    assert main(["revoke", str(KEY_ID)], store=store) == 0
    assert store.revoked == KEY_ID
    assert str(KEY_ID) in capsys.readouterr().out


def test_revoke_missing_returns_nonzero(capsys):
    store = FakeKeyStore()
    missing = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    assert main(["revoke", str(missing)], store=store) == 1
    assert "not found" in capsys.readouterr().err


def test_list_contains_metadata_not_hash_or_plaintext(capsys):
    store = FakeKeyStore()
    main(
        ["issue", "--label", "web"],
        store=store,
        token_factory=lambda: "act_hidden",
    )
    capsys.readouterr()
    assert main(["list"], store=store) == 0
    output = capsys.readouterr().out
    assert "web" in output
    assert "rate_limit_per_min" in output
    assert "act_hidden" not in output
    assert hash_api_key("act_hidden") not in output
