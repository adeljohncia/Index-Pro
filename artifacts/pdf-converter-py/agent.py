#!/usr/bin/env python3
"""
Simple agent to set up, run, and attempt basic fixes for the PDF converter service.
Usage: python agent.py
It will:
 - create a virtualenv in .venv
 - install requirements from requirements.txt
 - run a syntax check on key files
 - try to start the FastAPI app (uvicorn) and stream logs for a short time
"""
import os
import sys
import subprocess
import venv
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).parent
VENV_DIR = ROOT / ".venv"
REQS = ROOT / "requirements.txt"

PY = sys.executable


def run(cmd, **kwargs):
    print("$ ", " ".join(cmd))
    return subprocess.run(cmd, **kwargs)


def ensure_venv():
    if not VENV_DIR.exists():
        print("Creating virtualenv...")
        venv.create(VENV_DIR, with_pip=True)
    else:
        print("Virtualenv exists")


def pip_install():
    pip = VENV_DIR / "bin" / "pip"
    if not pip.exists():
        raise RuntimeError("pip not found in venv")
    if not REQS.exists():
        print("requirements.txt not found, skipping install")
        return
    print("Installing requirements (this may take a while)...")
    res = run([str(pip), "install", "-r", str(REQS)])
    if res.returncode != 0:
        print("pip install failed")
        return False
    return True


def py_compile_check():
    print("Running syntax checks...")
    files = [ROOT / "main.py", ROOT / "converter.py", ROOT / "ocr_engine.py"]
    py = VENV_DIR / "bin" / "python"
    for f in files:
        if not f.exists():
            print(f"Skipping missing file: {f.name}")
            continue
        print(f"Checking {f.name}...")
        res = run([str(py), "-m", "py_compile", str(f)])
        if res.returncode != 0:
            print(f"Syntax errors in {f.name}")
            return False
    return True


def start_uvicorn(duration=8):
    py = VENV_DIR / "bin" / "python"
    uvicorn = [str(py), "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
    print("Starting uvicorn for a short smoke test...")
    p = subprocess.Popen(uvicorn, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start = time.time()
    try:
        while True:
            line = p.stdout.readline()
            if not line:
                break
            print(line.rstrip())
            if time.time() - start > duration:
                break
    finally:
        p.terminate()
        try:
            p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            p.kill()


if __name__ == '__main__':
    try:
        ensure_venv()
        ok = pip_install()
        if ok is False:
            print("Continuing despite install failures.")
        ok = py_compile_check()
        if not ok:
            print("Fix the syntax errors above before running the app.")
            sys.exit(1)
        start_uvicorn()
        print("Agent finished smoke test.")
        print("If uvicorn failed to start, check the printed logs and install system packages like libreoffice if you need document->PDF conversion.")
    except Exception as e:
        print("Agent failed:", e)
        sys.exit(2)
