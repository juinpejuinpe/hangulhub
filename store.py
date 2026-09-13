"""JSON-file persistence layer.

All user data lives under DATA_DIR (default: ./data) as JSON:
  courses.json                     index of courses
  course_<id>.json                 course + chapters + file metadata
  files/<file_id>.json             parsed content for a single file
  uploads/<file_id>.<ext>          original bytes (kept for reference)
  decks/<deck_id>.json             flashcards + study state
  tests/<test_id>.json             generated tests + attempts
  chats/<chapter_id>.json          chat conversations per chapter
  settings.json                    API settings (key stays local)
"""

import json
import os
import random
import re
import string
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("HANGULHUB_DATA", ROOT / "data"))

_lock = threading.RLock()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _new_id(prefix: str, length: int = 10) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(random.choices(alphabet, k=length))}"


def _path(*parts) -> Path:
    p = DATA_DIR.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_json(path: Path, default):
    try:
        with _lock, open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data) -> None:
    with _lock:
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, path)


# ---------------------------------------------------------------- settings

def get_settings() -> dict:
    defaults = {
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-v4-flash",
        "temperature": 0.3,
    }
    return {**defaults, **load_json(_path("settings.json"), {})}


def save_settings(patch: dict) -> dict:
    settings = get_settings()
    for key in ("api_key", "base_url", "model", "temperature"):
        if key in patch:
            settings[key] = patch[key]
    save_json(_path("settings.json"), settings)
    return settings


# ---------------------------------------------------------------- courses

def list_courses() -> list:
    return load_json(_path("courses.json"), [])


def _save_courses(courses: list) -> None:
    save_json(_path("courses.json"), courses)


def get_course_index(course_id: str) -> dict | None:
    return next((c for c in list_courses() if c["id"] == course_id), None)


