// Deck logic ported from the Flask app's store.py so a deck behaves the same way:
// a random order, correct cards leave the round, uncertain/wrong ones come back.

export function newId(prefix = "id") {
  const random =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) ||
    Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}

export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newCard(front, back = "") {
  return {
    id: newId("card"),
    front,
    back,
    correct: 0,
    wrong: 0,
    uncertain: 0,
    learned: false,
  };
}

export function emptyStats() {
  return { correct: 0, wrong: 0, uncertain: 0 };
}

export function resetStudy(deck) {
  const cards = (deck.cards || []).map((card) => ({
    ...card,
    correct: 0,
    wrong: 0,
    uncertain: 0,
    learned: false,
  }));
  return {
    ...deck,
    cards,
    stats: emptyStats(),
    study: { order: shuffle(cards.map((c) => c.id)), index: 0, completed: false },
  };
}

export function isComplete(deck) {
  const cards = deck.cards || [];
  return cards.length > 0 && cards.every((c) => c.learned);
}

export function applyAnswer(deck, cardId, verdict) {
  if (!["correct", "wrong", "uncertain"].includes(verdict)) return deck;
  const cards = (deck.cards || []).map((card) => ({ ...card }));
  const card = cards.find((c) => c.id === cardId);
  if (!card) return deck;

  const stats = { ...emptyStats(), ...(deck.stats || {}) };
  card[verdict] = (card[verdict] || 0) + 1;
  stats[verdict] += 1;

  const base = deck.study || resetStudy({ cards }).study;
  const order = [...base.order];
  let index = base.index || 0;

  if (index < order.length && order[index] === cardId) {
    order.splice(index, 1);
    if (verdict === "correct") {
      card.learned = true;
      index = index >= order.length ? 0 : index;
    } else {
      order.push(cardId);
      index = index >= order.length - 1 ? 0 : index;
    }
  }

  const study = {
    order,
    index,
    completed: cards.length > 0 && cards.every((c) => c.learned),
  };
  return { ...deck, cards, stats, study };
}

export function deckProgress(deck) {
  const cards = deck.cards || [];
  const learned = cards.filter((c) => c.learned).length;
  return {
    total: cards.length,
    learned,
    percent: cards.length ? Math.round((learned / cards.length) * 100) : 0,
  };
}

export function currentCard(deck) {
  const cards = deck.cards || [];
  const order = deck.study?.order || [];
  if (!order.length) return null;
  const index = Math.min(deck.study?.index || 0, order.length - 1);
  return cards.find((c) => c.id === order[index]) || null;
}
