from __future__ import annotations

import pytest

from cloud_gateway.proxy import ProxyPolicy


def test_file_proxy_only_allows_expected_api_families() -> None:
    policy = ProxyPolicy.files()
    assert policy.validate("GET", "resources/TV%20Shows") == "resources/TV%20Shows"
    assert policy.validate("PUT", "settings") == "settings"
    with pytest.raises(ValueError):
        policy.validate("GET", "../admin")
    with pytest.raises(ValueError):
        policy.validate("TRACE", "resources")
    with pytest.raises(ValueError):
        policy.validate("GET", "debug/pprof")


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