def create_course(name: str, target: str = "") -> dict:
    course = {
        "id": _new_id("course"),
        "name": name.strip() or "New course",
        "target": target.strip(),
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    courses = list_courses()
    courses.append(course)
    _save_courses(courses)
    save_json(_path(f"course_{course['id']}.json"),
              {"id": course["id"], "chapters": []})
    return course


def update_course(course_id: str, patch: dict) -> dict:
    courses = list_courses()
    for course in courses:
        if course["id"] == course_id:
            if "name" in patch:
                course["name"] = patch["name"].strip() or course["name"]
            if "target" in patch:
                course["target"] = patch["target"].strip()
            course["updatedAt"] = _now()
            _save_courses(courses)
            return course
    raise KeyError(course_id)


def delete_course(course_id: str) -> None:
    courses = list_courses()
    courses = [c for c in courses if c["id"] != course_id]
    _save_courses(courses)
    course = get_course(course_id)  # full body read below
    if course:
        for chapter in course.get("chapters", []):
            for fmeta in chapter.get("files", []):
                _delete_file_artifacts(fmeta["id"])
            _delete_chat_file(chapter["id"])
        for deck in _decks_for(course_id):
            _delete_deck_file(deck["id"])
        for test in _tests_for(course_id):
            _delete_test_file(test["id"])
    (DATA_DIR / f"course_{course_id}.json").unlink(missing_ok=True)


def get_course(course_id: str) -> dict:
    course = load_json(_path(f"course_{course_id}.json"), None)
    if course is None:
        raise KeyError(course_id)
    return course


def save_course(course: dict) -> None:
    course["updatedAt"] = _now()
    save_json(_path(f"course_{course['id']}.json"), course)


# ---------------------------------------------------------------- chapters

def add_chapter(course_id: str, name: str) -> dict:
    course = get_course(course_id)
    chapter = {
        "id": _new_id("ch"),
        "name": name.strip() or "New chapter",
        "createdAt": _now(),
        "files": [],
    }
    course.setdefault("chapters", []).append(chapter)
    save_course(course)
    return chapter


def update_chapter(course_id: str, chapter_id: str, name: str) -> dict:
    course = get_course(course_id)
    chapter = _chapter(course, chapter_id)
    chapter["name"] = name.strip() or chapter["name"]
    save_course(course)
    return chapter


def delete_chapter(course_id: str, chapter_id: str) -> None:
    course = get_course(course_id)
    chapter = _chapter(course, chapter_id)
    for fmeta in chapter.get("files", []):
        _delete_file_artifacts(fmeta["id"])
    _delete_chat_file(chapter_id)
    for deck in _decks_for(None, chapter_id):
        _delete_deck_file(deck["id"])
    for test in _tests_for(None, chapter_id):
        _delete_test_file(test["id"])
    course["chapters"] = [c for c in course["chapters"] if c["id"] != chapter_id]
    save_course(course)


def _chapter(course: dict, chapter_id: str) -> dict:
    for ch in course.get("chapters", []):
        if ch["id"] == chapter_id:
            return ch
    raise KeyError(chapter_id)


# ---------------------------------------------------------------- files

def add_file_meta(course_id: str, chapter_id: str, meta: dict) -> dict:
    course = get_course(course_id)
    chapter = _chapter(course, chapter_id)
    chapter.setdefault("files", []).append(meta)
    save_course(course)
    return meta


def get_file_meta(course_id: str, chapter_id: str, file_id: str) -> dict:
    course = get_course(course_id)
    chapter = _chapter(course, chapter_id)
    for fmeta in chapter.get("files", []):
        if fmeta["id"] == file_id:
            return fmeta
    raise KeyError(file_id)


def save_file_content(file_id: str, content: dict) -> None:
    save_json(_path("files", f"{file_id}.json"), content)


def load_file_content(file_id: str) -> dict:
    content = load_json(_path("files", f"{file_id}.json"), None)
    if content is None:
        raise KeyError(file_id)
    return content


def save_upload(file_id: str, ext: str, data: bytes) -> str:
    dest = _path("uploads", f"{file_id}.{ext}")
    with _lock, open(dest, "wb") as fh:
        fh.write(data)
    return str(dest)


def delete_file(course_id: str, chapter_id: str, file_id: str) -> None:
    course = get_course(course_id)
    chapter = _chapter(course, chapter_id)
    chapter["files"] = [f for f in chapter.get("files", []) if f["id"] != file_id]
    save_course(course)
    _delete_file_artifacts(file_id)


def _delete_file_artifacts(file_id: str) -> None:
    (DATA_DIR / "files" / f"{file_id}.json").unlink(missing_ok=True)
    for p in (DATA_DIR / "uploads").glob(f"{file_id}.*"):
        p.unlink(missing_ok=True)


def file_text(file_id: str, max_chars: int = 60000) -> str:
    """Flatten a parsed file into readable text for AI prompts."""
    content = load_file_content(file_id)
    parts = []
    if content.get("kind") == "table":
        headers = content.get("headers", [])
        for row in content.get("rows", []):
            cells = [str(row.get(h, "")) for h in headers]
            parts.append("\t".join(cells))
    else:
        parts.append(content.get("text", ""))
    text = "\n".join(parts).strip()
    if max_chars and len(text) > max_chars:
        text = text[:max_chars] + "\n…[rest of file omitted]"
    return text


# ---------------------------------------------------------------- decks

def create_deck(course_id: str, chapter_id: str, name: str,
                file_names: dict, cards: list, source: str = "files") -> dict:
    deck = {
        "id": _new_id("deck"),
        "name": name.strip() or "Vocabulary deck",
        "courseId": course_id,
        "chapterId": chapter_id,
        "source": source,
        "fileIds": list(file_names.keys()),
        "fileNames": file_names,
        "cards": cards,
        "createdAt": _now(),
        "updatedAt": _now(),
        "study": None,
    }
    _reset_study(deck)
    save_json(_path("decks", f"{deck['id']}.json"), deck)
    return deck


def new_card(front: str, back: str) -> dict:
    return {
        "id": new_question_id("card"),
        "front": front,
        "back": back,
        "correct": 0,
        "wrong": 0,
        "uncertain": 0,
        "learned": False,
    }


def update_deck_cards(deck_id: str, cards_in: list, name: str | None = None) -> dict:
    """Replace a deck's card text while keeping learning progress.

    Cards that keep their id keep their counters and learned flag; new cards
    join the study pool; cards left out are dropped.
    """
    deck = get_deck(deck_id)
    existing = {c["id"]: c for c in deck.get("cards", [])}
    cards = []
    for item in cards_in:
        if not isinstance(item, dict):
            continue
        front = str(item.get("front") or "").strip()
        back = str(item.get("back") or "").strip()
        if not front:
            continue
        card = existing.get(item.get("id"))
        if card is None:
            card = new_card(front, back)
        else:
            card["front"] = front
            card["back"] = back
        cards.append(card)
    if not cards:
        raise ValueError("A deck needs at least one card with a front side.")

    deck["cards"] = cards
    if name is not None and str(name).strip():
        deck["name"] = str(name).strip()

    ids = [c["id"] for c in cards]
    keep = set(ids)
    study = deck.get("study") or {"order": [], "index": 0, "completed": False}
    order = [cid for cid in study.get("order", []) if cid in keep]
    queued = set(order)
    for cid in ids:
        if cid not in queued:
            order.insert(random.randint(0, len(order)), cid)
            queued.add(cid)
    study["order"] = order
    study["index"] = min(study.get("index", 0), max(0, len(order) - 1))
    study["completed"] = bool(cards) and all(c.get("learned") for c in cards)
    deck["study"] = study
    save_deck(deck)
    return deck


def _reset_study(deck: dict) -> None:
    for card in deck["cards"]:
        card["learned"] = False
    deck["study"] = {
        "order": [c["id"] for c in deck["cards"]],
        "index": 0,
        "completed": False,
    }
    random.shuffle(deck["study"]["order"])
    deck["updatedAt"] = _now()


def get_deck(deck_id: str) -> dict:
    deck = load_json(_path("decks", f"{deck_id}.json"), None)
    if deck is None:
        raise KeyError(deck_id)
    return deck


def save_deck(deck: dict) -> None:
    deck["updatedAt"] = _now()
    save_json(_path("decks", f"{deck['id']}.json"), deck)


def relearn_deck(deck_id: str) -> dict:
    deck = get_deck(deck_id)
    for card in deck["cards"]:
        card.update(correct=0, wrong=0, uncertain=0, learned=False)
    _reset_study(deck)
    save_deck(deck)
    return deck


def answer_deck(deck_id: str, card_id: str, verdict: str) -> dict:
    deck = get_deck(deck_id)
    card = next((c for c in deck["cards"] if c["id"] == card_id), None)
    if card is None or verdict not in ("correct", "wrong", "uncertain"):
        raise KeyError("card or verdict")
    stats = deck.setdefault("stats", {"correct": 0, "wrong": 0, "uncertain": 0})
    card[verdict] = card.get(verdict, 0) + 1
    stats[verdict] += 1

    study = deck.get("study")
    if not study:
        _reset_study(deck)
        study = deck["study"]
    order = study["order"]
    index = study.get("index", 0)
    if index < len(order) and order[index] == card_id:
        if verdict == "correct":
            card["learned"] = True
            order.pop(index)
            study["index"] = 0 if index >= len(order) else index
        else:
            order.pop(index)
            order.append(card_id)
            study["index"] = 0 if index >= len(order) - 1 else index
    study["completed"] = bool(deck["cards"]) and all(
        c["learned"] for c in deck["cards"])
    save_deck(deck)
    return deck


def delete_deck(deck_id: str) -> None:
    _delete_deck_file(deck_id)


def _delete_deck_file(deck_id: str) -> None:
    (DATA_DIR / "decks" / f"{deck_id}.json").unlink(missing_ok=True)


def _decks_for(course_id: str | None, chapter_id: str | None = None) -> list:
    out = []
    for path in (DATA_DIR / "decks").glob("*.json"):
        deck = load_json(path, None)
        if not deck:
            continue
        if course_id and deck.get("courseId") != course_id:
            continue
        if chapter_id and deck.get("chapterId") != chapter_id:
            continue
        out.append(deck)
    return out


# ---------------------------------------------------------------- tests

def create_test(payload: dict) -> dict:
    test = {
        "id": _new_id("test"),
        "kind": payload.get("kind", "mcq"),
        "courseId": payload["courseId"],
        "chapterId": payload.get("chapterId"),
        "fileIds": payload.get("fileIds", []),
        "fileNames": payload.get("fileNames", {}),
        "title": payload.get("title", "Test"),
        "target": payload.get("target", ""),
        "prompt": payload.get("prompt", ""),
        "content": payload.get("content", {}),
        "createdAt": _now(),
        "attempts": [],
    }
    save_json(_path("tests", f"{test['id']}.json"), test)
    return test


def get_test(test_id: str) -> dict:
    test = load_json(_path("tests", f"{test_id}.json"), None)
    if test is None:
        raise KeyError(test_id)
    return test


def save_test(test: dict) -> None:
    save_json(_path("tests", f"{test['id']}.json"), test)


def delete_test(test_id: str) -> None:
    _delete_test_file(test_id)


def _delete_test_file(test_id: str) -> None:
    (DATA_DIR / "tests" / f"{test_id}.json").unlink(missing_ok=True)


def _tests_for(course_id: str | None, chapter_id: str | None = None) -> list:
    out = []
    for path in (DATA_DIR / "tests").glob("*.json"):
        test = load_json(path, None)
        if not test:
            continue
        if course_id and test.get("courseId") != course_id:
            continue
        if chapter_id and test.get("chapterId") != chapter_id:
            continue
        out.append(test)
    return out


def list_tests(course_id: str, chapter_id: str | None = None) -> list:
    tests = _tests_for(course_id, chapter_id)
    out = []
    for test in tests:
        attempts = test.get("attempts", [])
        last = attempts[-1] if attempts else None
        out.append({
            "id": test["id"],
            "kind": test.get("kind"),
            "title": test.get("title"),
            "createdAt": test.get("createdAt"),
            "attempts": len(attempts),
            "lastScore": (last.get("result", {}).get("score") if last else None),
            "lastMax": (last.get("result", {}).get("maxScore") if last else None),
        })
    return out


# ---------------------------------------------------------------- chats

def get_chat(chapter_id: str) -> list:
    return load_json(_path("chats", f"{chapter_id}.json"), [])


def append_chat(chapter_id: str, messages: list) -> list:
    chat = get_chat(chapter_id)
    chat.extend(messages)
    save_json(_path("chats", f"{chapter_id}.json"), chat)
    return chat


def clear_chat(chapter_id: str) -> None:
    save_json(_path("chats", f"{chapter_id}.json"), [])


def _delete_chat_file(chapter_id: str) -> None:
    (DATA_DIR / "chats" / f"{chapter_id}.json").unlink(missing_ok=True)


# ---------------------------------------------------------------- ids

def new_file_id() -> str:
    return _new_id("file")


def new_question_id(prefix: str = "q") -> str:
    return f"{prefix}_{_new_id('', 6)}"


def clean_text(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text
