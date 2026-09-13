"""Fetch free official TOPIK past papers from topik.go.kr.

The official archive (TWSTDY0080) offers reading sections as text with answer
keys. This module turns a chosen session/grade into a plain-text past paper
that HangulHub can then convert into an online test.
"""

import html
import json
import re

import requests

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BASE = "https://www.topik.go.kr"
ARCHIVE = f"{BASE}/TWSTDY/TWSTDY0080.do"
PLAYER = f"{BASE}/TWSTDY/TWSTDY0090.do"


class TopikError(Exception):
    pass


def _warm_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    # First hit lands on the homepage and stores its cookies; the site then
    # expects a timezone cookie (set by JavaScript in a normal browser).
    session.get(BASE, timeout=30)
    session.cookies.set("timezone", "Asia/Seoul",
                        domain="www.topik.go.kr", path="/")
    return session


def _balanced(text: str, start: int) -> int:
    """Index of the bracket/brace/paren matching the one at text[start]."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    close = pairs[text[start]]
    depth = 0
    quote = None
    i = start
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == text[start]:
            depth += 1
        elif ch == close:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise TopikError("Unexpected script content from the official site.")


def fetch_listing() -> list:
    session = _warm_session()
    resp = session.get(ARCHIVE, timeout=30)
    if resp.status_code != 200:
        raise TopikError("Could not load the official TOPIK archive page.")
    match = re.search(r"prev_exam\s*=\s*(\[)", resp.text)
    if not match:
        raise TopikError("Could not find the paper list on the official page.")
    end = _balanced(resp.text, match.start(1))
    try:
        raw = json.loads(resp.text[match.start(1):end + 1])
    except json.JSONDecodeError as exc:
        raise TopikError(f"Could not read the paper list ({exc}).")

    def flatten(value):
        if isinstance(value, (list, tuple)):
            out = []
            for item in value:
                out.extend(flatten(item))
            return out
        return [str(value)]

    papers = []
    for row in raw:
        if isinstance(row, list) and len(row) >= 2:
            papers.append({"year": str(row[0]),
                           "sessions": flatten(row[1])})
    return papers


def _paper_asset(session, no: str, grade: str, qtype: str) -> str:
    resp = session.post(PLAYER, data={"sNo": no, "sGrade": grade,
                                      "sType": qtype}, timeout=30)
    if resp.status_code != 200:
        raise TopikError("Could not open the paper on the official site.")
    match = re.search(r'src="(/asset/exam/exam\d+/exam_\d+_\d+_[rh]\.js)"',
                      resp.text)
    if not match:
        raise TopikError("The official site did not provide this paper.")
    asset = session.get(BASE + match.group(1), timeout=30)
    if asset.status_code != 200:
        raise TopikError("Could not download the paper questions.")
    return asset.text


def _js_calls(source: str, name: str):
    calls = []
    start = 0
    while True:
        idx = source.find(name + "(", start)
        if idx == -1:
            break
        open_idx = idx + len(name)
        close_idx = _balanced(source, open_idx)
        calls.append((idx, _split_js_args(source[open_idx + 1:close_idx])))
        start = close_idx + 1
    return calls


def _split_js_args(body: str) -> list:
    parts = []
    buf = []
    depth = 0
    quote = None
    i = 0
    while i < len(body):
        ch = body[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and i + 1 < len(body):
                buf.append(body[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch in "([{":
            depth += 1
            buf.append(ch)
        elif ch in ")]}":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf).strip())
    return parts


def _clean_js_arg(arg: str) -> str:
    arg = arg.strip()
    if len(arg) >= 2 and arg[0] in "\"'" and arg[-1] == arg[0]:
        arg = arg[1:-1]
    arg = arg.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")
    arg = arg.replace("&nbsp;", " ").replace("&nbsp", " ")
    arg = re.sub(r"<br\s*/?>", "\n", arg, flags=re.I)
    arg = re.sub(r"<\s*/?\s*보기\s*>", "보기", arg)
    arg = re.sub(r"</?(?:b|u|div|p|span|em|strong)[^>]*>", "", arg,
                 flags=re.I)
    arg = re.sub(r"<[^>]+>", "", arg)
    arg = html.unescape(arg)
    arg = re.sub(r"[ \t\u00a0]+", " ", arg)
    arg = arg.replace("（", "(").replace("）", ")")
    lines = [line.strip() for line in arg.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _answer_index(answers: list, qno: int, start_no: int):
    pos = qno - 1
    if 0 <= pos < len(answers):
        value = answers[pos].strip()
        if value.isdigit():
            return int(value) - 1
    return None


def paper_to_text(no: str, grade: str, qtype: str, year: str = "") -> dict:
    """Return {title, text, note} for an official reading paper."""
    if qtype == "h":
        raise TopikError(
            "Listening sections need audio, so HangulHub imports the reading "
            "sections only. You can still do listening practice on the "
            "official site.")
    session = _warm_session()
    source = _paper_asset(session, no, grade, qtype)

    title_match = re.search(r'Display_Exam_Title\s*=\s*"([^"]+)"', source)
    title = html.unescape(title_match.group(1)) if title_match else \
        f"TOPIK {'I' if grade == '1' else 'II'} reading · session {no}"
    answers = []
    marks = []
    for key, target in (("ca", answers), ("gr", marks)):
        match = re.search(rf'\b{key}\s*=\s*"([^"]*)"', source)
        if match:
            target.extend(part.strip() for part in match.group(1).split(","))
    start_no = 1
    start_match = re.search(r"start_test_num\s*=\s*(\d+)", source)
    if start_match:
        start_no = int(start_match.group(1))
    total = 0
    total_match = re.search(r"total_test_num\s*=\s*(\d+)", source)
    if total_match:
        total = int(total_match.group(1))

    lines = []
    lines.append(f"# {title} · official TOPIK past paper"
                 + (f" ({year})" if year else ""))
    lines.append(f"Question range: {start_no}–{start_no + total - 1}")
    lines.append("")

    calls = sorted(
        [("example", *item) for item in _js_calls(source, "Display_Example")]
        + [("exam", *item) for item in _js_calls(source, "Display_Exam")],
        key=lambda item: item[1],
    )
    pending_note = None
    for kind, _pos, args in calls:
        if kind == "example":
            instr = _clean_js_arg(args[1] if len(args) > 1 else "")
            sample = _clean_js_arg(args[2] if len(args) > 2 else "")
            if instr:
                pending_note = instr
                if sample and len(sample) < 400:
                    pending_note += "\nExample:\n" + sample
            continue
        qno_text = args[0] if args else ""
        if not re.fullmatch(r"\d+", qno_text):
            continue
        qno = int(qno_text)
        qtext = _clean_js_arg(args[2] if len(args) > 2 else "")
        options = [_clean_js_arg(args[i]) for i in range(4, min(8, len(args)))]
        options = [opt for opt in options if opt]

        if pending_note:
            lines.append(pending_note)
            lines.append("")
            pending_note = None
        if qtext.lower() == "img" or "img" in qtext.lower()[:8]:
            qtext = "[Question uses an image on the official site — " \
                    "image not included in text import]"

        if options:
            lines.append(f"{qno}. {qtext}")
            for idx, opt in enumerate(options):
                lines.append(f"{chr(0x2460 + idx)} {opt}")
        else:
            lines.append(f"{qno}. {qtext}")

        ans = _answer_index(answers, qno, start_no)
        mark = _answer_index(marks, qno, start_no)
        if ans is not None:
            lines.append(f"[Official answer: {chr(0x2460 + ans)}"
                         + (f" · {mark + 1} pts]" if mark is not None else "]"))
        lines.append("")

    if pending_note:
        lines.append(pending_note)
        lines.append("")

    text = "\n".join(lines).strip()
    if len(text) < 200:
        raise TopikError("The paper came back empty from the official site.")
    note = f"Imported from topik.go.kr · session {no}"
    return {"title": title, "text": text, "note": note}
