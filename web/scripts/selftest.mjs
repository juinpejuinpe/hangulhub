// Fast checks for the pure logic (no browser, no Firebase needed).
// Run with: npm test   (or: node scripts/selftest.mjs)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fileText,
  flattenQuestions,
  gradeMcq,
  normalizeContent,
  normalizeMcq,
  totalMarks,
} from "../src/ai.js";
import { ALLOWED_EMAILS, isAllowedEmail } from "../src/allowlist.js";
import {
  applyAnswer,
  currentCard,
  deckProgress,
  newCard,
  resetStudy,
  shuffle,
} from "../src/study.js";
import {
  parseDelimited,
  parseTextFile,
  rowsToPairs,
  tableFromRows,
  textToPairs,
} from "../src/lib/parsers.js";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

console.log("study.js");

check("only the configured accounts pass the client allow-list", () => {
  assert.equal(isAllowedEmail("sunsong1011@gmail.com"), true);
  assert.equal(isAllowedEmail("  SUNSONG1011@GMAIL.COM "), true);
  assert.equal(isAllowedEmail("rlkl1421253088@gmail.com"), true);
  assert.equal(isAllowedEmail("someone.else@gmail.com"), false);
  assert.equal(isAllowedEmail(""), false);
  assert.equal(isAllowedEmail(undefined), false);
});

check("firestore.rules allows exactly the same accounts", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("email.lower() in ["));
  const listed = [...block.slice(0, block.indexOf("]")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), [...ALLOWED_EMAILS].sort());
});

check("shuffle keeps every item", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(shuffle(items).sort(), items);
});

check("a fresh deck starts with every card in the pool", () => {
  const cards = [newCard("학교", "school"), newCard("책", "book"), newCard("물", "water")];
  const deck = resetStudy({ cards });
  assert.equal(deck.study.order.length, 3);
  assert.equal(deck.study.index, 0);
  assert.equal(deck.study.completed, false);
  assert.deepEqual(deck.stats, { correct: 0, wrong: 0, uncertain: 0 });
  assert.equal(deck.cards.every((card) => card.learned === false), true);
});

check("answering correctly retires the card", () => {
  const cards = [newCard("학교", "school"), newCard("책", "book")];
  const deck = resetStudy({ cards });
  const card = currentCard(deck);
  const next = applyAnswer(deck, card.id, "correct");
  assert.equal(next.study.order.length, 1);
  assert.equal(next.cards.find((c) => c.id === card.id).learned, true);
  assert.equal(next.study.completed, false);
});

check("a wrong answer sends the card to the back of the pool", () => {
  const cards = [newCard("a", "1"), newCard("b", "2"), newCard("c", "3")];
  const deck = resetStudy({ cards });
  const card = currentCard(deck);
  const next = applyAnswer(deck, card.id, "wrong");
  assert.equal(next.study.order.length, 3);
  assert.equal(next.study.order.at(-1), card.id);
  assert.equal(next.cards.find((c) => c.id === card.id).learned, false);
  assert.equal(next.stats.wrong, 1);
});

check("marking everything correct completes the round", () => {
  let deck = resetStudy({ cards: [newCard("a", "1"), newCard("b", "2")] });
  while (!deck.study.completed) {
    deck = applyAnswer(deck, currentCard(deck).id, "correct");
  }
  const progress = deckProgress(deck);
  assert.equal(progress.percent, 100);
  assert.equal(progress.learned, 2);
});

check("relearn puts cards back into the pool", () => {
  const cards = [newCard("a", "1"), newCard("b", "2")];
  let deck = resetStudy({ cards });
  deck = applyAnswer(deck, currentCard(deck).id, "wrong");
  const fresh = resetStudy({ ...deck, cards });
  assert.equal(fresh.study.order.length, 2);
  assert.equal(fresh.stats.wrong, 0);
});

console.log("parsers.js");

check("plain text pairs split on tab", () => {
  assert.deepEqual(textToPairs({ lines: ["책\tbook"] }), [["책", "book"]]);
});

check("plain text pairs split Korean from English", () => {
  assert.deepEqual(textToPairs({ lines: ["학교 school"] }), [["학교", "school"]]);
});

