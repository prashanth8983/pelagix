"""Test fixtures shared by every module.

Sources may only read from the data directory (see scorebase.ingest), so tests that
write fixtures into pytest's temp directory add that directory to the allow list.
"""
import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def allow_tmp_sources(tmp_path_factory):
    base = str(tmp_path_factory.getbasetemp().parent)
    os.environ["SCOREBASE_SOURCE_DIRS"] = base
    yield
