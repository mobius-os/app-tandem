#!/usr/bin/env python3
"""Migrate Tandem's persisted and pending generation model ids."""

from __future__ import annotations

import json
from pathlib import Path
import sys

RETIRED_MODEL_IDS = {
  "claude-opus-4-5-20251001": "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20251001": "claude-sonnet-4-5-20250929",
  "claude-opus-4-6-20251015": "claude-opus-4-6",
  "claude-opus-4-7-20251215": "claude-opus-4-7",
  "claude-sonnet-4-7-20251215": "claude-sonnet-4-6",
}


def migrate_prefs(prefs: object) -> tuple[object, bool]:
  if not isinstance(prefs, dict):
    return prefs, False
  migrated = dict(prefs)
  changed = False
  replacement = RETIRED_MODEL_IDS.get(prefs.get("gen_model"))
  if replacement:
    migrated["gen_model"] = replacement
    changed = True
  request = prefs.get("next_request")
  if isinstance(request, dict):
    replacement = RETIRED_MODEL_IDS.get(request.get("model"))
    if replacement:
      migrated["next_request"] = {**request, "model": replacement}
      changed = True
  return (migrated, True) if changed else (prefs, False)


def migrate_file(path: Path) -> bool:
  try:
    value = json.loads(path.read_text(encoding="utf-8"))
  except (OSError, ValueError):
    return False
  migrated, changed = migrate_prefs(value)
  if changed:
    path.write_text(json.dumps(migrated, separators=(",", ":")), encoding="utf-8")
  return changed


if __name__ == "__main__":
  print("changed" if migrate_file(Path(sys.argv[1])) else "unchanged")
