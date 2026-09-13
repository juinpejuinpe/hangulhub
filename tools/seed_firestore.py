#!/usr/bin/env python3
"""Copy this app's local data/ folder into a user's Firestore tree.

The Flask app keeps everything as JSON on disk; the React app keeps the same
structure in Firestore under users/{uid}/...  This script translates between the
two so existing courses, chapters, files and flashcard decks show up in the web
app without re-importing anything by hand.

Usage:
    .venv/bin/python tools/seed_firestore.py --uid <firebase-uid>
    .venv/bin/python tools/seed_firestore.py --uid <uid> --dry-run
    .venv/bin/python tools/seed_firestore.py --uid <uid> --check

The access token is taken from --token, else $FIREBASE_ACCESS_TOKEN, else the
Firebase CLI's local login (~/.config/configstore/firebase-tools.json). Writes
go through the Firestore REST API as the signed-in owner, so they bypass the
security rules — which is what lets this seed a fresh account.
"""

import argparse
import json
import os
import pathlib
import re
import sys

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMESTAMP_KEYS = {"createdAt", "updatedAt", "uploadedAt", "addedAt"}
NAIVE_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
# Local timestamps were written in the machine's timezone; keep them meaning the
# same instant once they become Firestore timestamps.
LOCAL_OFFSET = "+08:00"


def to_value(value, key=None):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        if key in TIMESTAMP_KEYS and NAIVE_TS.match(value):
            return {"timestampValue": f"{value}{LOCAL_OFFSET}"}
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [to_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: to_value(v, k) for k, v in value.items()}}}
    raise TypeError(f"cannot store {type(value).__name__}")


def to_document(obj):
    return {"fields": {k: to_value(v, k) for k, v in obj.items()}}


