"""DeepSeek-backed generation and grading.

All prompts are crafted for Korean exam preparation. Outputs are requested
as strict JSON and repaired when the model wraps them in prose.
"""

import json
import re
import time

import requests

from store import get_settings, file_text


class ApiError(Exception):
    pass


SYSTEM_EXAMINER = (
    "You are an expert Korean-language examiner and tutor with deep knowledge of "
    "the TOPIK format and school-style Korean exams. You create accurate, natural, "
    "level-appropriate material and grade like a careful teacher. "
    "Write instructions/explanations in English and question content in Korean "
    "when the source material is Korean. Only output valid JSON matching the exact "
    "schema you are given, with no commentary, no code fences, and no trailing text."
)


def _api_error_text(status_code: int, body: str) -> str:
    try:
        payload = json.loads(body)
        msg = payload.get("error", {}).get("message", body[:300])
        return str(msg)
    except Exception:
        return body[:300]


def _chat(messages: list, json_mode: bool = True, temperature=None,
          max_tokens: int | None = None, timeout: int = 600) -> str:
    settings = get_settings()
    key = settings.get("api_key", "")
    if not key:
        raise ApiError(
            "No DeepSeek API key yet. Open Settings (gear icon) and paste your key."
        )
    base = (settings.get("base_url") or "https://api.deepseek.com/v1").rstrip("/")
    url = f"{base}/chat/completions"
    payload = {
        "model": settings.get("model") or "deepseek-v4-flash",
        "messages": messages,
        "temperature": temperature if temperature is not None
        else settings.get("temperature", 0.3),
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if max_tokens:
        payload["max_tokens"] = max_tokens
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
    except requests.exceptions.Timeout:
        raise ApiError("The AI request timed out. Please try again or shorten the material.")
    except requests.exceptions.ConnectionError:
        raise ApiError("Could not reach the AI provider. Check your network and base URL.")
    if resp.status_code != 200:
        detail = _api_error_text(resp.status_code, resp.text)
        raise ApiError(f"AI provider error ({resp.status_code}): {detail}")
    try:
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError):
        raise ApiError("The AI provider returned an unexpected response.")


