// Fast checks for the pure logic (no browser, no Firebase needed).
// Run with: npm test   (or: node scripts/selftest.mjs)

import assert from "node:assert/strict";
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
  assert.throws(() => parseTextFile("deck.xlsx", "x"), /(not|aren't) supported/i);
});

console.log(`\n${checks} checks passed.`);
