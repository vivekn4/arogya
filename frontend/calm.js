/* ==========================================================================
   Arogya — Calm Hub data + logic layer
   Crafted by Vivek Nair (VN) — https://github.com/vivekn4
   --------------------------------------------------------------------------
   Framework-free. The React UI in app.js reads/writes through window.VN_CALM.
   Everything here is local-only: habits, moods and sessions live in
   localStorage on the user's own device and are NEVER sent to the backend.

   Mechanisms (re-implemented in original code after studying similar apps):
   - Breathing technique table: named patterns as (inhale, inhale-hold,
     exhale, exhale-hold) seconds + a phase state machine that skips
     zero-length phases. (Common pattern in breathing-timer apps.)
   - Habit strength: exponential smoothing toward each day's outcome — a done
     day pulls the score toward 1, a missed day toward 0, a skipped day
     leaves it untouched. A few misses after a long run barely dent it.
   - Calm streak with streak freezes: a missed day consumes one of 2 monthly
     freezes instead of breaking the streak; freezes refill on the 1st.
   - Consistency score: share of active days over the last 30 days — a
     forgiving alternative to a raw streak.
   - Quiet timer: one-tap countdown presets + stopwatch; only sessions of
     60s+ count toward stats.
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "vn_arogya_calm_v1";
  var MAX_FREEZES = 2;
  var MIN_COUNTED_SECONDS = 60;
  var STRENGTH_RATE = 0.18;
  var INITIAL_STRENGTH = 0.5;

  /* ---------------- Techniques (original copy, standard patterns) -------- */

  var TECHNIQUES = [
    {
      id: "478",
      name: "4-7-8 Calm",
      inhale: 4, inhaleHold: 7, exhale: 8, exhaleHold: 0,
      blurb: "A long exhale tells your body the danger has passed. Lovely before sleep.",
      bestFor: "Winding down · sleep · anxious moments",
    },
    {
      id: "box",
      name: "Box Breathing",
      inhale: 4, inhaleHold: 4, exhale: 4, exhaleHold: 4,
      blurb: "Four equal sides, four equal counts. Steady and grounding.",
      bestFor: "Focus · before a hard conversation",
    },
    {
      id: "coherent",
      name: "Coherent Breathing",
      inhale: 5, inhaleHold: 0, exhale: 5, exhaleHold: 0,
      blurb: "Five seconds in, five out — about six breaths a minute, nice and even.",
      bestFor: "Daily practice · steady mood",
    },
    {
      id: "extended",
      name: "Extended Exhale",
      inhale: 4, inhaleHold: 0, exhale: 8, exhaleHold: 0,
      blurb: "Breathe out for twice as long as you breathe in. Pure exhale-side calm.",
      bestFor: "Stress relief · slowing a racing heart",
    },
    {
      id: "triangle",
      name: "Triangle Breathing",
      inhale: 4, inhaleHold: 4, exhale: 4, exhaleHold: 0,
      blurb: "In, hold, out — no second hold. The gentlest place to start.",
      bestFor: "Beginners · quick resets",
    },
    {
      id: "custom",
      name: "Custom Pattern",
      inhale: 4, inhaleHold: 0, exhale: 4, exhaleHold: 0,
      blurb: "Set your own counts. Keep holds at zero if holds feel uncomfortable.",
      bestFor: "Your own rhythm",
    },
  ];

  var TIMER_PRESETS_MIN = [3, 5, 10, 15, 20];
  var BREATHE_DURATIONS_MIN = [1, 3, 5, 10];

  var MOODS = [
    { id: "struggling", ic: "😖", label: "Struggling" },
    { id: "low", ic: "😔", label: "Low" },
    { id: "okay", ic: "😐", label: "Okay" },
    { id: "good", ic: "🙂", label: "Good" },
    { id: "great", ic: "😄", label: "Great" },
  ];

  var FREQUENCIES = [
    { id: "daily", num: 1, den: 1, label: "Every day" },
    { id: "5x", num: 5, den: 7, label: "5 times a week" },
    { id: "3x", num: 3, den: 7, label: "3 times a week" },
    { id: "2x", num: 2, den: 7, label: "2 times a week" },
    { id: "weekly", num: 1, den: 7, label: "Once a week" },
  ];

  /* ---------------- Dates (local calendar days, YYYY-MM-DD) --------------- */

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function todayKey(d) {
    var t = d || new Date();
    return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
  }

  function monthKey(d) {
    var t = d || new Date();
    return t.getFullYear() + "-" + pad(t.getMonth() + 1);
  }

  function parseKey(key) {
    var parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function shiftKey(key, days) {
    var d = parseKey(key);
    d.setDate(d.getDate() + days);
    return todayKey(d);
  }

  function weekStartKey(key) {
    // Monday-start week containing `key`.
    var d = parseKey(key);
    var dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - dow);
    return todayKey(d);
  }

  /* ---------------- Breathing phase machine ------------------------------ */

  // Expand a technique into its ordered phases, dropping zero-length ones.
  // A hold of 0 simply means that phase never runs.
  function phaseSequence(tech) {
    var seq = [];
    if (tech.inhale > 0) seq.push({ phase: "inhale", seconds: tech.inhale });
    if (tech.inhaleHold > 0) seq.push({ phase: "inhaleHold", seconds: tech.inhaleHold });
    if (tech.exhale > 0) seq.push({ phase: "exhale", seconds: tech.exhale });
    if (tech.exhaleHold > 0) seq.push({ phase: "exhaleHold", seconds: tech.exhaleHold });
    return seq;
  }

  function cycleSeconds(tech) {
    return phaseSequence(tech).reduce(function (sum, p) {
      return sum + p.seconds;
    }, 0);
  }

  var PHASE_LABELS = {
    inhale: "Breathe in…",
    inhaleHold: "Hold…",
    exhale: "Breathe out…",
    exhaleHold: "Hold…",
    ready: "Ready",
  };

  /* ---------------- Habit strength (exponential smoothing) ---------------- */

  // outcome: "done" | "missed" | "skip". Skip leaves the score untouched.
  function smoothStrength(prev, outcome) {
    if (outcome === "skip") return prev;
    var target = outcome === "done" ? 1 : 0;
    var next = prev + STRENGTH_RATE * (target - prev);
    if (next < 0) return 0;
    if (next > 1) return 1;
    return next;
  }

  /* ---------------- State ------------------------------------------------- */

  function defaultState(now) {
    var d = now || new Date();
    return {
      version: 1,
      habits: [], // {id, name, freqId, createdAt, archived, strength}
      logs: {}, // habitId -> { dateKey: "done" | "skip" }
      moods: {}, // dateKey -> { mood, note }
      sessions: [], // { type: "breathe"|"timer", seconds, date, at }
      frozenDays: [], // dateKeys where a streak freeze was spent
      freezesRemaining: MAX_FREEZES,
      freezeRefillMonth: monthKey(d),
      settledThrough: null, // last dateKey freeze-settling ran through
    };
  }

  function sanitize(state) {
    var s = defaultState();
    if (!state || typeof state !== "object") return s;
    if (Array.isArray(state.habits)) {
      s.habits = state.habits
        .filter(function (h) {
          return h && typeof h.id === "string" && typeof h.name === "string";
        })
        .map(function (h) {
          return {
            id: h.id,
            name: String(h.name).slice(0, 80),
            freqId: typeof h.freqId === "string" ? h.freqId : "daily",
            createdAt: typeof h.createdAt === "string" ? h.createdAt : todayKey(),
            archived: !!h.archived,
            strength: typeof h.strength === "number" ? h.strength : INITIAL_STRENGTH,
          };
        });
    }
    if (state.logs && typeof state.logs === "object") s.logs = state.logs;
    if (state.moods && typeof state.moods === "object") s.moods = state.moods;
    if (Array.isArray(state.sessions)) {
      s.sessions = state.sessions.filter(function (x) {
        return x && typeof x.date === "string" && typeof x.seconds === "number";
      });
    }
    if (Array.isArray(state.frozenDays)) s.frozenDays = state.frozenDays.filter(Boolean);
    if (typeof state.freezesRemaining === "number") {
      s.freezesRemaining = Math.max(0, Math.min(MAX_FREEZES, state.freezesRemaining));
    }
    if (typeof state.freezeRefillMonth === "string") s.freezeRefillMonth = state.freezeRefillMonth;
    if (typeof state.settledThrough === "string") s.settledThrough = state.settledThrough;
    return s;
  }

  function load(storage) {
    var store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var state = defaultState();
    if (store) {
      try {
        var raw = store.getItem(STORAGE_KEY);
        if (raw) state = sanitize(JSON.parse(raw));
      } catch (e) {
        state = defaultState();
      }
    }
    return settle(state);
  }

  function save(state, storage) {
    var store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full / unavailable — calm features stay in-memory */
    }
  }

  /* ---------------- Activity days, freezes, streak ---------------------- */

  function activityDays(state) {
    var days = {};
    Object.keys(state.moods || {}).forEach(function (k) {
      days[k] = true;
    });
    (state.sessions || []).forEach(function (s) {
      if (s.seconds >= MIN_COUNTED_SECONDS) days[s.date] = true;
    });
    Object.keys(state.logs || {}).forEach(function (hid) {
      Object.keys(state.logs[hid] || {}).forEach(function (k) {
        if (state.logs[hid][k] === "done") days[k] = true;
      });
    });
    return days;
  }

  // Walk back over past days: a missed day spends a freeze if one is left.
  // Idempotent — already-frozen days are never charged twice.
  function settle(state, now) {
    var d = now || new Date();
    var today = todayKey(d);
    var s = state;
    // Monthly refill (1st of the month, checked lazily).
    if (s.freezeRefillMonth !== monthKey(d)) {
      s = Object.assign({}, s, { freezesRemaining: MAX_FREEZES, freezeRefillMonth: monthKey(d) });
    }
    var active = activityDays(s);
    var frozen = {};
    (s.frozenDays || []).forEach(function (k) {
      frozen[k] = true;
    });
    var remaining = s.freezesRemaining;
    var cursor = shiftKey(today, -1); // never settle "today" — the day isn't over
    // First run: only yesterday is eligible. After that, only days since the
    // last settle — freezes must never be spent on ancient history.
    var start = s.settledThrough ? shiftKey(s.settledThrough, 1) : cursor;
    // Settle oldest-first so freezes are spent on the earliest gaps.
    var day = start;
    var changed = false;
    var spent = [];
    while (day <= cursor) {
      if (!active[day] && !frozen[day] && remaining > 0) {
        frozen[day] = true;
        spent.push(day);
        remaining -= 1;
        changed = true;
      }
      day = shiftKey(day, 1);
    }
    if (!changed && s.settledThrough === cursor && s.freezesRemaining === remaining) return s;
    return Object.assign({}, s, {
      frozenDays: (s.frozenDays || []).concat(spent),
      freezesRemaining: remaining,
      settledThrough: cursor,
    });
  }

  function calmStreak(state, now) {
    var today = todayKey(now || new Date());
    var active = activityDays(state);
    var frozen = {};
    (state.frozenDays || []).forEach(function (k) {
      frozen[k] = true;
    });
    var streak = 0;
    var day = today;
    // Today without activity yet doesn't break the streak — the day is open.
    if (!active[day] && !frozen[day]) day = shiftKey(day, -1);
    while (active[day] || frozen[day]) {
      if (active[day]) streak += 1;
      day = shiftKey(day, -1);
      if (streak > 366) break;
    }
    return streak;
  }

  function consistency(state, now, windowDays) {
    var today = todayKey(now || new Date());
    var active = activityDays(state);
    var n = windowDays || 30;
    var hit = 0;
    for (var i = 0; i < n; i++) {
      if (active[shiftKey(today, -i)]) hit += 1;
    }
    return n === 0 ? 0 : hit / n;
  }

  function totals(state) {
    var breatheSec = 0;
    var timerSec = 0;
    var sessions = 0;
    (state.sessions || []).forEach(function (s) {
      if (s.seconds < MIN_COUNTED_SECONDS) return;
      sessions += 1;
      if (s.type === "breathe") breatheSec += s.seconds;
      else if (s.type === "timer") timerSec += s.seconds;
    });
    return { breatheSec: breatheSec, timerSec: timerSec, sessions: sessions };
  }

  /* ---------------- Habits ------------------------------------------------- */

  function frequencyFor(habit) {
    for (var i = 0; i < FREQUENCIES.length; i++) {
      if (FREQUENCIES[i].id === habit.freqId) return FREQUENCIES[i];
    }
    return FREQUENCIES[0];
  }

  function newHabitId() {
    return "h" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function addHabit(state, name, freqId, now) {
    var clean = String(name || "").trim().slice(0, 80);
    if (!clean) return state;
    var habit = {
      id: newHabitId(),
      name: clean,
      freqId: freqId || "daily",
      createdAt: todayKey(now || new Date()),
      archived: false,
      strength: INITIAL_STRENGTH,
    };
    return Object.assign({}, state, { habits: state.habits.concat([habit]) });
  }

  function setHabitArchived(state, habitId, archived) {
    return Object.assign({}, state, {
      habits: state.habits.map(function (h) {
        return h.id === habitId ? Object.assign({}, h, { archived: archived }) : h;
      }),
    });
  }

  function logHabit(state, habitId, dateKey, outcome) {
    if (outcome !== "done" && outcome !== "skip") return state;
    var logs = Object.assign({}, state.logs);
    var per = Object.assign({}, logs[habitId] || {});
    per[dateKey] = outcome;
    logs[habitId] = per;
    // Recompute strength from scratch so it can never drift.
    var next = Object.assign({}, state, { logs: logs });
    var habit = next.habits.filter(function (h) {
      return h.id === habitId;
    })[0];
    if (habit) {
      var stats = habitStats(habit, next.logs[habitId] || {});
      next = Object.assign({}, next, {
        habits: next.habits.map(function (h) {
          return h.id === habitId ? Object.assign({}, h, { strength: stats.strength }) : h;
        }),
      });
    }
    return next;
  }

  function clearHabitLog(state, habitId, dateKey) {
    var logs = Object.assign({}, state.logs);
    var per = Object.assign({}, logs[habitId] || {});
    delete per[dateKey];
    logs[habitId] = per;
    var next = Object.assign({}, state, { logs: logs });
    var habit = next.habits.filter(function (h) {
      return h.id === habitId;
    })[0];
    if (habit) {
      var stats = habitStats(habit, next.logs[habitId] || {});
      next = Object.assign({}, next, {
        habits: next.habits.map(function (h) {
          return h.id === habitId ? Object.assign({}, h, { strength: stats.strength }) : h;
        }),
      });
    }
    return next;
  }

  // Streak: consecutive days with "done"; "skip" pauses without breaking;
  // a past day with no entry breaks it. Today undecided never breaks.
  // Strength: replayed from creation with the smoothing rule.
  function habitStats(habit, log, throughKey) {
    var through = throughKey || todayKey();
    var strength = INITIAL_STRENGTH;
    var streak = 0;
    var best = 0;
    var run = 0;
    var day = habit.createdAt;
    var guard = 0;
    while (day <= through && guard++ < 1200) {
      var entry = log[day];
      var isToday = day === through;
      if (entry === "done") {
        strength = smoothStrength(strength, "done");
        run += 1;
        if (run > best) best = run;
      } else if (entry === "skip") {
        strength = smoothStrength(strength, "skip");
        // neutral: run pauses, neither grows nor breaks
      } else if (isToday) {
        // undecided — changes nothing
      } else {
        strength = smoothStrength(strength, "missed");
        run = 0;
      }
      day = shiftKey(day, 1);
    }
    // Current streak = trailing run, but a trailing "skip" tail must not
    // count as progress: walk back from `through` counting only "done",
    // stepping over "skip" and undecided-today.
    streak = 0;
    day = through;
    guard = 0;
    while (guard++ < 1200) {
      var e = log[day];
      if (e === "done") {
        streak += 1;
        day = shiftKey(day, -1);
      } else if (e === "skip" || day === through) {
        day = shiftKey(day, -1);
      } else {
        break;
      }
      if (day < habit.createdAt) break;
    }
    // This week's done-count vs target (Monday-start week).
    var freq = frequencyFor(habit);
    var weekDone = 0;
    var ws = weekStartKey(through);
    for (var i = 0; i < 7; i++) {
      if (log[shiftKey(ws, i)] === "done") weekDone += 1;
    }
    return {
      strength: strength,
      streak: streak,
      bestStreak: best,
      weekDone: weekDone,
      weekTarget: freq.num,
      weekDen: freq.den,
    };
  }

  /* ---------------- Moods + sessions -------------------------------------- */

  function setMood(state, dateKey, moodId, note) {
    var moods = Object.assign({}, state.moods);
    moods[dateKey] = { mood: moodId, note: String(note || "").slice(0, 280) };
    return Object.assign({}, state, { moods: moods });
  }

  function recordSession(state, type, seconds, dateKey, now) {
    if (typeof seconds !== "number" || seconds < MIN_COUNTED_SECONDS) return state;
    var entry = {
      type: type,
      seconds: Math.round(seconds),
      date: dateKey || todayKey(now || new Date()),
      at: (now || new Date()).toISOString(),
    };
    return Object.assign({}, state, { sessions: state.sessions.concat([entry]) });
  }

  function moodStrip(state, now) {
    var today = todayKey(now || new Date());
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var key = shiftKey(today, -i);
      out.push({ date: key, entry: state.moods[key] || null });
    }
    return out;
  }

  var api = {
    TECHNIQUES: TECHNIQUES,
    TIMER_PRESETS_MIN: TIMER_PRESETS_MIN,
    BREATHE_DURATIONS_MIN: BREATHE_DURATIONS_MIN,
    MOODS: MOODS,
    FREQUENCIES: FREQUENCIES,
    PHASE_LABELS: PHASE_LABELS,
    MAX_FREEZES: MAX_FREEZES,
    MIN_COUNTED_SECONDS: MIN_COUNTED_SECONDS,
    STORAGE_KEY: STORAGE_KEY,
    todayKey: todayKey,
    monthKey: monthKey,
    shiftKey: shiftKey,
    weekStartKey: weekStartKey,
    phaseSequence: phaseSequence,
    cycleSeconds: cycleSeconds,
    smoothStrength: smoothStrength,
    defaultState: defaultState,
    load: load,
    save: save,
    settle: settle,
    activityDays: activityDays,
    calmStreak: calmStreak,
    consistency: consistency,
    totals: totals,
    frequencyFor: frequencyFor,
    addHabit: addHabit,
    setHabitArchived: setHabitArchived,
    logHabit: logHabit,
    clearHabitLog: clearHabitLog,
    habitStats: habitStats,
    setMood: setMood,
    recordSession: recordSession,
    moodStrip: moodStrip,
  };

  if (typeof window !== "undefined") window.VN_CALM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
