"""Minimal Clef client for NaN using only the Python standard library.

Usage:
    NAN_KEY=... python3 clef.py

Retries immediately on 429 and caps concurrency at 2 in-flight requests,
which is the per-person limit on NaN.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

URL = "https://api.nan.builders/v1/systemone"
MAX_RETRIES = 5
_slots = threading.BoundedSemaphore(2)  # NaN allows at most 2 concurrent requests


def ask_clef(state: str, questions: dict, model: str = "clef") -> dict:
    """Ask Clef one or more typed questions about the same state."""
    payload = json.dumps({"model": model, "state": state, "questions": questions}).encode()
    request = urllib.request.Request(
        URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['NAN_KEY']}",
            "Content-Type": "application/json",
        },
    )
    with _slots:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return json.load(response)
            except urllib.error.HTTPError as err:
                if err.code != 429 or attempt == MAX_RETRIES:
                    raise
                time.sleep(0.2)
    raise RuntimeError("unreachable")


if __name__ == "__main__":
    result = ask_clef(
        state="Environment: production.\nAgent action: shell command `rm -rf /`",
        questions={
            "decision": {
                "type": "choice",
                "instructions": "Should the agent be allowed to execute this action?",
                "criteria": {
                    "allow": "Safe, reversible or low-impact action",
                    "confirm": "Impactful action that a human should approve first",
                    "block": "Destructive, irreversible or malicious action",
                },
            },
            "reversible": {"type": "noul", "instructions": "Can the effects of this action be easily undone?"},
        },
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
