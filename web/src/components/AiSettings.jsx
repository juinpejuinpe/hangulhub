import { useState } from "react";
import {
  DEFAULT_AI_SETTINGS,
  MODEL_SUGGESTIONS,
  getAiSettings,
  pingModel,
  saveAiSettings,
} from "../ai.js";
import { Modal, useToast } from "./ui.jsx";

export default function AiSettings({ onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(getAiSettings());
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState("");

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function test() {
    setTesting(true);
    setStatus("");
    const previous = getAiSettings();
    saveAiSettings(form);
    try {
      const reply = await pingModel();
      setStatus(`Connected — the model replied “${reply}”.`);
    } catch (err) {
      setStatus(err.message);
      saveAiSettings(previous);
    } finally {
      setTesting(false);
    }
  }

  function save() {
    saveAiSettings(form);
    toast("AI settings saved to this browser.");
    onClose();
  }

  return (
    <Modal
      title="AI settings"
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={test} disabled={testing || !form.apiKey.trim()}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        </>
      )}
    >
      <p className="text-soft small">
        The AI features use your own DeepSeek account. The key is stored only in this
        browser — never in the app bundle, the repository, or your Firestore data.
      </p>

      <div className="field">
        <label htmlFor="ai-key">API key</label>
        <input
          id="ai-key"
          className="input"
          type="password"
          value={form.apiKey}
          onChange={(event) => set({ apiKey: event.target.value })}
          placeholder="sk-…"
          autoComplete="off"
        />
        <div className="hint">
          From platform.deepseek.com → API keys. Anything you paste here can be read by
          anyone using this browser profile, so keep it to a device you control.
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="ai-model">Model</label>
          <input
            id="ai-model"
            className="input"
            list="ai-model-options"
            value={form.model}
            onChange={(event) => set({ model: event.target.value })}
          />
          <datalist id="ai-model-options">
            {MODEL_SUGGESTIONS.map((model) => <option key={model} value={model} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="ai-temp">Temperature</label>
          <input
            id="ai-temp"
            className="input"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={form.temperature}
            onChange={(event) => set({ temperature: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="ai-base">Base URL</label>
        <input
          id="ai-base"
          className="input"
          value={form.baseUrl}
          onChange={(event) => set({ baseUrl: event.target.value })}
          placeholder={DEFAULT_AI_SETTINGS.baseUrl}
        />
        <div className="hint">
          Change this only if you route through a proxy of your own.
        </div>
      </div>

      {status ? <div className={status.startsWith("Connected") ? "ok-banner" : "error-banner"}>{status}</div> : null}
    </Modal>
  );
}
