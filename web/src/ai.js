// DeepSeek-backed generation and grading, ported from the local app's
// ai_service.py. The API key lives in this browser's localStorage — it is never
// bundled with the app or committed, and DeepSeek's API accepts browser calls
// (its CORS headers echo the requesting origin).

const SETTINGS_KEY = "hangulhub.ai.settings";

export const DEFAULT_AI_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-v4-flash",
  temperature: 0.3,
};

export const MODEL_SUGGESTIONS = ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"];

export function getAiSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_AI_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(patch) {
  const next = { ...getAiSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function hasApiKey() {
  return Boolean(getAiSettings().apiKey.trim());
}

const SYSTEM_EXAMINER =
  "You are an expert Korean-language examiner and tutor with deep knowledge of " +
  "the TOPIK format and school-style Korean exams. You create accurate, natural, " +
  "level-appropriate material and grade like a careful teacher. " +
  "Write instructions/explanations in English and question content in Korean " +
  "when the source material is Korean. Only output valid JSON matching the exact " +
  "schema you are given, with no commentary, no code fences, and no trailing text.";

function friendlyError(status, body) {
  let detail = String(body || "").slice(0, 300);
  try {
    detail = JSON.parse(body)?.error?.message || detail;
  } catch {
    /* keep the raw text */
  }
  if (status === 401) return "The AI provider rejected the API key. Check it in AI settings.";
  if (status === 402) return "The AI provider reports insufficient balance for this key.";
  if (status === 429) return "Rate limited by the AI provider — wait a moment and try again.";
  return `AI provider error (${status}): ${detail}`;
}

/** One chat completion. Returns the assistant's raw text. */
export async function chat(messages, options = {}) {
  const settings = getAiSettings();
  const key = settings.apiKey.trim();
  if (!key) {
    throw new Error("No DeepSeek API key yet. Open AI settings (the ⚙ in the top bar) and paste your key.");
  }
  const base = (settings.baseUrl || DEFAULT_AI_SETTINGS.baseUrl).replace(/\/+$/, "");
  const payload = {
    model: settings.model || DEFAULT_AI_SETTINGS.model,
    messages,
    temperature: options.temperature ?? Number(settings.temperature ?? 0.3),
  };
  if (options.json) payload.response_format = { type: "json_object" };
  if (options.maxTokens) payload.max_tokens = options.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 600_000);
  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err.name === "AbortError"
        ? "The AI request timed out. Try a shorter selection of material."
        : "Could not reach the AI provider. Check your connection and the base URL in AI settings."
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(friendlyError(response.status, await response.text().catch(() => "")));
  }
  const data = await response.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The AI provider returned an unexpected response.");
  return text;
}

function extractJson(raw) {
  const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The AI response did not contain JSON.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new Error(`The AI response was not valid JSON (${err.message}). Try again.`);
  }
}

/** Ask for JSON, and retry once with a correction if the model wraps it in prose. */
export async function jsonCall(messages, options = {}) {
  const raw = await chat(messages, { ...options, json: true });
  try {
    return extractJson(raw);
  } catch {
    return extractJson(
      await chat(
        [
          ...messages,
          { role: "assistant", content: raw },
          {
            role: "user",
            content: "Your previous reply was not valid JSON. Reply again with ONLY valid JSON matching the schema.",
          },
        ],
        { ...options, json: true }
      )
    );
  }
}

export async function pingModel() {
  const reply = await chat(
    [
      { role: "system", content: "Reply with exactly one word: OK." },
      { role: "user", content: "Ping" },
    ],
    { temperature: 0, maxTokens: 8, timeoutMs: 60_000 }
  );
  return reply.trim();
}

/* ------------------------------------------------------------------ context */

