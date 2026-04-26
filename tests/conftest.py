import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

os.environ.setdefault("AIDEV_PROJECT_ROOT", str(REPO_ROOT))

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
