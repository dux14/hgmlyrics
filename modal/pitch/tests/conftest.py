import json, pathlib, pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

@pytest.fixture
def analysis_small() -> dict:
    return json.loads((FIXTURES / "analysis_small.json").read_text())
