from fastapi import FastAPI
from fastapi.testclient import TestClient

from acting_api.app import _PNG_SIGNATURE, _mount_static_frontend


def build_client(static_root) -> TestClient:
    app = FastAPI()
    _mount_static_frontend(app, static_root)
    return TestClient(app)


def test_extensionless_png_is_served_as_image_png(tmp_path):
    (tmp_path / "opengraph-image").write_bytes(_PNG_SIGNATURE + b"payload")
    client = build_client(tmp_path)

    response = client.get("/opengraph-image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_extensionless_non_png_keeps_default_media_type(tmp_path):
    (tmp_path / "healthz-page").write_bytes(b"plain payload")
    client = build_client(tmp_path)

    response = client.get("/healthz-page")

    assert response.status_code == 200
    assert response.headers["content-type"] != "image/png"


def test_files_with_extension_are_guessed_by_name(tmp_path):
    (tmp_path / "robots.txt").write_text("User-Agent: *\n", encoding="utf-8")
    client = build_client(tmp_path)

    response = client.get("/robots.txt")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")


def test_html_fallback_still_maps_extensionless_routes(tmp_path):
    (tmp_path / "home.html").write_text("<html></html>", encoding="utf-8")
    client = build_client(tmp_path)

    response = client.get("/home")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