def from_value(value):
    """Decode a Firestore REST value back into plain Python."""
    for key, cast in (
        ("stringValue", str),
        ("booleanValue", bool),
        ("integerValue", int),
        ("doubleValue", float),
        ("timestampValue", str),
    ):
        if key in value:
            return cast(value[key])
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [from_value(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {k: from_value(v) for k, v in value["mapValue"].get("fields", {}).items()}
    return value


def from_document(document):
    obj = {k: from_value(v) for k, v in document.get("fields", {}).items()}
    obj["_id"] = document["name"].rsplit("/", 1)[-1]
    return obj


def load_token(explicit=None):
    if explicit:
        return explicit
    if os.environ.get("FIREBASE_ACCESS_TOKEN"):
        return os.environ["FIREBASE_ACCESS_TOKEN"]
    path = pathlib.Path.home() / ".config/configstore/firebase-tools.json"
    if not path.exists():
        sys.exit(
            "No token: pass --token, set FIREBASE_ACCESS_TOKEN, or run "
            "'firebase login' so the CLI has a stored token."
        )
    return json.loads(path.read_text())["tokens"]["access_token"]


def build_documents(data_dir: pathlib.Path, uid: str) -> list:
    """Return [(firestore_path, document_dict), ...] for everything on disk."""
    docs = []
    courses = json.loads((data_dir / "courses.json").read_text())

    for course in courses:
        course_id = course["id"]
        docs.append(
            (
                f"users/{uid}/courses/{course_id}",
                {
                    "name": course.get("name", ""),
                    "target": course.get("target", ""),
                    "createdAt": course.get("createdAt"),
                    "updatedAt": course.get("updatedAt"),
                },
            )
        )

        detail_path = data_dir / f"course_{course_id}.json"
        detail = json.loads(detail_path.read_text()) if detail_path.exists() else {}

        for chapter in detail.get("chapters", []):
            chapter_id = chapter["id"]
            docs.append(
                (
                    f"users/{uid}/courses/{course_id}/chapters/{chapter_id}",
                    {"name": chapter.get("name", ""), "createdAt": chapter.get("createdAt")},
                )
            )

            for meta in chapter.get("files", []):
                content_path = data_dir / "files" / f"{meta['id']}.json"
                if not content_path.exists():
                    print(f"  ! skipping {meta['name']} — no parsed content on disk")
                    continue
                content = json.loads(content_path.read_text())
                docs.append(
                    (
                        f"users/{uid}/files/{meta['id']}",
                        {
                            "courseId": course_id,
                            "chapterId": chapter_id,
                            "name": meta.get("name", ""),
                            "ext": meta.get("ext", ""),
                            "kind": meta.get("kind", ""),
                            "size": meta.get("size", 0),
                            "note": meta.get("note", ""),
                            "content": content,
                            "createdAt": meta.get("uploadedAt") or chapter.get("createdAt"),
                        },
                    )
                )

    for path in sorted((data_dir / "decks").glob("*.json")):
        deck = json.loads(path.read_text())
        cards = deck.get("cards", [])
        docs.append(
            (
                f"users/{uid}/decks/{deck['id']}",
                {
                    "name": deck.get("name", "Vocabulary deck"),
                    "courseId": deck.get("courseId", ""),
                    "chapterId": deck.get("chapterId", ""),
                    "source": "files",
                    "cards": cards,
                    "study": deck.get("study")
                    or {
                        "order": [c["id"] for c in cards],
                        "index": 0,
                        "completed": False,
                    },
                    "stats": deck.get("stats") or {"correct": 0, "wrong": 0, "uncertain": 0},
                    "createdAt": deck.get("createdAt"),
                    "updatedAt": deck.get("updatedAt"),
                },
            )
        )

    return docs


def check(project: str, uid: str, token: str) -> None:
    """Read the seeded documents back and print what is actually stored."""
    base = (
        f"https://firestore.googleapis.com/v1/projects/{project}"
        "/databases/(default)/documents"
    )
    headers = {"Authorization": f"Bearer {token}"}

    def fetch(path):
        response = requests.get(f"{base}/{path}", headers=headers, timeout=60)
        response.raise_for_status()
        return [from_document(doc) for doc in response.json().get("documents", [])]

    courses = fetch(f"users/{uid}/courses")
    for course in courses:
        print(f"course: {course.get('name')} ({course.get('target') or 'no target'})")
        chapters = fetch(f"users/{uid}/courses/{course['_id']}/chapters")
        for chapter in chapters:
            print(f"  chapter: {chapter.get('name')}")

    for file in fetch(f"users/{uid}/files"):
        content = file.get("content", {})
        if content.get("kind") == "table":
            detail = f"{len(content.get('rows', []))} rows, columns {content.get('headers')}"
        else:
            detail = f"{len(content.get('lines', []))} lines, {content.get('pages')} pages"
        print(f"file: {file.get('name')} — {detail}")

    for deck in fetch(f"users/{uid}/decks"):
        cards = deck.get("cards", [])
        learned = sum(1 for card in cards if card.get("learned"))
        print(
            f"deck: {deck.get('name')} — {len(cards)} cards, {learned} learned, "
            f"{len((deck.get('study') or {}).get('order', []))} queued, stats {deck.get('stats')}"
        )

    print(f"\n{len(courses)} course(s) stored under users/{uid}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uid", required=True, help="Firebase Auth UID to seed")
    parser.add_argument("--project", default="hangulhub-7c278")
    parser.add_argument("--data-dir", default=str(ROOT / "data"))
    parser.add_argument("--token", help="OAuth access token (otherwise taken from the CLI login)")
    parser.add_argument("--dry-run", action="store_true", help="list what would be written")
    parser.add_argument("--check", action="store_true", help="read back what is stored and stop")
    args = parser.parse_args()

    if args.check:
        check(args.project, args.uid, load_token(args.token))
        return

    docs = build_documents(pathlib.Path(args.data_dir), args.uid)
    if not docs:
        sys.exit("Nothing to seed — is --data-dir pointing at a populated folder?")

    if args.dry_run:
        for path, doc in docs:
            print(f"would write {path}  ({len(json.dumps(doc)):,} bytes)")
        print(f"{len(docs)} documents, nothing sent.")
        return

    token = load_token(args.token)
    base = (
        f"https://firestore.googleapis.com/v1/projects/{args.project}"
        "/databases/(default)/documents"
    )
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    for path, doc in docs:
        response = requests.patch(
            f"{base}/{path}",
            headers=headers,
            data=json.dumps(to_document(doc)),
            timeout=60,
        )
        if response.status_code != 200:
            sys.exit(f"failed on {path}: {response.status_code} {response.text[:300]}")
        print(f"wrote {path}  ({len(json.dumps(doc)):,} bytes)")

    print(f"\n{len(docs)} documents written to users/{args.uid}")


if __name__ == "__main__":
    main()