function clip(text, maxChars) {
  const value = String(text || "");
  if (!maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…[rest of file omitted]`;
}

export function fileText(file, maxChars = 100_000) {
  const content = file?.content || {};
  if (content.kind === "table") {
    const headers = content.headers || [];
    const lines = [headers.join("\t")];
    for (const row of content.rows || []) {
      lines.push(headers.map((header) => String(row[header] ?? "")).join("\t"));
    }
    return clip(lines.join("\n"), maxChars);
  }
  return clip(content.text || (content.lines || []).join("\n"), maxChars);
}

export function contextForFiles(files, totalChars = 100_000) {
  if (!files?.length) return "";
  const perFile = Math.max(4000, Math.floor(totalChars / files.length));
  return files
    .map((file) => {
      const text = fileText(file, perFile);
      return text ? `===== SOURCE: ${file.name} =====\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ schemas */

function schemaHint(schema) {
  return JSON.stringify(schema, null, 1);
}

function mcqSchema() {
  return {
    questions: [
      {
        prompt: "Full Korean question with ____ for the blank (string)",
        options: ["A", "B", "C", "D"],
        answer_index: 0,
        explanation: "Brief English explanation of why this is correct",
      },
    ],
  };
}

function paperSchema() {
  return {
    title: "Test title",
    instructions: "General instructions (English)",
    sections: [
      {
        title: "Section title in the style of the source paper",
        instructions: "Section-specific instructions",
        marks: 10,
        questions: [
          {
            type: "mc | fill | short | writing",
            prompt: "Full Korean prompt. Use ____ for blanks.",
            options: ["only for type mc", "four", "Korean", "options"],
            answer: "reference answer (never shown to the student)",
            explanation: "brief marking note",
            marks: 2,
          },
        ],
      },
    ],
  };
}

/* -------------------------------------------------------------- generation */

export async function generateMcq({ files, count, prompt, target }) {
  const total = Math.max(1, Math.min(999, Number(count) || 10));
  const context = contextForFiles(files, 100_000);
  const guidance =
    prompt?.trim() ||
    "A balanced grammar-focused multiple choice quiz. Use the sources when they are provided; otherwise produce questions at the course's target level.";
  const targetLine = target
    ? `Target exam/course: ${target}`
    : "Target level: intermediate Korean unless the sources suggest otherwise.";

  const questions = [];
  const batchSize = 15;
  for (let start = 0; start < total; start += batchSize) {
    const n = Math.min(batchSize, total - start);
    const user =
      (context ? `${context}\n\n` : "") +
      `
${targetLine}
Create exactly ${n} multiple choice questions (Question numbering continues from ${start + 1} to ${start + n}.) for Korean exam practice.
User's requested focus: ${guidance}
Rules:
- Keep questions in Korean, explanations in English.
- Exactly 4 options per question; exactly one correct.
- A grammar sentence should use "____" for the blank.
- Do not reuse the same question.
Return ONLY JSON with this schema:
${schemaHint(mcqSchema())}
`;
    const data = await jsonCall(
      [
        { role: "system", content: SYSTEM_EXAMINER },
        { role: "user", content: user },
      ],
      { temperature: 0.4, timeoutMs: 900_000 }
    );
    const batch = (data.questions || []).slice(0, n);
    if (!batch.length) throw new Error("The AI returned no questions. Please try again.");
    questions.push(...batch);
  }
  return normalizeMcq({ questions });
}

export async function convertPaper({ files, prompt }) {
  const context = contextForFiles(files, 100_000);
  const guidance = prompt?.trim() || "Follow the source paper structure exactly.";
  const user = `
${context}
Convert the source exam paper(s) above into an online test that keeps the real
paper's structure: same section titles, same section order, and the same number
of questions per section as far as the text allows.
User notes: ${guidance}

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
${schemaHint(paperSchema())}
`;
  const data = await jsonCall(
    [
      { role: "system", content: SYSTEM_EXAMINER },
      { role: "user", content: user },
    ],
    { temperature: 0.2, timeoutMs: 900_000 }
  );
  return normalizeContent(data);
}

export async function generateMock({ files, prompt, target }) {
  const context = contextForFiles(files, 100_000);
  const guidance =
    prompt?.trim() || "Create a fresh mock paper that mirrors the structure of the past papers.";
  const targetLine = target ? `Target exam: ${target}.` : "";
  const user = `
${context}
The files above are past papers for ${targetLine || "a Korean exam"}.
Create a BRAND-NEW mock paper that matches their structure exactly: same section
titles, same order, same marks distribution, and the same number of questions per
section. The content must be new (different sentences, vocabulary and topics) but
at the same difficulty level.
User notes: ${guidance}

Rules:
- Follow the rules for audio sections and answer keys from the conversion spec:
  keep section titles, adapt unanswerable audio questions into text questions,
  never invent extra sections.
- Multiple choice must have exactly 4 options; other types as in the source.
- Provide "answer" and "explanation" for every question (used for grading only).
Return ONLY JSON with this schema:
${schemaHint(paperSchema())}
`;
  const data = await jsonCall(
    [
      { role: "system", content: SYSTEM_EXAMINER },
      { role: "user", content: user },
    ],
    { temperature: 0.5, timeoutMs: 1_200_000 }
  );
  return normalizeContent(data);
}

/* --------------------------------------------------------------- normalising */

function newId(prefix) {
  const random =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ||
    Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export function normalizeMcq(payload) {
  const questions = (payload.questions || [])
    .map((q) => {
      const options = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
      while (options.length < 4) options.push(`Option ${options.length + 1}`);
      let answer = q.answer_index ?? q.answer;
      if (typeof answer === "string") {
        const letter = answer.trim().toUpperCase();
        if (/^[A-D]$/.test(letter)) answer = letter.charCodeAt(0) - 65;
        else answer = Number.parseInt(letter, 10);
      }
      if (!Number.isInteger(answer) || answer < 0 || answer > 3) answer = 0;
      return {
        id: newId("q"),
        type: "mc",
        prompt: String(q.prompt || "").trim(),
        options: options.slice(0, 4),
        answer,
        explanation: String(q.explanation || "").trim(),
        marks: 1,
      };
    })
    .filter((q) => q.prompt);

  return {
    title: "Multiple choice quiz",
    instructions: "Choose the best answer for each question.",
    sections: [
      {
        title: "Multiple choice",
        instructions: "",
        marks: questions.length,
        questions,
      },
    ],
  };
}

export function normalizeContent(content) {
  let sections = content.sections || [];
  if (!sections.length && content.questions) {
    sections = [
      { title: content.title || "Questions", instructions: "", marks: 0, questions: content.questions },
    ];
  }
  const normalized = sections
    .map((section) => {
      const questions = (section.questions || [])
        .map((q) => {
          let type = String(q.type || "mc").toLowerCase();
          const rawOptions = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
          if (!["mc", "fill", "short", "writing"].includes(type)) {
            type = rawOptions.length ? "mc" : "short";
          }
          const item = {
            id: newId("q"),
            type,
            prompt: String(q.prompt || "").trim(),
            answer: String(q.answer ?? "").trim(),
            explanation: String(q.explanation || "").trim(),
            marks: Math.max(1, Math.round(Number(q.marks) || 1)),
          };
          if (type === "mc") {
            const options = rawOptions.slice(0, 4);
            while (options.length < 4) options.push(`Option ${options.length + 1}`);
            item.options = options;
            const answer = q.answer;
            if (typeof answer === "number" && answer >= 0 && answer < 4) item.answer = answer;
            else if (/^[A-D]$/i.test(String(answer).trim())) {
              item.answer = String(answer).trim().toUpperCase().charCodeAt(0) - 65;
            } else {
              const index = Number.parseInt(answer, 10);
              item.answer = Number.isInteger(index) && index >= 0 && index < 4 ? index : 0;
            }
          }
          return item;
        })
        .filter((q) => q.prompt);
      return {
        title: String(section.title || "").trim() || "Section",
        instructions: String(section.instructions || "").trim(),
        marks: Math.round(Number(section.marks) || 0),
        questions,
      };
    })
    .filter((section) => section.questions.length);

  return {
    title: String(content.title || "").trim() || "Untitled test",
    instructions: String(content.instructions || "").trim(),
    sections: normalized,
  };
}

/* ------------------------------------------------------------------ grading */

export function flattenQuestions(content) {
  return (content?.sections || []).flatMap((section) => section.questions || []);
}

export function totalMarks(content) {
  return (content?.sections || []).reduce((sum, section) => {
    const own = (section.questions || []).reduce((s, q) => s + (Number(q.marks) || 0), 0);
    return sum + own;
  }, 0);
}

/** Multiple choice is graded locally — no AI call, no waiting, no cost. */
export function gradeMcq(content, answers) {
  const questions = flattenQuestions(content);
  let correct = 0;
  const results = questions.map((q) => {
    const given = answers[q.id];
    const givenIndex = given === undefined || given === "" ? -1 : Number(given);
    const right = q.type === "mc" ? q.answer === givenIndex : String(q.answer) === String(given);
    if (right) correct += 1;
    return {
      id: q.id,
      score: right ? 1 : 0,
      max: 1,
      feedback: q.explanation || "",
      correctAnswer: q.type === "mc" ? String.fromCharCode(65 + Number(q.answer)) : q.answer,
      yourAnswer: q.type === "mc" && givenIndex >= 0 ? String.fromCharCode(65 + givenIndex) : given,
      prompt: q.prompt,
      type: q.type,
    };
  });
  return {
    score: correct,
    maxScore: questions.length,
    questions: results,
    sections: [],
    overallFeedback: questions.length
      ? `You answered ${correct} of ${questions.length} questions correctly.`
      : "No questions.",
    estimatedBand: "",
  };
}

export async function gradeTest(test, answers) {
  const questions = flattenQuestions(test.content);
  if (!questions.length) throw new Error("The test has no questions to grade.");

  const listing = questions.map((q, index) => {
    const options =
      q.type === "mc"
        ? `\n${(q.options || []).map((opt, i) => `  ${String.fromCharCode(65 + i)}. ${opt}`).join("\n")}`
        : "";
    const given = answers[q.id];
    const shown = q.type === "mc" && given !== undefined && given !== "" ? String.fromCharCode(65 + Number(given)) : given;
    return (
      `${index + 1}. [${q.type}] ${q.prompt}${options}\n` +
      `   Question id: ${q.id}\n` +
      `   Student answer: ${shown || "(blank)"}\n` +
      `   Marks available: ${q.marks ?? 1}\n` +
      `   Reference: ${q.answer || "not provided"}\n`
    );
  });

  const schema = {
    score: 0,
    maxScore: 0,
    sections: [{ index: 0, title: "Section title", score: 0, max: 0, feedback: "Short feedback for this section" }],
    questions: [
      { id: "question id", score: 0, max: 0, feedback: "Specific, encouraging correction or praise" },
    ],
    overallFeedback: "Paragraph of overall feedback",
    estimatedBand: "e.g. TOPIK 2 or school-grade estimate",
  };

  const user = `
Grade this completed ${test.kind} test like a careful examiner.
Be fair but strict. Partial marks are allowed for short/writing answers.
Assign the same per-question marks used by the paper (fall back to sensible
defaults when a question has no marks field). Give every question its own
feedback that quotes what the student wrote when useful.

Test title: ${test.title}

Student answers:
${listing.join("\n")}

Return ONLY JSON with this schema:
${schemaHint(schema)}
`;

  const result = await jsonCall(
    [
      { role: "system", content: SYSTEM_EXAMINER },
      { role: "user", content: user },
    ],
    { temperature: 0.2, timeoutMs: 900_000 }
  );

  const byId = new Map(questions.map((q) => [q.id, q]));
  const scored = new Map();
  for (const item of result.questions || []) {
    const question = byId.get(item.id);
    if (!question) continue;
    const given = answers[question.id];
    scored.set(item.id, {
      ...item,
      type: question.type,
      prompt: question.prompt,
      yourAnswer:
        question.type === "mc" && given !== undefined && given !== ""
          ? String.fromCharCode(65 + Number(given))
          : given || "(blank)",
      correctAnswer:
        question.type === "mc" ? String.fromCharCode(65 + Number(question.answer)) : question.answer,
    });
  }
  for (const question of questions) {
    if (!scored.has(question.id)) {
      scored.set(question.id, {
        id: question.id,
        score: 0,
        max: question.marks || 0,
        feedback: "No feedback returned for this question.",
        prompt: question.prompt,
        type: question.type,
        yourAnswer: answers[question.id] || "(blank)",
      });
    }
  }
  const results = [...scored.values()];
  const earned = results.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
  const possible = results.reduce((sum, item) => sum + (Number(item.max) || 0), 0);
  return {
    ...result,
    score: Number(result.score) || earned,
    maxScore: Number(result.maxScore) || possible,
    sections: result.sections || [],
    questions: results,
  };
}

/* ------------------------------------------------------------------- chat */

export async function chatReply({ files, history, question }) {
  const context = contextForFiles(files, 60_000);
  const sourceNote = context
    ? "Answer using the sources below. When you use a source, cite it on its own line like: From <filename>: …"
    : "Answer as a Korean tutor. No sources were selected, so answer from your own knowledge and say when you are unsure.";
  const messages = [
    {
      role: "system",
      content:
        "You are a friendly Korean-language tutor who helps a learner understand their study materials and prepare for exams. Explain clearly and concretely, with examples. Keep answers focused.",
    },
  ];
  if (context) messages.push({ role: "user", content: `STUDY SOURCES:\n${context}` });
  messages.push({ role: "user", content: sourceNote });
  for (const message of (history || []).slice(-8)) {
    messages.push({ role: message.role, content: message.content || "" });
  }
  messages.push({ role: "user", content: question });
  return chat(messages, { temperature: 0.4, timeoutMs: 300_000 });
}