def _extract_json(raw: str):
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ApiError("The AI response did not contain JSON.")
    try:
        return json.loads(raw[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ApiError(f"The AI response was not valid JSON ({exc}). Try again.")


def _json_call(messages: list, temperature=None, max_tokens=None,
               timeout: int = 600):
    raw = _chat(messages, json_mode=True, temperature=temperature,
                max_tokens=max_tokens, timeout=timeout)
    try:
        return _extract_json(raw)
    except ApiError:
        messages = messages + [
            {"role": "assistant", "content": raw},
            {"role": "user",
             "content": "Your previous reply was not valid JSON. "
                        "Reply again with ONLY valid JSON matching the schema."},
        ]
        return _extract_json(_chat(messages, json_mode=True,
                                   temperature=temperature,
                                   max_tokens=max_tokens, timeout=timeout))


# ---------------------------------------------------------------- context

def context_for_files(file_ids: list, file_names: dict | None = None,
                      total_chars: int = 100000) -> str:
    """Compose source excerpts. One file per section, fairly capped."""
    file_names = file_names or {}
    if not file_ids:
        return ""
    per_file = max(4000, total_chars // len(file_ids))
    blocks = []
    for fid in file_ids:
        name = file_names.get(fid, fid)
        text = file_text(fid, max_chars=per_file)
        if text:
            blocks.append(f"===== SOURCE: {name} =====\n{text}")
    return "\n\n".join(blocks)


def _schema_hint(schema: dict) -> str:
    return json.dumps(schema, ensure_ascii=False)


def _mcq_schema() -> dict:
    return {
        "questions": [
            {
                "prompt": "Full Korean question with ____ for the blank (string)",
                "options": ["A", "B", "C", "D"],
                "answer_index": 0,
                "explanation": "Brief English explanation of why this is correct",
            }
        ]
    }


def _paper_schema() -> dict:
    return {
        "title": "Test title",
        "instructions": "General instructions (English)",
        "sections": [
            {
                "title": "Section title in the style of the source paper",
                "instructions": "Section-specific instructions",
                "marks": 10,
                "questions": [
                    {
                        "type": "mc | fill | short | writing",
                        "prompt": "Full Korean prompt. Use ____ for blanks.",
                        "options": ["only for type mc", "four", "Korean", "options"],
                        "answer": "reference answer (never shown to the student)",
                        "explanation": "brief marking note",
                        "marks": 2,
                    }
                ],
            }
        ],
    }


def generate_mcq(file_ids: list, file_names: dict, count: int,
                 user_prompt: str, target: str) -> dict:
    """Generate an MC quiz, batching to keep each request small."""
    all_questions = []
    batch_size = 15
    context = context_for_files(file_ids, file_names)
    guidance = user_prompt.strip() or (
        "A balanced grammar-focused multiple choice quiz. Use the sources when "
        "they are provided; otherwise produce questions at the course's target level."
    )
    target_line = f"Target exam/course: {target}" if target else \
        "Target level: intermediate Korean unless the sources suggest otherwise."

    for start in range(0, count, batch_size):
        n = min(batch_size, count - start)
        numbering = f"Question numbering continues from {start + 1} to {start + n}."
        schema = _mcq_schema()
        schema["questions"][0]["number"] = "1..N"
        user = (
            f"{context}\n\n" if context else ""
        ) + f"""
{target_line}
Create exactly {n} multiple choice questions ({numbering}) for Korean exam practice.
User's requested focus: {guidance}
Rules:
- Keep questions in Korean, explanations in English.
- Exactly 4 options per question; exactly one correct.
- A grammar sentence should use "____" for the blank.
- Do not reuse the same question.
Return ONLY JSON with this schema:
{_schema_hint(_mcq_schema())}
"""
        messages = [
            {"role": "system", "content": SYSTEM_EXAMINER},
            {"role": "user", "content": user},
        ]
        data = _json_call(messages, temperature=0.4, timeout=900)
        questions = data.get("questions") or []
        if len(questions) > n:
            questions = questions[:n]
        if not questions:
            raise ApiError("The AI returned no questions. Please try again.")
        all_questions.extend(questions)

    return {"questions": all_questions}


def convert_paper(file_ids: list, file_names: dict, user_prompt: str) -> dict:
    context = context_for_files(file_ids, file_names)
    guidance = user_prompt.strip() or "Follow the source paper structure exactly."
    user = f"""
{context}
Convert the source exam paper(s) above into an online test that keeps the real
paper's structure: same section titles, same section order, and the same number
of questions per section as far as the text allows.
User notes: {guidance}

Rules:
- If a listening/audio section has no transcript in the source, keep the section
  title but mark instructions "(adapted from original format)" and replace the
  audio questions with text-based questions about the same skills.
- Never invent a brand-new section that is not in the source.
- Use the source answer key to set "answer" fields; otherwise mark the best answer.
- Type choices: "mc" for multiple choice (must include exactly 4 options),
  "fill" for blank-filling, "short" for short answers, "writing" for composed
  answers (its "answer" field is a marking guide, not one fixed string).
Return ONLY JSON with this schema:
{_schema_hint(_paper_schema())}
"""
    messages = [
        {"role": "system", "content": SYSTEM_EXAMINER},
        {"role": "user", "content": user},
    ]
    return _json_call(messages, temperature=0.2, timeout=900)


def generate_mock(file_ids: list, file_names: dict, user_prompt: str,
                  target: str) -> dict:
    context = context_for_files(file_ids, file_names)
    guidance = user_prompt.strip() or (
        "Create a fresh mock paper that mirrors the structure of the past papers."
    )
    target_line = f"Target exam: {target}." if target else ""
    user = f"""
{context}
The files above are past papers for {target_line or "a Korean exam"}.
Create a BRAND-NEW mock paper that matches their structure exactly: same section
titles, same order, same marks distribution, and the same number of questions per
section. The content must be new (different sentences, vocabulary and topics) but
at the same difficulty level.
User notes: {guidance}

Rules:
- Follow the rules for audio sections and answer keys from the conversion spec:
  keep section titles, adapt unanswerable audio questions into text questions,
  never invent extra sections.
- Multiple choice must have exactly 4 options; other types as in the source.
- Provide "answer" and "explanation" for every question (used for grading only).
Return ONLY JSON with this schema:
{_schema_hint(_paper_schema())}
"""
    messages = [
        {"role": "system", "content": SYSTEM_EXAMINER},
        {"role": "user", "content": user},
    ]
    return _json_call(messages, temperature=0.5, timeout=1200)


# ---------------------------------------------------------------- grading

def grade_test(test: dict, answers: dict) -> dict:
    """Ask the AI to grade one completed paper/mock test."""
    questions = []
    for section in test.get("content", {}).get("sections", []):
        for q in section.get("questions", []):
            questions.append(q)
    if not questions:
        raise ApiError("The test has no questions to grade.")

    listing = []
    for i, q in enumerate(questions, start=1):
        options = ""
        if q.get("type") == "mc":
            options = "\n" + "\n".join(
                f"  {chr(65 + idx)}. {opt}" for idx, opt in enumerate(q.get("options", []))
            )
        answer = answers.get(q["id"])
        if isinstance(answer, str) and answer.isdigit() and q.get("type") == "mc":
            answer = chr(65 + int(answer))
        listing.append(
            f"{i}. [{q.get('type')}] {q.get('prompt')}{options}\n"
            f"   Student answer: {answer or '(blank)'}\n"
            f"   Marks available: {q.get('marks', '?')}\n"
            f"   Reference: {q.get('answer', 'not provided')}\n"
        )

    schema = {
        "score": 0,
        "maxScore": 0,
        "sections": [
            {
                "index": 0,
                "title": "Section title",
                "score": 0,
                "max": 0,
                "feedback": "Short feedback for this section",
            }
        ],
        "questions": [
            {
                "id": "question id",
                "score": 0,
                "max": 0,
                "feedback": "Specific, encouraging correction or praise",
            }
        ],
        "overallFeedback": "Paragraph of overall feedback",
        "estimatedBand": "e.g. TOPIK 2 or school-grade estimate",
    }
    user = f"""
Grade this completed {test.get('kind')} test like a careful examiner.
Be fair but strict. Partial marks are allowed for short/writing answers.
Assign the same per-question marks used by the paper (fall back to sensible
defaults when a question has no marks field). Give every question its own
feedback that quotes what the student wrote when useful.

Test title: {test.get('title')}

Student answers:
{chr(10).join(listing)}

Return ONLY JSON with this schema:
{_schema_hint(schema)}
"""
    messages = [
        {"role": "system", "content": SYSTEM_EXAMINER},
        {"role": "user", "content": user},
    ]
    result = _json_call(messages, temperature=0.2, timeout=900)

    by_id = {q["id"]: q for q in questions}
    scored = {}
    for item in result.get("questions") or []:
        qid = item.get("id")
        if qid in by_id:
            q = by_id[qid]
            item["type"] = q.get("type")
            item["prompt"] = q.get("prompt")
            raw_answer = answers.get(qid)
            item["yourAnswer"] = raw_answer or "(blank)"
            if q.get("type") == "mc" and isinstance(raw_answer, str) \
                    and raw_answer.isdigit():
                item["yourAnswer"] = chr(65 + int(raw_answer))
            if q.get("type") == "mc":
                item["correctAnswer"] = chr(65 + int(q.get("answer", 0)))
            scored[qid] = item
    for q in questions:
        if q["id"] not in scored:
            scored[q["id"]] = {
                "id": q["id"],
                "score": 0,
                "max": q.get("marks", 0) or 0,
                "feedback": "No feedback returned for this question.",
            }
    total = sum(float(i.get("max", 0) or 0) for i in scored.values())
    earned = sum(float(i.get("score", 0) or 0) for i in scored.values())
    result.setdefault("questions", []).extend(scored.values())
    result["score"] = result.get("score") if result.get("score") is not None else earned
    result["maxScore"] = result.get("maxScore") if result.get("maxScore") else total
    result["sections"] = result.get("sections") or []
    return result


def grade_mcq(test: dict, answers: dict) -> dict:
    """Local deterministic grading for multiple-choice quizzes."""
    questions = []
    for section in test.get("content", {}).get("sections", []):
        for q in section.get("questions", []):
            questions.append(q)
    results = []
    correct = 0
    for q in questions:
        given = answers.get(q["id"])
        if q.get("type") == "mc":
            try:
                given_idx = int(given) if given not in (None, "") else -1
            except (TypeError, ValueError):
                given_idx = -1
            right = q.get("answer") == given_idx
        else:
            right = q.get("answer") == given
        if right:
            correct += 1
        results.append({
            "id": q["id"],
            "score": 1 if right else 0,
            "max": 1,
            "feedback": q.get("explanation", ""),
            "correctAnswer": (chr(65 + int(q.get("answer", 0)))
                              if q.get("type") == "mc" else q.get("answer")),
            "yourAnswer": (chr(65 + given_idx)
                           if q.get("type") == "mc" and given_idx >= 0 else given),
        })
    return {
        "score": correct,
        "maxScore": len(questions),
        "questions": results,
        "sections": [],
        "overallFeedback": (
            f"You answered {correct} of {len(questions)} questions correctly."
            if questions else "No questions."
        ),
        "estimatedBand": "",
    }


# ---------------------------------------------------------------- chat

def chat_reply(file_ids: list, file_names: dict, history: list,
               question: str) -> str:
    context = context_for_files(file_ids, file_names, total_chars=60000)
    source_note = (
        "Answer using the sources below. When you use a source, cite it on its "
        "own line like: From <filename>: …"
        if context else
        "Answer as a Korean tutor. No sources were selected, so answer from "
        "your own knowledge and say when you are unsure."
    )
    system = (
        "You are a friendly Korean-language tutor who helps a learner understand "
        "their study materials and prepare for exams. Explain clearly and "
        "concretely, with examples. Keep answers focused."
    )
    messages = [{"role": "system", "content": system}]
    if context:
        messages.append({"role": "user", "content": f"STUDY SOURCES:\n{context}"})
    messages.append({"role": "user", "content": source_note})
    for msg in history[-8:]:
        messages.append({"role": msg.get("role"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": question})
    return _chat(messages, json_mode=False, temperature=0.4, timeout=300)


def ping_model() -> str:
    return _chat(
        [
            {"role": "system", "content": "Reply with exactly one word: OK."},
            {"role": "user", "content": "Ping"},
        ],
        json_mode=False,
        temperature=0,
        max_tokens=8,
        timeout=60,
    ).strip()


def normalize_content(content: dict) -> dict:
    """Normalize AI-generated paper content into a stable internal schema."""
    sections = content.get("sections") or []
    if not sections and content.get("questions"):
        sections = [{"title": content.get("title", "Questions"),
                     "instructions": "", "marks": 0,
                     "questions": content["questions"]}]
    normalized = []
    stamp = str(time.time_ns())[-7:]
    for section_index, section in enumerate(sections, start=1):
        qs = []
        for q_index, q in enumerate(section.get("questions") or [], start=1):
            qtype = str(q.get("type", "mc")).lower()
            if qtype not in ("mc", "fill", "short", "writing"):
                qtype = "mc" if q.get("options") else "short"
            options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
            item = {
                "id": f"q{section_index}_{q_index}_{stamp}",
                "type": qtype,
                "prompt": str(q.get("prompt", "")).strip(),
                "answer": str(q.get("answer", "")).strip(),
                "explanation": str(q.get("explanation", "")).strip(),
                "marks": int(float(q.get("marks", 1) or 1)),
            }
            if qtype == "mc":
                if len(options) < 2:
                    options = [f"Option {i + 1}" for i in range(4)]
                item["options"] = options[:4]
                while len(item["options"]) < 4:
                    item["options"].append(f"Option {len(item['options']) + 1}")
                ans = q.get("answer")
                if isinstance(ans, int):
                    item["answer"] = ans
                elif str(ans).strip().upper() in ("A", "B", "C", "D"):
                    item["answer"] = ord(str(ans).strip().upper()) - 65
                elif str(ans).isdigit():
                    item["answer"] = int(str(ans)) if 0 <= int(str(ans)) < 4 else 0
                else:
                    item["answer"] = 0
            qs.append(item)
        if qs:
            normalized.append({
                "title": str(section.get("title", "")).strip() or "Section",
                "instructions": str(section.get("instructions", "")).strip(),
                "marks": int(float(section.get("marks", 0) or 0)),
                "questions": qs,
            })
    return {
        "title": str(content.get("title", "")).strip() or "Untitled test",
        "instructions": str(content.get("instructions", "")).strip(),
        "sections": normalized,
    }


def normalize_mcq(payload: dict) -> dict:
    questions = []
    for q in payload.get("questions") or []:
        options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        while len(options) < 4:
            options.append(f"Option {len(options) + 1}")
        answer_index = q.get("answer_index")
        if not isinstance(answer_index, int):
            if isinstance(answer_index, str) and answer_index.isdigit():
                answer_index = int(answer_index)
            elif str(answer_index or "").strip().upper() in ("A", "B", "C", "D"):
                answer_index = ord(str(answer_index).strip().upper()) - 65
            else:
                answer_index = 0
        answer_index = max(0, min(3, answer_index))
        questions.append({
            "id": "q_" + str(time.time_ns())[-12:] + str(len(questions)),
            "type": "mc",
            "prompt": str(q.get("prompt", "")).strip(),
            "options": options[:4],
            "answer": answer_index,
            "explanation": str(q.get("explanation", "")).strip(),
            "marks": 1,
        })
    return {
        "title": "Multiple choice quiz",
        "instructions": "Choose the best answer for each question.",
        "sections": [{
            "title": "Multiple choice",
            "instructions": "",
            "marks": len(questions),
            "questions": questions,
        }],
    }
