"""Generate small sample study files so you can try HangulHub immediately."""

from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parent.parent / "samples"
ROOT.mkdir(parents=True, exist_ok=True)


def vocab():
    wb = Workbook()
    ws = wb.active
    ws.title = "Week 1"
    ws.append(["Korean", "English", "Example"])
    words = [
        ("학교", "school", "학교에 갑니다."),
        ("책", "book", "책을 읽어요."),
        ("친구", "friend", "친구를 만나요."),
        ("물", "water", "물을 마셔요."),
        ("먹다", "to eat", "밥을 먹어요."),
        ("마시다", "to drink", "커피를 마셔요."),
        ("좋아하다", "to like", "음악을 좋아해요."),
        ("배우다", "to learn", "한국어를 배워요."),
        ("가다", "to go", "집에 가요."),
        ("오다", "to come", "친구가 와요."),
        ("보다", "to see/watch", "영화를 봐요."),
        ("듣다", "to listen", "노래를 들어요."),
    ]
    for row in words:
        ws.append(row)
    wb.save(ROOT / "week1_vocab.xlsx")


def paper():
    lines = [
        "SAMPLE READING TEST (adapted for practice)",
        "",
        "Section 1 — Vocabulary and grammar (Q1–5)",
        "Q1. Choose the correct word for the blank.",
        "    오늘은 날씨가 좋아서 공원에 (    ).",
        "    a) 갑니다  b) 갔어요  c) 갈 거예요  d) 가고 있어요",
        "Q2. 나는 매일 아침 7시에 (    ).",
        "    a) 일어나요  b) 일어났어요  c) 일어날 거예요  d) 일어나고 있어요",
        "Q3. Which sentence is correct?",
        "    a) 나는 책을 읽어요.  b) 나는 책을 읽어.  c) 나는 책 읽어요.  d) 나는 책을 읽습니다?",
        "Q4. 한국 음식 중에서 무엇을 좋아해요?",
        "    a) 저는 김치를 좋아해요.  b) 김치 좋아해요.  c) 저는 김치 좋아해요.  d) 좋아해요 김치.",
        "Q5. Fill in: 지하철을 타고 학교에 (    ).  (가다)",
        "",
        "Section 2 — Reading comprehension (Q6–7)",
        "다음 글을 읽고 물음에 답하세요.",
        "민수는 주말에 친구와 함께 영화를 봤어요. 영화가 재미있었어요.",
        "그리고 맛있는 음식을 먹었어요. 민수는 다음 주말에 또 갈 거예요.",
        "Q6. 민수는 언제 영화를 봤어요?",
        "    a) 평일에  b) 주말에  c) 다음 달에  d) 어제",
        "Q7. 민수는 영화를 어떻게 생각했어요? (short answer)",
        "",
        "Section 3 — Writing (Q8)",
        "Q8. 다음 주말 계획을 두 문장으로 쓰세요.",
        "",
        "Answer key",
        "Q1 c  Q2 a  Q3 a  Q4 a  Q5 갔습니다/갔어요  Q6 b  Q7 재미있었어요/재미있다고 생각했어요",
    ]
    (ROOT / "sample_reading_paper.txt").write_text("\n".join(lines),
                                                    encoding="utf-8")


def vocab_txt():
    lines = [
        "가족\tfamily",
        "음식\tfood",
        "날씨\tweather",
        "시간\ttime",
        "돈\tmoney",
        "일하다\tto work",
        "쉬다\tto rest",
    ]
    (ROOT / "week1_vocab_pairs.txt").write_text("\n".join(lines),
                                                 encoding="utf-8")


if __name__ == "__main__":
    vocab()
    paper()
    vocab_txt()
    print("Samples written to", ROOT)
