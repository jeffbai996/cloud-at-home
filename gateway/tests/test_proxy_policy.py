from __future__ import annotations

import pytest

from cloud_gateway.proxy import ProxyPolicy


def test_file_proxy_only_allows_expected_api_families() -> None:
    policy = ProxyPolicy.files()
    assert policy.validate("GET", "resources/TV Shows") == "resources/TV%20Shows"
    assert policy.validate("GET", "resources/100% real?#.txt") == "resources/100%25%20real%3F%23.txt"
    assert policy.validate("PUT", "settings") == "settings"
    with pytest.raises(ValueError):
        policy.validate("GET", "../admin")
    with pytest.raises(ValueError):
        policy.validate("TRACE", "resources")
    with pytest.raises(ValueError):
        policy.validate("GET", "debug/pprof")


@pytest.mark.parametrize(
    "path",
    [
        "resources-private/file.txt",
        "users-export",
        "settingsBackup",
        "commands-old/run",
        "usage-report",
    ],
)
def test_file_proxy_rejects_lookalike_api_families(path: str) -> None:
    with pytest.raises(ValueError):
        ProxyPolicy.files().validate("GET", path)


def test_media_proxy_denies_server_administration() -> None:
    policy = ProxyPolicy.media()
    assert policy.validate("GET", "Users/user-1/Items") == "Users/user-1/Items"
    assert policy.validate("POST", "Sessions/Playing/Progress") == "Sessions/Playing/Progress"
    assert policy.validate("DELETE", "UserPlayedItems/item-1") == "UserPlayedItems/item-1"
    with pytest.raises(ValueError):
        policy.validate("POST", "System/Shutdown")
    with pytest.raises(ValueError):
        policy.validate("DELETE", "Users/user-1")
    with pytest.raises(ValueError):
        policy.validate("DELETE", "Items/item-1")


@pytest.mark.parametrize(
    "path",
    [
        "ItemsExport",
        "PlaybackInformation",
        "ImagesBackup/poster",
        "UserPlayedItemsArchive/item-1",
        "System/Info/PublicExtra",
    ],
)
def test_media_proxy_rejects_lookalike_api_families(path: str) -> None:
    with pytest.raises(ValueError):
        ProxyPolicy.media().validate("GET", path)


def test_file_proxy_allows_get_previews() -> None:
    """Photos and Drive grids use FileBrowser's server-made JPEG previews —
    the only sane path for HEIC in a browser, and far cheaper than shipping
    originals as thumbnails."""
    policy = ProxyPolicy.files()
    assert policy.validate("GET", "preview/thumb/photos/a.jpg") == \
        "preview/thumb/photos/a.jpg"
    assert policy.validate("GET", "preview/big/photos/b c.heic") == \
        "preview/big/photos/b%20c.heic"


def test_file_proxy_rejects_writes_to_previews() -> None:
    """Previews are a read surface. A writable preview path would let a
    session mutate cache state through a route nothing audits."""
    policy = ProxyPolicy.files()
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        with pytest.raises(ValueError):
            policy.validate(method, "preview/thumb/photos/a.jpg")


def test_preview_lookalike_prefixes_stay_denied() -> None:
    policy = ProxyPolicy.files()
    with pytest.raises(ValueError):
        policy.validate("GET", "preview-admin/thumb/a.jpg")


def test_photos_policy_reads_only_the_photo_library() -> None:
    """Photos signs in with the same Drive credentials the Files app uses, so
    this policy is the ONLY thing between a photo wall and the whole Drive:
    read-only, and confined to the photos root. Anything wider silently turns
    a gallery into Drive access. Paths pass through unchanged — that account
    sees the Drive root, same as Drive does."""
    policy = ProxyPolicy.photos("photos")
    assert policy.validate("GET", "resources/photos") == "resources/photos"
    assert policy.validate("GET", "resources/photos/trip") == "resources/photos/trip"
    assert policy.validate("GET", "raw/photos/a b.jpg") == "raw/photos/a%20b.jpg"
    assert policy.validate("GET", "preview/thumb/photos/a.heic") == \
        "preview/thumb/photos/a.heic"
    assert policy.validate("GET", "preview/big/photos/a.jpg") == \
        "preview/big/photos/a.jpg"


def test_photos_policy_follows_a_renamed_root() -> None:
    policy = ProxyPolicy.photos("library/pics")
    assert policy.validate("GET", "resources/library/pics/a.jpg") == \
        "resources/library/pics/a.jpg"
    with pytest.raises(ValueError):
        policy.validate("GET", "resources/library")


def test_photos_policy_rejects_everything_else() -> None:
    policy = ProxyPolicy.photos("photos")
    for method, path in [
        ("GET", "resources/documents"),          # outside the library
        ("GET", "resources"),                    # the Drive root itself
        ("GET", "resources/photostudio"),        # lookalike prefix
        ("GET", "raw/secrets.env"),
        ("GET", "users"),
        ("POST", "resources/photos/new"),        # no writes, period
        ("PATCH", "resources/photos/a.jpg"),
        ("DELETE", "resources/photos/a.jpg"),
        ("PUT", "resources/photos/a.jpg"),
    ]:
        with pytest.raises(ValueError):
            policy.validate(method, path)
