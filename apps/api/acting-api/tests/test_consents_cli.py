from acting_api.consents import main
from auth_test_support import FakeAuthStore


def test_publish_reads_markdown_and_list_prints_metadata(tmp_path, capsys):
    store = FakeAuthStore()
    markdown = tmp_path / "terms.md"
    markdown.write_text("# Terms\n\nBe kind.", encoding="utf-8")

    assert (
        main(
            [
                "publish",
                "--type",
                "terms",
                "--version",
                "2026-07-17",
                "--title",
                "Terms of Service",
                "--file",
                str(markdown),
                "--required",
            ],
            store=store,
        )
        == 0
    )
    published_output = capsys.readouterr().out
    document = next(iter(store.documents.values()))
    assert str(document.id) in published_output
    assert document.body == "# Terms\n\nBe kind."
    assert document.required is True

    assert main(["list"], store=store) == 0
    listed = capsys.readouterr().out
    assert "terms" in listed
    assert "2026-07-17" in listed
    assert "Terms of Service" in listed
    assert "Be kind" not in listed
