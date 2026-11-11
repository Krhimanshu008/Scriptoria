import sys
from pathlib import Path

# Ensure root directory is on Python path for Vercel Serverless Function
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from server import app

