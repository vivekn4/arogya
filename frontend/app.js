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

function WelcomeScreen({ onStart, onShowPrivacy }) {
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

function ChatScreen({ starter, onReset, onCrisis }) {
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

function App() {
  const [screen, setScreen] = useState("disclaimer");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [chatKey, setChatKey] = useState(0);
  const [starter, setStarter] = useState("");

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

  return (
    <div className="app">
      {showCrisis && <CrisisScreen onBack={() => setShowCrisis(false)} />}
      {!isOnline && screen !== "disclaimer" && <OfflineScreen />}
      {screen === "disclaimer" && (
        <DisclaimerScreen onAccept={() => setScreen("welcome")} onShowPrivacy={() => setShowPrivacy(true)} />
      )}
      {screen === "welcome" && isOnline && (
        <WelcomeScreen onStart={goToChat} onShowPrivacy={() => setShowPrivacy(true)} />
      )}
      {screen === "chat" && isOnline && (
        <ChatScreen
          key={chatKey}
          starter={starter}
          onReset={() => setScreen("welcome")}
          onCrisis={() => setShowCrisis(true)}
        />
      )}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

const rootElement = document.getElementById("root");
const root = ReactDOM.createRoot(rootElement);
root.render(<App />);