check("plain text pairs split on a dash", () => {
  assert.deepEqual(textToPairs({ lines: ["물 - water"] }), [["물", "water"]]);
});

check("text files become line-based content", () => {
  const parsed = parseTextFile("notes.txt", "  hello \n\n  world  ");
  assert.equal(parsed.kind, "text");
  assert.deepEqual(parsed.lines, ["hello", "world"]);
});

check("csv rows are detected as a table with headers", () => {
  const parsed = parseTextFile("week1.csv", "Korean,English\n학교,school\n책,book");
  assert.equal(parsed.kind, "table");
  assert.deepEqual(parsed.headers, ["Korean", "English"]);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], { Korean: "학교", English: "school" });
});

check("tables without a header row get numbered columns", () => {
  const parsed = tableFromRows([["학교", "school"], ["책", "book"]]);
  assert.deepEqual(parsed.headers, ["Column 1", "Column 2"]);
  assert.equal(parsed.rows.length, 2);
});

check("quoted csv cells survive commas", () => {
  assert.deepEqual(parseDelimited('"a,b",c', ","), [["a,b", "c"]]);
});

check("rows to pairs joins the back columns", () => {
  const content = parseTextFile("v.csv", "Word,Meaning,Reading\n학교,school,hakgyo");
  assert.deepEqual(rowsToPairs(content, "Word", ["Meaning", "Reading"]), [
    ["학교", "school\nhakgyo"],
  ]);
});

check("unsupported file types fail loudly", () => {
  assert.throws(() => parseTextFile("deck.xlsx", "x"), /can't be read from text/i);
});

console.log("ai.js");

check("generated MCQ answers are normalised to an option index", () => {
  const content = normalizeMcq({
    questions: [
      { prompt: "밥을 ____ 먹어요.", options: ["먹다", "먹어요"], answer_index: "B", explanation: "why" },
      { prompt: "둘", options: ["가", "나", "다", "라"], answer_index: 3 },
    ],
  });
  const questions = flattenQuestions(content);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].options.length, 4, "short option lists are padded to four");
  assert.equal(questions[0].answer, 1, "'B' becomes index 1");
  assert.equal(questions[1].answer, 3);
  assert.notEqual(questions[0].id, questions[1].id);
});

check("paper content keeps section structure, types and marks", () => {
  const content = normalizeContent({
    title: "TOPIK I mock",
    instructions: "Answer all questions.",
    sections: [
      {
        title: "Reading",
        marks: 20,
        questions: [
          { type: "mc", prompt: "Q1", options: ["a", "b", "c", "d"], answer: "C", marks: 2 },
          { type: "writing", prompt: "Q2", answer: "marking guide", marks: 10 },
        ],
      },
      { title: "Empty", questions: [] },
    ],
  });
  assert.equal(content.title, "TOPIK I mock");
  assert.equal(content.sections.length, 1, "sections with no questions are dropped");
  assert.equal(content.sections[0].questions[0].answer, 2, "'C' becomes index 2");
  assert.equal(content.sections[0].questions[1].type, "writing");
  assert.equal(content.sections[0].questions[1].marks, 10);
  assert.equal(totalMarks(content), 12);
});

check("multiple choice grading is local and correct", () => {
  const content = normalizeMcq({
    questions: [
      { prompt: "one", options: ["a", "b", "c", "d"], answer_index: 0 },
      { prompt: "two", options: ["a", "b", "c", "d"], answer_index: 2 },
    ],
  });
  const [first, second] = flattenQuestions(content);
  const result = gradeMcq(content, { [first.id]: "0", [second.id]: "1" });
  assert.equal(result.score, 1);
  assert.equal(result.maxScore, 2);
  assert.equal(result.questions[0].score, 1);
  assert.equal(result.questions[1].score, 0);
  assert.equal(result.questions[1].correctAnswer, "C");
});

check("file text is exposed to the AI as tab-separated rows", () => {
  const text = fileText({
    content: {
      kind: "table",
      headers: ["Korean", "English"],
      rows: [{ Korean: "학교", English: "school" }],
    },
  });
  assert.equal(text, "Korean\tEnglish\n학교\tschool");
});

console.log(`\n${checks} checks passed.`);
