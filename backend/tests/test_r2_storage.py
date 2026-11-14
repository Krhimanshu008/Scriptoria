import pytest
from app.services.r2_storage import R2StorageService, get_r2_storage


def test_r2_storage_lifecycle():
    storage = get_r2_storage()
    test_key = "_test_run/lifecycle_test.json"
    payload = {"book": "The Alchemist", "chapter": 1, "test": True}

    # 1. Put JSON
    saved_key = storage.put_json(test_key, payload)
    assert saved_key == test_key

    # 2. Exists
    assert storage.exists(test_key) is True

    # 3. Get JSON
    fetched = storage.get_json(test_key)
    assert fetched["book"] == "The Alchemist"
    assert fetched["chapter"] == 1

    # 4. List keys
    keys = storage.list_keys("_test_run/")
    assert test_key in keys

    # 5. Delete
    storage.delete_key(test_key)
    assert storage.exists(test_key) is False
