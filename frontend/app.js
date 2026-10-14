/* ==========================================================================
   Arogya — wellness companion chat app
   Crafted by Vivek Nair (VN) — https://github.com/vivekn4
   React 18 (UMD) + in-browser JSX via Babel standalone. Zero build step:
   deploy this folder as a static site.
   ========================================================================== */

const { useState, useRef, useEffect, useCallback, useMemo } = React;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

// Point the app at your backend in ./config.js. Default "/api/chat" works
// when frontend and backend share an origin (or a reverse proxy routes /api).
const API_URL =
  (window.AROGYA_CONFIG && window.AROGYA_CONFIG.API_URL) || "/api/chat";

/* ------------------------------------------------------------------ */
/* Safety nets — client-side crisis & emergency detection              */
/* ------------------------------------------------------------------ */

const CRISIS_RE = [
  /\b(kill|end|take)\s*(my|your)?\s*life\b/i,
  /\bsuicid/i,
  /\bwant\s*to\s*die\b/i,
  /\bself.?harm\b/i,
  /\bcut\s*myself\b/i,
  /\bhurt\s*myself\b/i,
  /\bno\s*reason\s*to\s*live\b/i,
  /\bcan'?t\s*(go\s*on|take\s*it)\b/i,
];
const EMERGENCY_RE = [
  /\bchest\s*pain\b/i,
  /\bheart\s*attack\b/i,
  /\bcan'?t\s*breath/i,
  /\bdifficult.{0,10}breath/i,
  /\bstroke\b/i,
  /\bseizure\b/i,
  /\bcoughing\s*blood\b/i,
  /\boverdose\b/i,
  /\bunconscious\b/i,
  /\bnot\s*breathing\b/i,
];

const isCrisis = (text) => CRISIS_RE.some((r) => r.test(text));
const isEmergency = (text) => EMERGENCY_RE.some((r) => r.test(text));

/* ------------------------------------------------------------------ */
/* Static content                                                      */
/* ------------------------------------------------------------------ */

const BODY_AREAS = [
  { id: "head", ic: "🧠", label: "Head & Face" },
  { id: "eyes", ic: "👁️", label: "Eyes" },
  { id: "ears", ic: "👂", label: "Ears" },
  { id: "nose", ic: "👃", label: "Nose" },
  { id: "throat", ic: "🗣️", label: "Throat" },
  { id: "chest", ic: "🫁", label: "Chest" },
  { id: "stomach", ic: "🫃", label: "Stomach" },
  { id: "back", ic: "🦴", label: "Back" },
  { id: "skin", ic: "🩹", label: "Skin" },
  { id: "arms", ic: "🤲", label: "Arms & Hands" },
  { id: "legs", ic: "🦵", label: "Legs & Feet" },
  { id: "mental", ic: "🧘", label: "Mood & Stress" },
];

const STEPS = [
  { key: "area", label: "Location" },
  { key: "symptoms", label: "Symptoms" },
  { key: "duration", label: "Duration" },
  { key: "severity", label: "Severity" },
  { key: "remedy", label: "Remedy" },
];

const PRIVACY = [
  {
    h: "Overview",
    p: "Arogya is a wellness companion app. Your conversations are anonymous and are never stored after your session ends.",
  },
  {
    h: "What we process",
    ul: [
      "Symptom descriptions — processed in real time only, never stored",
      "Anonymous usage analytics (session length, feature usage)",
      "Device type and OS for crash reporting",
      "Calm Hub check-ins, habits, and session lengths — stored ONLY on your device (localStorage), never sent to us",
    ],
  },
  {
    h: "What we never collect",
    ul: [
      "Your name, email, or any identifying information",
      "Location data",
      "Health records or medical history",
      "Payment information",
    ],
  },
  {
    h: "How data is used",
    ul: [
      "Messages are sent to our AI service and not retained after your session",
      "Anonymous analytics help us improve the app",
      "No data is ever sold to third parties",
    ],
  },
  {
    h: "Medical disclaimer",
    p: "Arogya is not a medical device and does not provide diagnoses or prescriptions. The information provided is for general wellness guidance only. Always consult a qualified healthcare professional for medical concerns.",
  },
  {
    h: "Your rights",
    ul: ["Request deletion of any associated data", "Contact: privacy@arogya.app"],
  },
];

const FALLBACK = {
  role: "bot",
  message: "Hey! Good to see you. What's been bothering you today?",
  quickReplies: ["I have a headache", "Stomach issues", "Feeling feverish", "Mood & stress"],
  stage: "questioning",
  currentStep: "area",
  collectedSymptoms: [],
  remedies: [],
  doctorNote: null,
  warningSigns: [],
  isSummary: false,
  showSoftCrisis: false,
  softCrisisMessage: null,
};

const EMERGENCY_MSG = {
  role: "bot",
  message: "I need to pause here — what you've described sounds like it needs urgent attention right away.",
  quickReplies: [],
  stage: "doctor",
  currentStep: "remedy",
  collectedSymptoms: [],
  remedies: [],
  doctorNote:
    "Please call emergency services (911 / 999 / 112) or get to your nearest emergency room immediately. Don't wait on this — the sooner you're seen, the better.",
  warningSigns: [],
  isSummary: false,
  showSoftCrisis: false,
  softCrisisMessage: null,
};

/* ------------------------------------------------------------------ */
/* API + response parsing                                              */
/* ------------------------------------------------------------------ */

