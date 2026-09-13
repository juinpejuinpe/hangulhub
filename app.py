"""HangulHub local server — runs at http://127.0.0.1:8765"""

import os
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge

import ai_service
import parsing
import store
import topik_import

ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_MB = 60

app = Flask(__name__, static_folder="public", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _require(data, *keys):
    for key in keys:
        if not data.get(key):
            raise ApiError(f"Missing required field: {key}")
    return data


def _find_file_meta(course_id: str, file_id: str) -> dict:
    course = store.get_course(course_id)
    for chapter in course.get("chapters", []):
        for fmeta in chapter.get("files", []):
            if fmeta["id"] == file_id:
                return fmeta
    raise ApiError("File not found in this course.", 404)


def _file_names(course_id: str, file_ids: list) -> dict:
    names = {}
    for fid in file_ids:
        try:
            names[fid] = _find_file_meta(course_id, fid)["name"]
        except ApiError:
            continue
    return names


def _all_chapter_files(course_id: str) -> list:
    course = store.get_course(course_id)
    out = []
    for chapter in course.get("chapters", []):
        for fmeta in chapter.get("files", []):
            out.append(fmeta)
    return out


@app.errorhandler(RequestEntityTooLarge)
def _too_large(_err):
    return jsonify(error=f"File is too large (limit {MAX_UPLOAD_MB} MB)."), 413


@app.errorhandler(ApiError)
def _api_error(err):
    return jsonify(error=err.message), err.status


@app.errorhandler(ai_service.ApiError)
def _ai_error(err):
    return jsonify(error=str(err)), 502


@app.errorhandler(Exception)
def _unexpected(err):
    app.logger.exception("Unhandled error")
    return jsonify(error=f"Server error: {err}"), 500


@app.get("/")
def _index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/health")
def _health():
    return jsonify(ok=True, time=time.strftime("%H:%M:%S"))


# ---------------------------------------------------------------- courses

@app.get("/api/bootstrap")
def bootstrap():
    courses = []
    for meta in store.list_courses():
        try:
            course = store.get_course(meta["id"])
        except KeyError:
            continue
        chapters = []
        for chapter in course.get("chapters", []):
            chapters.append({
                "id": chapter["id"],
                "name": chapter["name"],
                "createdAt": chapter.get("createdAt"),
                "files": chapter.get("files", []),
            })
        decks = store._decks_for(meta["id"])
        tests = store._tests_for(meta["id"])
        courses.append({
            "id": meta["id"],
            "name": meta["name"],
            "target": meta.get("target", ""),
            "createdAt": meta.get("createdAt"),
            "chapters": chapters,
            "stats": {
                "chapters": len(chapters),
                "files": sum(len(c["files"]) for c in chapters),
                "decks": len(decks),
                "tests": len(tests),
            },
        })
    return jsonify(courses=courses)


@app.post("/api/courses")
def create_course():
    data = _body()
    course = store.create_course(data.get("name", ""), data.get("target", ""))
    return jsonify(course=course)


@app.patch("/api/courses/<course_id>")
def update_course(course_id):
    return jsonify(course=store.update_course(course_id, _body()))


@app.delete("/api/courses/<course_id>")
def remove_course(course_id):
    store.delete_course(course_id)
    return jsonify(ok=True)


@app.get("/api/courses/<course_id>")
def get_course(course_id):
    course = store.get_course(course_id)
    return jsonify(course=course)


# ---------------------------------------------------------------- chapters

@app.post("/api/courses/<course_id>/chapters")
def create_chapter(course_id):
    data = _body()
    chapter = store.add_chapter(course_id, data.get("name", ""))
    return jsonify(chapter=chapter)


@app.patch("/api/courses/<course_id>/chapters/<chapter_id>")
def rename_chapter(course_id, chapter_id):
    data = _body()
    return jsonify(chapter=store.update_chapter(course_id, chapter_id,
                                                data.get("name", "")))


@app.delete("/api/courses/<course_id>/chapters/<chapter_id>")
def remove_chapter(course_id, chapter_id):
    store.delete_chapter(course_id, chapter_id)
    return jsonify(ok=True)


# ---------------------------------------------------------------- files

@app.post("/api/courses/<course_id>/chapters/<chapter_id>/files")
def upload_file(course_id, chapter_id):
    data = request.form
    store.get_course(course_id)  # existence check
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        raise ApiError("No file was attached.")
    filename = Path(uploaded.filename).name
    raw = uploaded.read()
    if not raw:
        raise ApiError("The file is empty.")
    try:
        parsed = parsing.parse_file(filename, raw)
    except ValueError as exc:
        raise ApiError(str(exc))

    file_id = store.new_file_id()
    ext = Path(filename).suffix.lower().lstrip(".")
    ext = ext if ext and ext.isalnum() else "bin"
    store.save_upload(file_id, ext, raw)
    store.save_file_content(file_id, parsed)
    meta = _summary_meta(file_id, filename, ext, parsed, len(raw), data.get("note"))
    store.add_file_meta(course_id, chapter_id, meta)
    return jsonify(file=meta)


def _summary_meta(file_id: str, name: str, ext: str, parsed: dict,
                  size: int, note: str | None = None) -> dict:
    kind = parsed.get("kind", "text")
    meta = {
        "id": file_id,
        "name": name,
        "ext": ext,
        "kind": kind,
        "size": size,
        "uploadedAt": store._now(),
        "note": note or "",
    }
    if kind == "table":
        meta["headers"] = parsed.get("headers", [])
        meta["rowCount"] = len(parsed.get("rows", []))
        meta["headerRow"] = parsed.get("headerRow", True)
        meta["error"] = parsed.get("note", "")
    else:
        meta["chars"] = len(parsed.get("text", ""))
        meta["lines"] = len(parsed.get("lines", []))
        meta["pages"] = parsed.get("pages")
    return meta


@app.get("/api/files/<file_id>/preview")
def preview_file(file_id):
    content = store.load_file_content(file_id)
    if content.get("kind") == "table":
        rows = content.get("rows", [])[:100]
        return jsonify({
            "kind": "table",
            "headers": content.get("headers", []),
            "rows": rows,
            "rowCount": len(content.get("rows", [])),
            "headerRow": content.get("headerRow", True),
            "note": content.get("note", ""),
        })
    text = content.get("text", "")
    return jsonify({
        "kind": "text",
        "text": text[:30000],
        "chars": len(text),
        "lines": content.get("lines", [])[:200],
        "pages": content.get("pages"),
    })


@app.delete("/api/courses/<course_id>/chapters/<chapter_id>/files/<file_id>")
def remove_file(course_id, chapter_id, file_id):
    store.delete_file(course_id, chapter_id, file_id)
    return jsonify(ok=True)


@app.post("/api/courses/<course_id>/chapters/<chapter_id>/paste")
def paste_file(course_id, chapter_id):
    data = _body()
    text = data.get("text", "")
    if not text.strip():
        raise ApiError("Nothing to save.")
    name = (data.get("name") or "pasted text").strip() + ".txt"
    try:
        parsed = parsing.parse_file(name, text.encode("utf-8"))
    except ValueError as exc:
        raise ApiError(str(exc))
    file_id = store.new_file_id()
    store.save_file_content(file_id, parsed)
    meta = _summary_meta(file_id, name, "txt", parsed, len(text.encode("utf-8")))
    meta["pasted"] = True
    store.add_file_meta(course_id, chapter_id, meta)
    return jsonify(file=meta)


# ---------------------------------------------------------------- decks

@app.post("/api/decks")
def build_deck():
    data = _body()
    _require(data, "courseId", "chapterId", "files")
    course_id = data["courseId"]
    cards = []
    file_names = {}
    for item in data["files"]:
        file_id = item["fileId"]
        meta = _find_file_meta(course_id, file_id)
        file_names[file_id] = meta["name"]
        content = store.load_file_content(file_id)
        if content.get("kind") == "table":
            front = item.get("front")
            backs = item.get("back", [])
            if not front:
                raise ApiError(f"Pick a front column for {meta['name']}.")
            pairs = parsing.rows_to_pairs(content, front, backs or [front])
        else:
            pairs = parsing.text_to_pairs(content)
        seen = set()
        for front, back in pairs:
            key = (front.lower(), back.lower())
            if key in seen:
                continue
            seen.add(key)
            cards.append({
                "id": store.new_question_id("card"),
                "front": front,
                "back": back,
                "correct": 0,
                "wrong": 0,
                "uncertain": 0,
                "learned": False,
            })
    if not cards:
        raise ApiError(
            "No cards could be built. For Excel/CSV files check your column "
            "mapping; for text files each line should look like 'word — meaning'."
        )
    deck = store.create_deck(course_id, data["chapterId"], data.get("name", ""),
                             file_names, cards)
    return jsonify(deck=deck)


@app.post("/api/decks/manual")
def build_manual_deck():
    """Create a deck from cards typed straight into the app."""
    data = _body()
    _require(data, "courseId", "chapterId", "cards")
    course_id = data["courseId"]
    chapter_id = data["chapterId"]
    course = store.get_course(course_id)  # existence check
    if not any(ch["id"] == chapter_id for ch in course.get("chapters", [])):
        raise ApiError("Chapter not found in this course.", 404)
    if not isinstance(data["cards"], list):
        raise ApiError("cards must be a list of {front, back} objects.")

    cards = []
    seen = set()
    for item in data["cards"]:
        if not isinstance(item, dict):
            continue
        front = str(item.get("front") or "").strip()
        back = str(item.get("back") or "").strip()
        if not front:
            continue
        key = (front.lower(), back.lower())
        if key in seen:
            continue
        seen.add(key)
        cards.append(store.new_card(front, back))
    if not cards:
        raise ApiError("Type at least one card with something on the front.")

    deck = store.create_deck(course_id, chapter_id, data.get("name", ""),
                             {}, cards, source="manual")
    return jsonify(deck=deck)


@app.get("/api/decks/<deck_id>")
def get_deck(deck_id):
    return jsonify(deck=store.get_deck(deck_id))


@app.get("/api/listings")
def listings():
    course_id = request.args.get("courseId")
    chapter_id = request.args.get("chapterId")
    if not course_id:
        raise ApiError("courseId is required.")
    store.get_course(course_id)
    decks = store._decks_for(course_id, chapter_id)
    deck_out = []
    for deck in decks:
        cards = deck.get("cards", [])
        learned = sum(1 for c in cards if c.get("learned"))
        deck_out.append({
            "id": deck["id"],
            "name": deck.get("name"),
            "source": deck.get("source", "files"),
            "fileNames": list(deck.get("fileNames", {}).values()),
            "total": len(cards),
            "learned": learned,
            "percent": round(learned / len(cards) * 100) if cards else 0,
            "createdAt": deck.get("createdAt"),
            "chapterId": deck.get("chapterId"),
            "completed": bool(deck.get("study", {}).get("completed")),
        })
    tests = []
    for test in store._tests_for(course_id):
        if chapter_id is None or test.get("chapterId") in (None, chapter_id):
            attempts = test.get("attempts", [])
            last = attempts[-1] if attempts else None
            tests.append({
                "id": test["id"],
                "kind": test.get("kind"),
                "title": test.get("title"),
                "createdAt": test.get("createdAt"),
                "chapterId": test.get("chapterId"),
                "attempts": len(attempts),
                "lastScore": (last.get("result", {}).get("score") if last else None),
                "lastMax": (last.get("result", {}).get("maxScore") if last else None),
            })
    return jsonify(decks=deck_out, tests=tests)


@app.post("/api/decks/<deck_id>/answer")
def answer_deck(deck_id):
    data = _body()
    _require(data, "cardId", "verdict")
    deck = store.answer_deck(deck_id, data["cardId"], data["verdict"])
    return jsonify(deck=deck)


@app.post("/api/decks/<deck_id>/relearn")
def relearn_deck(deck_id):
    return jsonify(deck=store.relearn_deck(deck_id))


@app.patch("/api/decks/<deck_id>/cards")
def edit_deck_cards(deck_id):
    """Rewrite the front/back text of a deck's cards (and optionally its name)."""
    data = _body()
    cards = data.get("cards")
    if not isinstance(cards, list):
        raise ApiError("cards must be a list.")
    try:
        deck = store.update_deck_cards(deck_id, cards, data.get("name"))
    except KeyError:
        raise ApiError("Deck not found.", 404)
    except ValueError as exc:
        raise ApiError(str(exc))
    return jsonify(deck=deck)


@app.delete("/api/decks/<deck_id>")
def remove_deck(deck_id):
    store.delete_deck(deck_id)
    return jsonify(ok=True)


# ---------------------------------------------------------------- tests

@app.get("/api/tests/<test_id>")
def get_test(test_id):
    return jsonify(test=store.get_test(test_id))


@app.delete("/api/tests/<test_id>")
def remove_test(test_id):
    store.delete_test(test_id)
    return jsonify(ok=True)


@app.post("/api/tests/<test_id>/attempts")
def submit_attempt(test_id):
    data = _body()
    test = store.get_test(test_id)
    answers = data.get("answers") or {}
    result = (ai_service.grade_mcq(test, answers)
              if test.get("kind") == "mcq"
              else ai_service.grade_test(test, answers))
    attempt = {
        "id": "att_" + uuid.uuid4().hex[:10],
        "submittedAt": store._now(),
        "answers": answers,
        "result": result,
    }
    test.setdefault("attempts", []).append(attempt)
    store.save_test(test)
    return jsonify(attempt=attempt)


def _find_course_name(course_id: str) -> str:
    meta = store.get_course_index(course_id)
    return meta.get("name", "") if meta else ""


def _save_generated(kind: str, course_id: str, chapter_id: str | None,
                    file_ids: list, prompt: str, content: dict,
                    title_hint: str = "") -> dict:
    names = _file_names(course_id, file_ids)
    test = store.create_test({
        "kind": kind,
        "courseId": course_id,
        "chapterId": chapter_id,
        "fileIds": file_ids,
        "fileNames": names,
        "title": content.get("title") or title_hint,
        "target": _find_course_name(course_id),
        "prompt": prompt,
        "content": content,
    })
    return test


@app.post("/api/ai/mcq")
def ai_mcq():
    data = _body()
    _require(data, "courseId")
    course_id = data["courseId"]
    file_ids = data.get("fileIds") or []
    for fid in file_ids:
        _find_file_meta(course_id, fid)
    count = int(data.get("count") or 10)
    count = max(1, min(999, count))
    names = _file_names(course_id, file_ids)
    payload = ai_service.generate_mcq(file_ids, names, count,
                                      data.get("prompt", ""),
                                      data.get("target", ""))
    content = ai_service.normalize_mcq(payload)
    test = _save_generated("mcq", course_id, data.get("chapterId"),
                           file_ids, data.get("prompt", ""), content,
                           "Multiple choice quiz")
    return jsonify(test={"id": test["id"], "title": test["title"]})


@app.post("/api/ai/paper/convert")
def ai_convert_paper():
    data = _body()
    _require(data, "courseId", "chapterId", "fileIds")
    course_id, chapter_id = data["courseId"], data["chapterId"]
    file_ids = data["fileIds"]
    if not file_ids:
        raise ApiError("Select at least one past-paper file.")
    names = _file_names(course_id, file_ids)
    content = ai_service.normalize_content(
        ai_service.convert_paper(file_ids, names, data.get("prompt", "")))
    test = _save_generated("converted", course_id, chapter_id, file_ids,
                           data.get("prompt", ""), content,
                           "Converted paper")
    return jsonify(test={"id": test["id"], "title": test["title"]})


@app.post("/api/ai/mock")
def ai_mock():
    data = _body()
    _require(data, "courseId")
    course_id = data["courseId"]
    chapter_id = data.get("chapterId")
    if data.get("scope") == "course":
        file_ids = [f["id"] for f in _all_chapter_files(course_id)]
        if not file_ids:
            raise ApiError("Upload at least one past-paper file to this course first.")
    else:
        file_ids = data.get("fileIds") or []
        if not file_ids:
            raise ApiError("Select at least one past-paper file.")
    for fid in file_ids:
        _find_file_meta(course_id, fid)
    names = _file_names(course_id, file_ids)
    content = ai_service.normalize_content(
        ai_service.generate_mock(file_ids, names, data.get("prompt", ""),
                                 data.get("target", "")))
    test = _save_generated("mock", course_id, chapter_id, file_ids,
                           data.get("prompt", ""), content,
                           "AI mock paper")
    return jsonify(test={"id": test["id"], "title": test["title"]})


# ---------------------------------------------------------------- chat

@app.get("/api/topik/papers")
def topik_papers():
    try:
        papers = topik_import.fetch_listing()
    except topik_import.TopikError as exc:
        raise ApiError(str(exc), 502)
    return jsonify(papers=papers)


@app.post("/api/topik/import")
def topik_import_paper():
    data = _body()
    _require(data, "courseId", "chapterId", "no", "grade")
    store.get_course(data["courseId"])
    no = str(data["no"])
    grade = str(data["grade"])
    year = str(data.get("year") or "")
    try:
        paper = topik_import.paper_to_text(no, grade, "r", year=year)
    except topik_import.TopikError as exc:
        raise ApiError(str(exc), 502)
    level = "I" if grade == "1" else "II"
    filename = (f"TOPIK {level} reading {year} session {no} "
                f"(official).txt".replace("  ", " "))
    text = paper["text"].strip()
    if not text:
        raise ApiError("The official site returned an empty paper.")
    parsed = parsing.parse_file(filename, text.encode("utf-8"))
    file_id = store.new_file_id()
    store.save_file_content(file_id, parsed)
    meta = _summary_meta(file_id, filename, "txt", parsed,
                         len(text.encode("utf-8")))
    meta["note"] = paper.get("note", "Imported from topik.go.kr")
    store.add_file_meta(data["courseId"], data["chapterId"], meta)
    return jsonify(file=meta, title=paper.get("title", ""))


@app.get("/api/chats/<chapter_id>")
def get_chat(chapter_id):
    return jsonify(messages=store.get_chat(chapter_id))


@app.delete("/api/chats/<chapter_id>")
def reset_chat(chapter_id):
    store.clear_chat(chapter_id)
    return jsonify(ok=True)


@app.post("/api/chats/message")
def chat_message():
    data = _body()
    _require(data, "courseId", "chapterId", "text")
    course_id, chapter_id = data["courseId"], data["chapterId"]
    file_ids = data.get("fileIds") or []
    for fid in file_ids:
        _find_file_meta(course_id, fid)
    names = _file_names(course_id, file_ids)
    history = store.get_chat(chapter_id)
    question = data["text"].strip()
    try:
        reply = ai_service.chat_reply(file_ids, names, history, question)
    except ai_service.ApiError as exc:
        raise ApiError(str(exc), 502)
    store.append_chat(chapter_id, [
        {"role": "user", "content": question,
         "fileIds": file_ids, "ts": store._now()},
        {"role": "assistant", "content": reply, "ts": store._now()},
    ])
    return jsonify(messages=store.get_chat(chapter_id))


# ---------------------------------------------------------------- settings

@app.get("/api/settings")
def get_settings():
    settings = store.get_settings()
    key = settings.get("api_key", "")
    masked = f"••••{key[-4:]}" if key else ""
    return jsonify(settings={
        "apiKeySet": bool(key),
        "apiKeyMasked": masked,
        "base_url": settings.get("base_url"),
        "model": settings.get("model"),
        "temperature": settings.get("temperature"),
    })


@app.post("/api/settings")
def save_settings():
    data = _body()
    patch = {}
    if "api_key" in data:
        patch["api_key"] = (data.get("api_key") or "").strip()
    if "base_url" in data and data.get("base_url"):
        patch["base_url"] = data["base_url"].strip().rstrip("/")
    if "model" in data and data.get("model"):
        patch["model"] = data["model"].strip()
    if "temperature" in data:
        try:
            patch["temperature"] = max(0.0, min(1.5,
                                                float(data["temperature"])))
        except (TypeError, ValueError):
            pass
    store.save_settings(patch)
    return get_settings()


@app.post("/api/settings/test")
def test_settings():
    try:
        reply = ai_service.ping_model()
    except ai_service.ApiError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(ok=True, reply=reply)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    print(f"HangulHub running at http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