async function callAI(messages, { signal } = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    throw new Error("Backend returned invalid JSON.");
  }

  if (!res.ok) {
    const e = new Error(data?.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* callAI with a hard timeout + a "slow" hint for cold starts          */
/* Render's free tier sleeps when idle, so the first request can take  */
/* 30-60s to wake the backend. Without a timeout the UI would show     */
/* typing dots forever and block the send button.                      */
/* ------------------------------------------------------------------ */

const API_TIMEOUT_MS = 75000; // covers cold start (~60s) + backend AI timeout (60s)
const SLOW_HINT_MS = 8000; // after this long, tell the user we're waking up
const STREAM_URL = API_URL.replace(/\/chat$/, "/chat/stream");

function isTimeoutError(err) {
  return (
    err?.name === "AbortError" ||
    /abort|timeout/i.test(err?.message || "") ||
    err?.code === 20
  );
}

/**
 * Extract the in-progress "message" field from a partially-streamed JSON
 * reply. The model is instructed to put "message" first, so this usually
 * yields displayable text within the first chunks. Returns "" if the field
 * hasn't started arriving yet.
 */
function extractStreamingMessage(acc) {
  const m = acc.match(/"message"\s*:\s*"/);
  if (!m) return "";
  const inner = acc.slice(m.index + m[0].length);
  let i = 0;
  let out = "";
  while (i < inner.length) {
    const c = inner[i];
    if (c === "\\" && i + 1 < inner.length) {
      out += c + inner[i + 1];
      i += 2;
      continue;
    }
    if (c === '"') break;
    out += c;
    i++;
  }
  try {
    return JSON.parse('"' + out + '"');
  } catch {
    return out.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

/**
 * POST to the SSE stream endpoint and invoke onDelta(accumulatedText) as
 * chunks arrive. Resolves to the final {done, reply|error, ...} event.
 * Aborts after API_TIMEOUT_MS; onSlow fires if nothing arrives quickly.
 */
async function streamChat(messages, { onDelta, onSlow, signal } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  let slowTimer = null;
  let settled = false;
  if (onSlow) {
    slowTimer = setTimeout(() => {
      if (!settled) onSlow();
    }, SLOW_HINT_MS);
  }
  const timeout = setTimeout(() => {
    const err = new Error("Request timed out");
    err.name = "AbortError";
    controller.abort(err);
  }, API_TIMEOUT_MS);

  try {
    const res = await fetch(STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const d = await res.json();
        if (d?.error) msg = d.error;
      } catch {
        /* ignore */
      }
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let acc = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const evt = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of evt.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          let obj;
          try {
            obj = JSON.parse(t.slice(5).trim());
          } catch {
            continue;
          }
          if (obj.delta) {
            acc += obj.delta;
            if (onDelta) onDelta(acc);
          }
          if (obj.done) {
            settled = true;
            return obj;
          }
        }
      }
    }
    throw new Error("Stream ended unexpectedly");
  } finally {
    settled = true;
    clearTimeout(slowTimer);
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function defaultParsed(message = "I had a little hiccup — could you say that again?") {
  return {
    message,
    quickReplies: [],
    stage: "questioning",
    currentStep: "area",
    collectedSymptoms: [],
    remedies: [],
    doctorNote: null,
    warningSigns: [],
    isSummary: false,
    showSoftCrisis: false,
    softCrisisMessage: null,
  };
}

/**
 * The backend already normalizes the model reply into { reply: {...} }.
 * This parser stays liberal for backwards compatibility with older
 * backends and odd shapes (string replies, Anthropic content blocks).
 */
function parseResponse(data) {
  try {
    if (!data) return defaultParsed();
    if (typeof data === "string") return JSON.parse(data);
    if (data.reply && typeof data.reply === "object") return { ...defaultParsed(), ...data.reply };
    if (typeof data.reply === "string") return JSON.parse(data.reply);
    if (data.message && typeof data.message === "string") return { ...defaultParsed(), ...data };

    const raw = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    if (!raw) return defaultParsed("I didn't get a proper answer from the server.");
    return JSON.parse(raw);
  } catch (error) {
    console.error("parseResponse error:", error, data);
    return defaultParsed();
  }
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

function CrisisScreen({ onBack }) {
  return (
    <div className="crisis" role="alert" aria-labelledby="crisis-title">
      <div className="crisis-icon" aria-hidden="true">
        🆘
      </div>
      <h2 className="crisis-title" id="crisis-title">
        You don't have to go through this alone
      </h2>
      <p className="crisis-sub">
        It sounds like you might be going through something really difficult. Please reach out — these
        services are free, confidential, and available 24/7.
      </p>
      <div className="crisis-lines">
        {[
          {
            ic: "📞",
            num: "https://www.iasp.info/resources/Crisis_Centres/",
            display: "International Crisis Directory",
            sub: "Find your local crisis line",
          },
          {
            ic: "💬",
            num: "sms:741741",
            display: "Text HOME to 741741",
            sub: "US / UK / Canada / Ireland — free 24/7",
          },
          {
            ic: "🚨",
            num: "tel:988",
            display: "Call or text 988",
            sub: "US Suicide & Crisis Lifeline — free 24/7",
          },
          {
            ic: "⛑️",
            num: "tel:911",
            display: "Call 911 / 999 / 112",
            sub: "If you are in immediate danger",
          },
        ].map((c) => (
          <a
            key={c.display}
            className="crisis-line"
            href={c.num}
            target={c.num.startsWith("http") ? "_blank" : "_self"}
            rel="noreferrer"
          >
            <span className="crisis-line-ic" aria-hidden="true">
              {c.ic}
            </span>
            <div className="crisis-line-txt">
              {c.display}
              <small>{c.sub}</small>
            </div>
          </a>
        ))}
      </div>
      <p className="crisis-note">
        Arogya is a wellness companion and cannot provide crisis support. Real people are ready to help
        you right now.
      </p>
      <button className="crisis-back" onClick={onBack}>
        ← I'm okay, take me back
      </button>
    </div>
  );
}

function DisclaimerScreen({ onAccept, onShowPrivacy }) {
  const [checks, setChecks] = useState([false, false]);
  const [shaking, setShaking] = useState(false);
  const allChecked = checks[0] && checks[1];

  const toggle = (i) => setChecks((prev) => prev.map((v, j) => (j === i ? !v : v)));

  return (
    <div className="disc">
      <div className="disc-badge" aria-hidden="true">
        🌿
      </div>
      <h1 className="disc-title">Welcome to Arogya</h1>
      <p className="disc-sub">Before we begin, please read and agree to the following.</p>

      <div className="disc-box">
        {[
          {
            ic: "🩺",
            t: "Not a Medical Service",
            d: "Arogya is a wellness companion, not a doctor. Nothing here replaces professional medical advice, diagnosis, or treatment.",
          },
          {
            ic: "🚨",
            t: "In an Emergency",
            d: "If you're in a life-threatening situation — call emergency services (911/999/112) immediately. Do not use this app.",
          },
          {
            ic: "💊",
            t: "No Medication Advice",
            d: "Arogya only suggests natural home remedies and will never recommend medications or prescriptions.",
          },
          {
            ic: "🔒",
            t: "Your Privacy",
            d: "Conversations are anonymous and not stored after your session ends.",
          },
        ].map((item) => (
          <div className="disc-item" key={item.t}>
            <span className="disc-ic" aria-hidden="true">
              {item.ic}
            </span>
            <div className="disc-txt">
              <strong>{item.t}</strong>
              {item.d}
            </div>
          </div>
        ))}
      </div>

      <div className="disc-checks">
        {[
          "I understand Arogya is not a medical service and does not replace a doctor.",
          "I will call emergency services if I am in a life-threatening situation.",
        ].map((label, i) => (
          <label key={label} className={`disc-check${checks[i] ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={checks[i]}
              onChange={() => toggle(i)}
              aria-label={label}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <button
        className={`disc-btn${shaking ? " shake" : ""}`}
        onClick={() => {
          if (!allChecked) {
            setShaking(true);
            return;
          }
          onAccept();
        }}
        onAnimationEnd={() => setShaking(false)}
      >
        {allChecked ? "I Agree — Let's Go 🌼" : "Please tick both boxes above"}
      </button>

      <p className="disc-foot">
        By continuing you agree to our{" "}
        <button className="linklike" onClick={onShowPrivacy}>
          Privacy Policy
        </button>
      </p>
    </div>
  );
}

function OfflineScreen() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="offline" role="alert">
      <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.7 }} aria-hidden="true">
        📡
      </div>
      <h2>No Internet Connection</h2>
      <p>Arogya needs an internet connection. Please check your Wi-Fi or mobile data.</p>
      <button className="primary-btn" onClick={() => window.location.reload()}>
        Try Again
      </button>
      <div className="status-row">
        <span className={`sdot${online ? " on" : ""}`} aria-hidden="true" />
        {online ? "Back online — tap Try Again" : "Still offline"}
      </div>
    </div>
  );
}

function WelcomeScreen({ onStart, onShowPrivacy, onOpenCalm }) {
  const starters = [
    { ic: "🤕", label: "I have a headache", msg: "I have a headache" },
    { ic: "🤒", label: "Feeling feverish", msg: "I'm feeling feverish" },
    { ic: "😮‍💨", label: "Stomach issues", msg: "My stomach is bothering me" },
    { ic: "😰", label: "Stressed out", msg: "I've been feeling really stressed lately" },
  ];
  return (
    <main className="welcome" id="main">
      <span className="welcome-leaf" aria-hidden="true">
        🌿
      </span>
      <h1>
        Not feeling well?
        <br />
        <em>We've got you covered.</em>
      </h1>
      <p>
        Tell Arogya how you're feeling — your caring wellness companion will ask a few gentle questions
        and suggest natural home remedies to help you feel better.
      </p>
      <div className="starters">
        <div className="starters-lbl">Try one to start:</div>
        <div className="starters-row">
          {starters.map((s) => (
            <button key={s.label} className="starter-chip" onClick={() => onStart(s.msg)}>
              <span aria-hidden="true">{s.ic}</span> {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="feat-grid">
        {[
          { ic: "🤫", t: "Fully Private", d: "Anonymous — no data stored" },
          { ic: "🌐", t: "Web-Sourced", d: "Remedies from trusted health sources" },
          { ic: "🌱", t: "All Natural", d: "Home remedies only, no medication" },
          { ic: "💛", t: "Calm Guidance", d: "Reassuring — never scary" },
        ].map((f) => (
          <div className="feat" key={f.t}>
            <span className="feat-ic" aria-hidden="true">
              {f.ic}
            </span>
            <div className="feat-tx">
              <strong>{f.t}</strong>
              {f.d}
            </div>
          </div>
        ))}
      </div>
      <button className="start-btn" onClick={() => onStart()}>
        Chat with Arogya 🌼
      </button>
      <button className="start-btn calm-entry-btn" onClick={onOpenCalm}>
        🧘 Breathe &amp; check in — Calm Hub
      </button>
      <p className="welcome-foot">
        <span aria-hidden="true">🔒</span> Anonymous &nbsp;·&nbsp;
        <button className="linklike" onClick={onShowPrivacy}>
          Privacy Policy
        </button>
        &nbsp;·&nbsp; Not a medical service
      </p>
    </main>
  );
}

function Toast({ message, onClose }) {
  return (
    <div className="toast" role="status">
      {message}
      <button onClick={onClose} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}

function PrivacyModal({ onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <div className="modal-handle" aria-hidden="true" />
        <div className="modal-head">
          <h3 id="privacy-title">🔒 Privacy Policy</h3>
          <button className="modal-close" ref={closeRef} onClick={onClose} aria-label="Close privacy policy">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="pp-date">Last updated: October 2026</p>
          {PRIVACY.map((s) => (
            <div className="pp-sec" key={s.h}>
              <h4>{s.h}</h4>
              {s.p && <p>{s.p}</p>}
              {s.ul && (
                <ul>
                  {s.ul.map((li) => (
                    <li key={li}>{li}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BotBubble({ msg }) {
  return (
    <div className="mrow">
      <div className="mav" aria-hidden="true">
        🌿
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "78%" }}>
        <div className="bub bot">
          <p>{msg.message}</p>

          {msg.showSoftCrisis && msg.softCrisisMessage && (
            <div className="soft-crisis">
              <div className="soft-crisis-title">
                <span aria-hidden="true">💙</span> A gentle note
              </div>
              <p>
                {msg.softCrisisMessage} If you'd like to talk to someone,{" "}
                <a
                  href="https://www.iasp.info/resources/Crisis_Centres/"
                  target="_blank"
                  rel="noreferrer"
                >
                  support lines
                </a>{" "}
                are always available.
              </p>
            </div>
          )}

          {msg.remedies?.length > 0 && (
            <div className="rem-list">
              {msg.remedies.map((r, j) => (
                <div
                  className="rem-item"
                  key={`${r.title || "remedy"}-${j}`}
                  style={{ animationDelay: `${j * 0.07}s` }}
                >
                  <span className="rem-ic" aria-hidden="true">
                    {r.icon}
                  </span>
                  <div className="rem-body">
                    <strong>{r.title}</strong>
                    <span>{r.detail}</span>
                    {r.source && r.source !== "null" && (
                      <span className="src">
                        <span className="src-dot" aria-hidden="true" />
                        {r.source}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {msg.doctorNote && (
            <div className="doc-card">
              <div className="doc-title">
                <span aria-hidden="true">🏥</span> Just a gentle thought…
              </div>
              <p>{msg.doctorNote}</p>
            </div>
          )}

          {msg.warningSigns?.length > 0 && (
            <div>
              <p className="warn-label">
                <span aria-hidden="true">🔔</span> Do visit a doctor if you notice:
              </p>
              <div className="warn-chips">
                {msg.warningSigns.map((w) => (
                  <span className="warn-chip" key={w}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ symptoms, remedies, doctorNote }) {
  const [copied, setCopied] = useState(false);
  const deduped = useMemo(
    () => [...new Map(remedies.map((r) => [r.title + "|" + (r.detail || ""), r])).values()],
    [remedies]
  );
  const sources = useMemo(
    () => [...new Set(deduped.filter((r) => r.source && r.source !== "null").map((r) => r.source))],
    [deduped]
  );

  const shareSummary = useCallback(async () => {
    const lines = ["🌿 My Arogya Wellness Summary", ""];
    if (symptoms.length) lines.push(`Symptoms noted: ${symptoms.join(", ")}`);
    if (deduped.length) {
      lines.push("", "Remedies suggested:");
      deduped.forEach((r) => lines.push(`• ${r.icon || "🌱"} ${r.title}${r.detail ? ` — ${r.detail}` : ""}`));
    }
    if (doctorNote) lines.push("", `Doctor's note: ${doctorNote}`);
    lines.push("", "— via Arogya, your AI wellness companion");
    lines.push("https://arogya-app-yd2w.onrender.com");
    const text = lines.join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "My Arogya Wellness Summary", text });
        return;
      } catch {
        /* user dismissed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable */
    }
  }, [symptoms, deduped, doctorNote]);

  return (
    <div className="summary">
      <div className="sum-head">
        <span style={{ fontSize: 26 }} aria-hidden="true">
          📋
        </span>
        <div>
          <h3>Your Wellness Summary</h3>
          <p>Here's a recap of everything we covered</p>
        </div>
      </div>
      <div className="sum-body">
        {symptoms.length > 0 && (
          <div>
            <div className="sum-lbl">Symptoms noted</div>
            <div className="sum-tags">
              {symptoms.map((s) => (
                <span className="sum-tag" key={s}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {deduped.length > 0 && (
          <div>
            <div className="sum-lbl">Remedies suggested</div>
            <div className="sum-rems">
              {deduped.map((r, idx) => (
                <div className="sum-rem" key={`${r.title}-${idx}`}>
                  <span className="sum-rem-ic" aria-hidden="true">
                    {r.icon}
                  </span>
                  <span className="sum-rem-name">{r.title}</span>
                  {r.source && r.source !== "null" && (
                    <span className="src">
                      <span className="src-dot" aria-hidden="true" />
                      {r.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {doctorNote && (
          <div>
            <div className="sum-lbl">Doctor's note</div>
            <div className="sum-doc">
              <span aria-hidden="true">🏥</span> {doctorNote}
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div>
            <div className="sum-lbl">Sources referenced</div>
            <div className="sum-tags">
              {sources.map((s) => (
                <span className="src" key={s}>
                  <span className="src-dot" aria-hidden="true" />
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="sum-actions">
        <button className="share-btn" onClick={shareSummary}>
          {copied ? "✅ Copied to clipboard!" : "📤 Share my summary"}
        </button>
      </div>
      <div className="sum-foot">
        🌿 General wellness guidance — not a substitute for medical advice.
        <br />
        When in doubt, a doctor visit is always the right call. Take care! 💛
      </div>
    </div>
  );
}

function ChatScreen({ starter, onReset, onCrisis, onOpenCalm }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false); // backend cold start hint
  const [streaming, setStreaming] = useState(""); // live word-by-word reply text
  const [qrs, setQRs] = useState([]);
  const [symptoms, setSymptoms] = useState([]);
  const [curStep, setCurStep] = useState("area");
  const [areaChosen, setAreaChosen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [toast, setToast] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const histRef = useRef([]);
  const remRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streaming]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const showToast = useCallback((msg, ms = 4000) => {
    setToast(msg);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const handleData = useCallback((data, history) => {
    const parsed = parseResponse(data);
    if (window.VN_SFX) window.VN_SFX.chime(); // gentle reply chime
    histRef.current = [
      ...history,
      { role: "assistant", content: data.reply ? JSON.stringify(data.reply) : data.message || "" },
    ];

    if (parsed.collectedSymptoms?.length) {
      setSymptoms((prev) => [...new Set([...prev, ...parsed.collectedSymptoms])]);
    }
    if (parsed.currentStep) setCurStep(parsed.currentStep);
    if (parsed.remedies?.length) remRef.current = [...remRef.current, ...parsed.remedies];

    setMessages((prev) => [...prev, { role: "bot", ...parsed }]);
    setQRs(parsed.quickReplies || []);
    setLoading(false);
    setWaking(false);

    if (parsed.isSummary) {
      setSummary({ remedies: remRef.current, doctorNote: parsed.doctorNote || null });
    }
  }, []);

  // Instant greeting: no API round-trip on chat open. The opener is always the
  // same warm-up pattern, so seed it locally and keep history consistent for
  // the backend. Saves a full 8-16s AI call on every chat start; the first
  // real user message is what actually needs the AI.
  const sendRef = useRef(null);
  useEffect(() => {
    const { role: _r, ...greeting } = FALLBACK;
    histRef.current = [
      { role: "user", content: "hi" },
      { role: "assistant", content: JSON.stringify(greeting) },
    ];
    setMessages([{ role: "bot", ...greeting }]);
    setQRs(greeting.quickReplies);
    setCurStep(greeting.currentStep);
    setLoading(false);
    // A starter chip from the welcome screen auto-sends after the greeting paints.
    if (starter) {
      const t = setTimeout(() => {
        if (sendRef.current) sendRef.current(starter);
      }, 700);
      return () => clearTimeout(t);
    }
  }, []);

  const sendMessage = useCallback(
    async (textArg) => {
      const t = (typeof textArg === "string" ? textArg : input).trim();
      if (!t || loading) return;

      if (isCrisis(t)) {
        onCrisis();
        return;
      }

      if (isEmergency(t)) {
        setInput("");
        setQRs([]);
        setMessages((prev) => [...prev, { role: "user", message: t }, EMERGENCY_MSG]);
        return;
      }

      setInput("");
      if (inputRef.current) inputRef.current.style.height = "44px";
      setQRs([]);
      setMessages((prev) => [...prev, { role: "user", message: t }]);
      if (window.VN_SFX) window.VN_SFX.blip(); // serene send blip
      setLoading(true);

      const history = [...histRef.current, { role: "user", content: t }];
      histRef.current = history;

      try {
        setStreaming("");
        const result = await streamChat(history, {
          onSlow: () => setWaking(true),
          onDelta: (acc) => setStreaming(extractStreamingMessage(acc)),
        });
        setWaking(false);
        setStreaming("");
        if (result.error) {
          const e = new Error(result.error);
          e.status = result.status || 500;
          throw e;
        }
        handleData({ reply: result.reply, degraded: result.degraded }, history);
      } catch (err) {
        console.error("sendMessage error:", err);
        setLoading(false);
        setWaking(false);
        setStreaming("");

        if (isTimeoutError(err)) {
          showToast("☕ That took too long — the server may have been asleep. Try again!");
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              message:
                "Sorry about the wait — I was waking up and ran out of time. Mind sending that again?",
              quickReplies: ["Try again"],
              stage: "questioning",
              currentStep: curStep,
              collectedSymptoms: [],
              remedies: [],
              doctorNote: null,
              warningSigns: [],
              isSummary: false,
              showSoftCrisis: false,
              softCrisisMessage: null,
            },
          ]);
        } else if (err.status === 429) {
          showToast("⏳ Too busy right now — please wait a moment and try again");
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              message: "I'm getting a lot of requests right now — give me just a second and try again!",
              quickReplies: ["Try again"],
              stage: "questioning",
              currentStep: curStep,
              collectedSymptoms: [],
              remedies: [],
              doctorNote: null,
              warningSigns: [],
              isSummary: false,
              showSoftCrisis: false,
              softCrisisMessage: null,
            },
          ]);
        } else if (!navigator.onLine) {
          showToast("📡 No internet — please check your connection");
        } else {
          showToast("❌ Something went wrong — please try again");
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              message: "Hmm, I had a small issue there. Mind trying again?",
              quickReplies: ["Try again"],
              stage: "questioning",
              currentStep: curStep,
              collectedSymptoms: [],
              remedies: [],
              doctorNote: null,
              warningSigns: [],
              isSummary: false,
              showSoftCrisis: false,
              softCrisisMessage: null,
            },
          ]);
        }
      }
    },
    [input, loading, curStep, showToast, handleData, onCrisis]
  );

  // Keep the starter auto-send pointed at the latest sendMessage.
  sendRef.current = sendMessage;

  const pickArea = useCallback(
    (area) => {
      setAreaChosen(true);
      setCurStep("symptoms");
      sendMessage(area.label);
    },
    [sendMessage]
  );

  const stepIdx = STEPS.findIndex((s) => s.key === curStep);
  const showAreaPicker = messages.length > 0 && curStep === "area" && !areaChosen && !loading;

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="av" aria-hidden="true">
          🌿
        </div>
        <div className="hinfo">
          <h2>Arogya</h2>
          <span>
            <span className="odot" aria-hidden="true" />
            Your Wellness Companion
          </span>
        </div>
        <button className="new-btn" onClick={onReset} aria-label="Start a new chat">
          ✕ New Chat
        </button>
        <button className="new-btn" onClick={onOpenCalm} aria-label="Open Calm Hub — breathing, timer, check-in">
          🧘 Calm
        </button>
      </header>

      {symptoms.length > 0 && (
        <div className="sym-strip" aria-label="Symptoms noted so far">
          <span className="sym-label">Noted</span>
          <div className="sym-chips">
            {symptoms.map((s, i) => (
              <span className="sym-chip" key={s} style={{ animationDelay: `${i * 0.06}s` }}>
                <span className="sym-dot" aria-hidden="true" />
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && !summary && (
        <div className="step-bar" aria-hidden="true">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`step${i < stepIdx ? " done" : i === stepIdx ? " active" : ""}`}
            >
              <div className="step-dot">{i < stepIdx ? "✓" : i + 1}</div>
              <span className="step-name">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {showAreaPicker && (
        <div className="area-picker">
          <span className="area-label" id="area-label">
            Where does it feel off? Tap to select
          </span>
          <div className="area-grid" role="group" aria-labelledby="area-label">
            {BODY_AREAS.map((a) => (
              <button key={a.id} className="area-btn" onClick={() => pickArea(a)}>
                <span className="area-ic" aria-hidden="true">
                  {a.ic}
                </span>
                <span className="area-lbl">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="msgs" role="log" aria-live="polite" aria-label="Conversation with Arogya">
        <div className="anon-pill">Private &amp; anonymous — no data stored</div>
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div className="mrow user" key={`u-${i}`}>
              <div className="mav u" aria-hidden="true">
                🙂
              </div>
              <div className="bub usr">
                <p>{msg.message}</p>
              </div>
            </div>
          ) : (
            <BotBubble key={`b-${i}`} msg={msg} />
          )
        )}

        {loading && (
          <div className="mrow">
            <div className="mav">🌿</div>
            <div className="bub bot">
              {streaming ? (
                <p>
                  {streaming}
                  <span className="stream-cursor" aria-hidden="true" />
                </p>
              ) : (
                <div className="typing" aria-label={waking ? "Waking up Arogya" : "Arogya is typing"}>
                  <div className="td" />
                  <div className="td" />
                  <div className="td" />
                </div>
              )}
              {waking && !streaming && (
                <p style={{ fontSize: 12, color: "#9a7c62", marginTop: 6 }}>
                  ☕ Waking Arogya up — free hosting was asleep. One moment…
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {summary && (
        <SummaryCard symptoms={symptoms} remedies={summary.remedies} doctorNote={summary.doctorNote} />
      )}

      {qrs.length > 0 && !loading && !showAreaPicker && (
        <div className="qrs">
          {qrs.map((qr) => (
            <button key={qr} className="qr" disabled={loading} onClick={() => sendMessage(qr)}>
              {qr}
            </button>
          ))}
        </div>
      )}

      <div className="ibar">
        <textarea
          ref={inputRef}
          className="tinput"
          aria-label="Type how you're feeling"
          placeholder={showAreaPicker ? "Or type the area if not listed…" : "Tell me how you're feeling…"}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = "44px";
            el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <button
          className="sbtn"
          aria-label="Send message"
          disabled={!input.trim() || loading}
          onClick={() => sendMessage()}
        >
          <span aria-hidden="true">🌼</span>
        </button>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calm Hub — Breathe · Quiet timer · Daily check-in · Progress        */
/* Local-only: everything lives in localStorage via window.VN_CALM.   */
/* ------------------------------------------------------------------ */

function BreathePanel({ calm, commit }) {
  const C = window.VN_CALM;
  const [techId, setTechId] = useState("478");
  const [custom, setCustom] = useState({ inhale: 4, inhaleHold: 0, exhale: 4, exhaleHold: 0 });
  const [durationMin, setDurationMin] = useState(3);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [display, setDisplay] = useState({ phase: "ready", left: 0, phaseSeconds: 4, elapsed: 0, cycles: 0 });
  const [doneMsg, setDoneMsg] = useState("");
  const sessRef = useRef(null);
  const elapsedRef = useRef(0);
  const calmRef = useRef(calm);
  calmRef.current = calm;

  useEffect(() => () => clearInterval(sessRef.current?.iv), []);

  const techFor = () => {
    if (techId === "custom") return { ...custom, id: "custom", name: "Custom Pattern" };
    return C.TECHNIQUES.find((t) => t.id === techId) || C.TECHNIQUES[0];
  };
  const tech = techFor();

  const finish = (elapsedSec) => {
    clearInterval(sessRef.current?.iv);
    sessRef.current = null;
    setRunning(false);
    setPaused(false);
    if (window.VN_SFX) window.VN_SFX.success();
    if (elapsedSec >= C.MIN_COUNTED_SECONDS) {
      commit(C.recordSession(calmRef.current, "breathe", elapsedSec));
      setDoneMsg(`Lovely — ${Math.round(elapsedSec / 60)} min of breathing saved to your progress. 🌼`);
    } else {
      setDoneMsg("Session ended. Even a few slow breaths count — come back anytime. 🌿");
    }
    setDisplay((d) => ({ ...d, phase: "ready", left: 0 }));
  };

  const tick = () => {
    const st = sessRef.current;
    if (!st) return;
    const now = Date.now();
    let { phaseIdx, phaseEndsAt, cycles } = st;
    while (now >= phaseEndsAt) {
      phaseIdx += 1;
      if (phaseIdx >= st.seq.length) {
        phaseIdx = 0;
        cycles += 1;
      }
      phaseEndsAt += st.seq[phaseIdx].seconds * 1000;
      if (window.VN_SFX) window.VN_SFX.bell();
    }
    st.phaseIdx = phaseIdx;
    st.phaseEndsAt = phaseEndsAt;
    st.cycles = cycles;
    const left = Math.max(0, (phaseEndsAt - now) / 1000);
    const elapsed = Math.min(st.durationSec, (now - st.startedAt) / 1000);
    elapsedRef.current = elapsed;
    setDisplay({ phase: st.seq[phaseIdx].phase, left, phaseSeconds: st.seq[phaseIdx].seconds, elapsed, cycles });
    if (now >= st.sessionEndsAt) finish(st.durationSec);
  };

  const start = () => {
    const seq = C.phaseSequence(tech);
    if (!seq.length) return;
    const now = Date.now();
    sessRef.current = {
      seq,
      phaseIdx: 0,
      phaseEndsAt: now + seq[0].seconds * 1000,
      sessionEndsAt: now + durationMin * 60000,
      durationSec: durationMin * 60,
      startedAt: now,
      cycles: 0,
    };
    elapsedRef.current = 0;
    setRunning(true);
    setPaused(false);
    setDoneMsg("");
    setDisplay({ phase: seq[0].phase, left: seq[0].seconds, phaseSeconds: seq[0].seconds, elapsed: 0, cycles: 0 });
    if (window.VN_SFX) window.VN_SFX.bell();
    sessRef.current.iv = setInterval(tick, 200);
  };

  const pause = () => {
    const st = sessRef.current;
    if (!st) return;
    clearInterval(st.iv);
    st.phaseLeftMs = Math.max(0, st.phaseEndsAt - Date.now());
    st.sessionLeftMs = Math.max(0, st.sessionEndsAt - Date.now());
    setPaused(true);
  };

  const resume = () => {
    const st = sessRef.current;
    if (!st) return;
    const now = Date.now();
    st.phaseEndsAt = now + (st.phaseLeftMs || 0);
    st.sessionEndsAt = now + (st.sessionLeftMs || 0);
    setPaused(false);
    st.iv = setInterval(tick, 200);
  };

  const stop = () => {
    const el = elapsedRef.current;
    clearInterval(sessRef.current?.iv);
    sessRef.current = null;
    setRunning(false);
    setPaused(false);
    setDisplay((d) => ({ ...d, phase: "ready", left: 0 }));
    if (el >= C.MIN_COUNTED_SECONDS) {
      commit(C.recordSession(calmRef.current, "breathe", el));
      setDoneMsg(`Saved ${Math.round(el / 60)} min of breathing to your progress. 🌼`);
    } else {
      setDoneMsg("Session stopped — no pressure, try again whenever you like. 🌿");
    }
  };

  const scale = display.phase === "inhale" || display.phase === "inhaleHold" ? 1.32 : 1;
  const progress = durationMin > 0 ? Math.min(100, (display.elapsed / (durationMin * 60)) * 100) : 0;
  const clampNum = (v, dflt) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return dflt;
    return Math.max(0, Math.min(20, n));
  };

  return (
    <div className="calm-panel">
      <div className="calm-tech-row">
        <label className="calm-lbl" htmlFor="calm-tech">
          Technique
        </label>
        <select
          id="calm-tech"
          className="calm-select"
          value={techId}
          disabled={running}
          onChange={(e) => setTechId(e.target.value)}
        >
          {C.TECHNIQUES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.inhale}-{t.inhaleHold}-{t.exhale}-{t.exhaleHold}
            </option>
          ))}
        </select>
      </div>
      <p className="calm-tech-blurb">{tech.blurb}</p>
      <p className="calm-tech-best">{tech.bestFor}</p>

      {techId === "custom" && (
        <div className="calm-custom">
          {[
            ["inhale", "Breathe in (s)"],
            ["inhaleHold", "Hold (s)"],
            ["exhale", "Breathe out (s)"],
            ["exhaleHold", "Hold (s)"],
          ].map(([key, label]) => (
            <label key={key} className="calm-num-lbl">
              {label}
              <input
                type="number"
                min="0"
                max="20"
                className="calm-num"
                value={custom[key]}
                disabled={running}
                onChange={(e) => setCustom((c) => ({ ...c, [key]: clampNum(e.target.value, c[key]) }))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="calm-dur-row" role="group" aria-label="Session length">
        <span className="calm-lbl">Session</span>
        {C.BREATHE_DURATIONS_MIN.map((m) => (
          <button
            key={m}
            className={`calm-chip${durationMin === m ? " on" : ""}`}
            disabled={running}
            onClick={() => setDurationMin(m)}
          >
            {m} min
          </button>
        ))}
      </div>

      <div className="calm-stage">
        <div
          className={`calm-circle phase-${display.phase}`}
          style={{
            transform: `scale(${running && !paused ? scale : 1})`,
            transitionDuration: running && !paused ? `${display.phaseSeconds}s` : "0.4s",
          }}
          aria-hidden="true"
        >
          <span className="calm-circle-inner">🌿</span>
        </div>
        <div className="calm-phase" role="status" aria-live="polite">
          {running ? C.PHASE_LABELS[display.phase] : doneMsg || "Ready when you are"}
        </div>
        {running && (
          <div className="calm-counts">
            <span>{Math.ceil(display.left)}s</span>
            <span aria-hidden="true">·</span>
            <span>
              {display.cycles} {display.cycles === 1 ? "breath" : "breaths"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {Math.floor(display.elapsed / 60)}:{String(Math.floor(display.elapsed % 60)).padStart(2, "0")} / {durationMin}:00
            </span>
          </div>
        )}
        <div className="calm-progress" aria-hidden="true">
          <div className="calm-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="calm-actions">
        {!running && (
          <button className="primary-btn" onClick={start}>
            Start breathing 🌼
          </button>
        )}
        {running && !paused && (
          <button className="primary-btn" onClick={pause}>
            Pause
          </button>
        )}
        {running && paused && (
          <button className="primary-btn" onClick={resume}>
            Resume
          </button>
        )}
        {running && (
          <button className="calm-ghost-btn" onClick={stop}>
            End session
          </button>
        )}
      </div>
      {doneMsg && !running && (
        <p className="calm-done" role="status">
          {doneMsg}
        </p>
      )}
    </div>
  );
}

function TimerPanel({ calm, commit }) {
  const C = window.VN_CALM;
  const [mode, setMode] = useState("countdown");
  const [presetMin, setPresetMin] = useState(10);
  const [customMin, setCustomMin] = useState("");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(0); // seconds displayed
  const [doneMsg, setDoneMsg] = useState("");
  const tRef = useRef(null);
  const elapsedRef = useRef(0);
  const calmRef = useRef(calm);
  calmRef.current = calm;

  useEffect(() => () => clearInterval(tRef.current?.iv), []);

  const totalSec = () => {
    if (mode === "stopwatch") return 0;
    const custom = parseInt(customMin, 10);
    if (!Number.isNaN(custom) && custom >= 1 && custom <= 240) return custom * 60;
    return presetMin * 60;
  };

  const finish = (elapsedSec, completed) => {
    clearInterval(tRef.current?.iv);
    tRef.current = null;
    setRunning(false);
    setPaused(false);
    if (completed && window.VN_SFX) window.VN_SFX.success();
    else if (window.VN_SFX) window.VN_SFX.bell();
    if (elapsedSec >= C.MIN_COUNTED_SECONDS) {
      commit(C.recordSession(calmRef.current, "timer", elapsedSec));
      setDoneMsg(
        completed
          ? `Beautiful — ${Math.round(elapsedSec / 60)} quiet minutes saved. 🌼`
          : `Saved ${Math.round(elapsedSec / 60)} min of quiet time to your progress. 🌿`
      );
    } else {
      setDoneMsg("Sessions of a minute or more count toward your streak. 🌿");
    }
  };

  const tick = () => {
    const st = tRef.current;
    if (!st) return;
    const now = Date.now();
    const elapsed = (now - st.startedAt) / 1000;
    elapsedRef.current = elapsed;
    if (st.mode === "countdown") {
      const left = Math.max(0, st.total - elapsed);
      setShown(left);
      if (left <= 0) finish(st.total, true);
    } else {
      setShown(elapsed);
    }
  };

  const start = () => {
    const now = Date.now();
    const total = totalSec();
    tRef.current = { mode, total, startedAt: now };
    elapsedRef.current = 0;
    setShown(mode === "countdown" ? total : 0);
    setRunning(true);
    setPaused(false);
    setDoneMsg("");
    if (window.VN_SFX) window.VN_SFX.bell();
    tRef.current.iv = setInterval(tick, 200);
  };

  const pause = () => {
    const st = tRef.current;
    if (!st) return;
    clearInterval(st.iv);
    st.pausedElapsed = elapsedRef.current;
    setPaused(true);
  };

  const resume = () => {
    const st = tRef.current;
    if (!st) return;
    st.startedAt = Date.now() - (st.pausedElapsed || 0) * 1000;
    setPaused(false);
    st.iv = setInterval(tick, 200);
  };

  const stop = () => {
    finish(elapsedRef.current, false);
  };

  const mm = Math.floor(shown / 60);
  const ss = String(Math.floor(shown % 60)).padStart(2, "0");

  return (
    <div className="calm-panel">
      <p className="calm-panel-intro">
        Sit comfortably, soften your shoulders, and just be here. A soft bell marks the start and the end.
      </p>
      <div className="calm-dur-row" role="group" aria-label="Timer mode">
        <button className={`calm-chip${mode === "countdown" ? " on" : ""}`} disabled={running} onClick={() => setMode("countdown")}>
          Countdown
        </button>
        <button className={`calm-chip${mode === "stopwatch" ? " on" : ""}`} disabled={running} onClick={() => setMode("stopwatch")}>
          Open-ended
        </button>
      </div>
      {mode === "countdown" && (
        <div className="calm-dur-row" role="group" aria-label="Timer length">
          <span className="calm-lbl">Length</span>
          {C.TIMER_PRESETS_MIN.map((m) => (
            <button
              key={m}
              className={`calm-chip${presetMin === m && !customMin ? " on" : ""}`}
              disabled={running}
              onClick={() => {
                setPresetMin(m);
                setCustomMin("");
              }}
            >
              {m} min
            </button>
          ))}
          <label className="calm-num-lbl">
            Custom (min)
            <input
              type="number"
              min="1"
              max="240"
              className="calm-num"
              value={customMin}
              disabled={running}
              placeholder="—"
              onChange={(e) => setCustomMin(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="calm-timer-readout" role="timer" aria-live="off">
        {mm}:{ss}
      </div>
      <div className="calm-actions">
        {!running && (
          <button className="primary-btn" onClick={start}>
            Start quiet time 🔔
          </button>
        )}
        {running && !paused && (
          <button className="primary-btn" onClick={pause}>
            Pause
          </button>
        )}
        {running && paused && (
          <button className="primary-btn" onClick={resume}>
            Resume
          </button>
        )}
        {running && (
          <button className="calm-ghost-btn" onClick={stop}>
            End session
          </button>
        )}
      </div>
      {doneMsg && !running && (
        <p className="calm-done" role="status">
          {doneMsg}
        </p>
      )}
    </div>
  );
}

function CheckInPanel({ calm, commit }) {
  const C = window.VN_CALM;
  const today = C.todayKey();
  const todayMood = calm.moods[today];
  const [moodId, setMoodId] = useState(todayMood?.mood || "");
  const [note, setNote] = useState(todayMood?.note || "");
  const [savedFlash, setSavedFlash] = useState(false);
  const [newHabit, setNewHabit] = useState("");
  const [newFreq, setNewFreq] = useState("daily");
  const [showArchived, setShowArchived] = useState(false);

  const saveMood = () => {
    if (!moodId) return;
    commit(C.setMood(calm, today, moodId, note));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  };

  const add = () => {
    if (!newHabit.trim()) return;
    commit(C.addHabit(calm, newHabit, newFreq));
    setNewHabit("");
  };

  const dayName = (key) => {
    const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  };

  const activeHabits = calm.habits.filter((h) => !h.archived);
  const archivedHabits = calm.habits.filter((h) => h.archived);

  return (
    <div className="calm-panel">
      <h3 className="calm-subhead">How are you feeling today?</h3>
      <div className="calm-moods" role="radiogroup" aria-label="Mood today">
        {C.MOODS.map((m) => (
          <button
            key={m.id}
            className={`calm-mood${moodId === m.id ? " on" : ""}`}
            role="radio"
            aria-checked={moodId === m.id}
            onClick={() => setMoodId(m.id)}
          >
            <span aria-hidden="true">{m.ic}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <textarea
        className="calm-note"
        aria-label="A few words about today (optional)"
        placeholder="A few words about today, if you'd like… (stays on this device)"
        value={note}
        rows={2}
        maxLength={280}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="calm-actions">
        <button className="primary-btn" disabled={!moodId} onClick={saveMood}>
          {savedFlash ? "✓ Saved — thank you" : "Save today's check-in"}
        </button>
      </div>

      <div className="calm-strip" aria-label="Mood over the last 7 days">
        {C.moodStrip(calm).map((d) => {
          const meta = C.MOODS.find((m) => m.id === d.entry?.mood);
          return (
            <div key={d.date} className="calm-strip-day" title={d.entry ? `${d.date}: ${meta?.label || ""}` : d.date}>
              <span className="calm-strip-ic" aria-hidden="true">
                {meta ? meta.ic : "·"}
              </span>
              <span className="calm-strip-lbl">{d.date === today ? "Today" : dayName(d.date)}</span>
            </div>
          );
        })}
      </div>

      <h3 className="calm-subhead">Gentle habits</h3>
      <p className="calm-hint">
        Small, repeatable, kind. Skip a day without guilt — a skip pauses your streak, it never punishes it.
      </p>
      <div className="calm-addhabit">
        <input
          className="calm-input"
          aria-label="New habit name"
          placeholder="e.g. Drink a glass of water"
          value={newHabit}
          maxLength={80}
          onChange={(e) => setNewHabit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <select className="calm-select" aria-label="How often" value={newFreq} onChange={(e) => setNewFreq(e.target.value)}>
          {C.FREQUENCIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button className="primary-btn" disabled={!newHabit.trim()} onClick={add}>
          Add habit
        </button>
      </div>

      {activeHabits.length === 0 && (
        <p className="calm-empty">No habits yet. Try one: “Step outside for 5 minutes”, “Stretch before bed”, “One glass of water”.</p>
      )}
      <div className="calm-habits">
        {activeHabits.map((h) => {
          const log = calm.logs[h.id] || {};
          const stats = C.habitStats(h, log);
          const entry = log[today];
          const freq = C.frequencyFor(h);
          return (
            <div className="calm-habit" key={h.id}>
              <div className="calm-habit-top">
                <div>
                  <strong>{h.name}</strong>
                  <span className="calm-habit-meta">
                    {freq.label} · 🔥 {stats.streak}-day streak · best {stats.bestStreak}
                  </span>
                </div>
                <button
                  className="calm-mini"
                  aria-label={`Archive habit ${h.name}`}
                  onClick={() => commit(C.setHabitArchived(calm, h.id, true))}
                >
                  Archive
                </button>
              </div>
              <div className="calm-strength" aria-label={`Habit strength ${Math.round(stats.strength * 100)} percent`}>
                <div className="calm-strength-fill" style={{ width: `${Math.round(stats.strength * 100)}%` }} />
              </div>
              <div className="calm-habit-week">
                This week: {stats.weekDone} / {stats.weekTarget}
              </div>
              <div className="calm-habit-actions">
                {entry ? (
                  <>
                    <span className="calm-entry-state">{entry === "done" ? "✓ Done today" : "⏭ Skipped today"}</span>
                    <button className="calm-mini" onClick={() => commit(C.clearHabitLog(calm, h.id, today))}>
                      Undo
                    </button>
                  </>
                ) : (
                  <>
                    <button className="calm-done-btn" onClick={() => commit(C.logHabit(calm, h.id, today, "done"))}>
                      ✓ Done
                    </button>
                    <button className="calm-skip-btn" onClick={() => commit(C.logHabit(calm, h.id, today, "skip"))}>
                      Skip today
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {archivedHabits.length > 0 && (
        <div className="calm-archived">
          <button className="linklike" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived habits" : `Show ${archivedHabits.length} archived habit(s)`}
          </button>
          {showArchived &&
            archivedHabits.map((h) => (
              <div className="calm-habit archived" key={h.id}>
                <strong>{h.name}</strong>
                <button className="calm-mini" onClick={() => commit(C.setHabitArchived(calm, h.id, false))}>
                  Restore
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ProgressPanel({ calm }) {
  const C = window.VN_CALM;
  const streak = C.calmStreak(calm);
  const cons = C.consistency(calm);
  const t = C.totals(calm);
  const fmtMin = (sec) => {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)} min`;
    return `${(sec / 3600).toFixed(1)} hr`;
  };
  return (
    <div className="calm-panel">
      <div className="calm-stats-grid">
        <div className="calm-stat">
          <div className="calm-stat-big">🔥 {streak}</div>
          <div className="calm-stat-lbl">{streak === 1 ? "calm day in a row" : "calm days in a row"}</div>
          <p className="calm-stat-note">Any check-in, habit, or 1-minute session counts.</p>
        </div>
        <div className="calm-stat">
          <div className="calm-stat-big">🧊 {calm.freezesRemaining} / {C.MAX_FREEZES}</div>
          <div className="calm-stat-lbl">streak freezes left</div>
          <p className="calm-stat-note">A missed day uses a freeze instead of breaking your streak. Refills monthly.</p>
        </div>
        <div className="calm-stat">
          <div className="calm-stat-big">{Math.round(cons * 100)}%</div>
          <div className="calm-stat-lbl">consistency · last 30 days</div>
          <div className="calm-strength" aria-hidden="true">
            <div className="calm-strength-fill" style={{ width: `${Math.round(cons * 100)}%` }} />
          </div>
          <p className="calm-stat-note">Steady beats perfect — a gentle measure for imperfect weeks.</p>
        </div>
        <div className="calm-stat">
          <div className="calm-stat-big">{t.sessions}</div>
          <div className="calm-stat-lbl">mindful sessions</div>
          <p className="calm-stat-note">
            {fmtMin(t.breatheSec)} breathing · {fmtMin(t.timerSec)} quiet time
          </p>
        </div>
      </div>
      <h3 className="calm-subhead">Habit strength</h3>
      {calm.habits.filter((h) => !h.archived).length === 0 && (
        <p className="calm-empty">Add a habit in Check-in and it will grow here, one kind day at a time.</p>
      )}
      {calm.habits
        .filter((h) => !h.archived)
        .map((h) => {
          const stats = C.habitStats(h, calm.logs[h.id] || {});
          return (
            <div className="calm-habit" key={h.id}>
              <div className="calm-habit-top">
                <strong>{h.name}</strong>
                <span className="calm-habit-meta">
                  {Math.round(stats.strength * 100)}% · 🔥 {stats.streak} · best {stats.bestStreak}
                </span>
              </div>
              <div className="calm-strength" aria-hidden="true">
                <div className="calm-strength-fill" style={{ width: `${Math.round(stats.strength * 100)}%` }} />
              </div>
            </div>
          );
        })}
      <p className="calm-foot-note">
        Everything on this page lives only on your device. Clearing this site's data erases it — nothing is ever uploaded.
      </p>
    </div>
  );
}

function CalmHub({ onBack }) {
  const C = window.VN_CALM;
  const [calm, setCalm] = useState(() => C.load());
  const [tab, setTab] = useState("breathe");

  const commit = useCallback(
    (next) => {
      const settled = C.settle(next);
      C.save(settled);
      setCalm(settled);
    },
    [C]
  );

  const tabs = [
    { id: "breathe", label: "🫁 Breathe" },
    { id: "timer", label: "🔔 Quiet timer" },
    { id: "checkin", label: "💛 Check-in" },
    { id: "progress", label: "🌱 Progress" },
  ];

  return (
    <div className="calm">
      <header className="chat-head">
        <div className="av" aria-hidden="true">
          🧘
        </div>
        <div className="hinfo">
          <h2>Calm Hub</h2>
          <span>
            <span className="odot" aria-hidden="true" />
            Breathe · check in · grow gently
          </span>
        </div>
        <button className="new-btn" onClick={onBack} aria-label="Back">
          ← Back
        </button>
      </header>
      <div className="calm-tabs" role="tablist" aria-label="Calm Hub sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`calm-tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="calm-body">
        {tab === "breathe" && <BreathePanel calm={calm} commit={commit} />}
        {tab === "timer" && <TimerPanel calm={calm} commit={commit} />}
        {tab === "checkin" && <CheckInPanel calm={calm} commit={commit} />}
        {tab === "progress" && <ProgressPanel calm={calm} />}
      </div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("disclaimer");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [chatKey, setChatKey] = useState(0);
  const [starter, setStarter] = useState("");
  const [calmFrom, setCalmFrom] = useState("welcome");

  useEffect(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      // Small delay so the brand moment actually paints.
      const t = setTimeout(() => {
        splash.classList.add("hide");
        setTimeout(() => splash.remove(), 450);
      }, 900);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const goToChat = useCallback((starterMsg) => {
    setChatKey((k) => k + 1);
    setStarter(typeof starterMsg === "string" ? starterMsg : "");
    setScreen("chat");
  }, []);

  const openCalm = useCallback((from) => {
    setCalmFrom(from || "welcome");
    setScreen("calm");
  }, []);

  return (
    <div className="app">
      {showCrisis && <CrisisScreen onBack={() => setShowCrisis(false)} />}
      {!isOnline && screen !== "disclaimer" && <OfflineScreen />}
      {screen === "disclaimer" && (
        <DisclaimerScreen onAccept={() => setScreen("welcome")} onShowPrivacy={() => setShowPrivacy(true)} />
      )}
      {screen === "welcome" && isOnline && (
        <WelcomeScreen
          onStart={goToChat}
          onShowPrivacy={() => setShowPrivacy(true)}
          onOpenCalm={() => openCalm("welcome")}
        />
      )}
      {screen === "chat" && isOnline && (
        <ChatScreen
          key={chatKey}
          starter={starter}
          onReset={() => setScreen("welcome")}
          onCrisis={() => setShowCrisis(true)}
          onOpenCalm={() => openCalm("chat")}
        />
      )}
      {screen === "calm" && <CalmHub onBack={() => setScreen(calmFrom)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

const rootElement = document.getElementById("root");
const root = ReactDOM.createRoot(rootElement);
root.render(<App />);
