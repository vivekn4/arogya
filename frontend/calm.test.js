/* Calm Hub logic tests — run with: node --test frontend/calm.test.js
   No dependencies. calm.js is loaded into a vm sandbox so the same file
   the browser loads is what gets tested. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCalm(store) {
  const sandbox = {
    localStorage: store || {
      _m: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
      setItem(k, v) { this._m[k] = String(v); },
    },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "calm.js"), "utf8"), sandbox);
  return sandbox.VN_CALM;
}

const CALM = loadCalm();

describe("phaseSequence", () => {
  it("skips zero-length phases", () => {
    const seq = CALM.phaseSequence({ inhale: 4, inhaleHold: 0, exhale: 6, exhaleHold: 0 });
    // JSON comparison: calm.js runs in a vm realm, so prototypes differ.
    assert.equal(JSON.stringify(seq), JSON.stringify([
      { phase: "inhale", seconds: 4 },
      { phase: "exhale", seconds: 6 },
    ]));
  });
  it("keeps all four phases when all are positive", () => {
    const seq = CALM.phaseSequence({ inhale: 4, inhaleHold: 4, exhale: 4, exhaleHold: 4 });
    assert.equal(seq.length, 4);
    assert.equal(CALM.cycleSeconds({ inhale: 4, inhaleHold: 4, exhale: 4, exhaleHold: 4 }), 16);
  });
});

describe("smoothStrength", () => {
  it("done pulls toward 1, missed toward 0, skip is neutral", () => {
    assert.ok(CALM.smoothStrength(0.5, "done") > 0.5);
    assert.ok(CALM.smoothStrength(0.5, "missed") < 0.5);
    assert.equal(CALM.smoothStrength(0.5, "skip"), 0.5);
  });
  it("a few misses barely dent a long-built score", () => {
    let s = 0.5;
    for (let i = 0; i < 30; i++) s = CALM.smoothStrength(s, "done");
    const before = s;
    for (let i = 0; i < 3; i++) s = CALM.smoothStrength(s, "missed");
    assert.ok(s > 0.5, `score ${s} should stay above neutral after 3 misses (was ${before})`);
    assert.ok(s < before);
  });
});

describe("habitStats", () => {
  it("counts streaks, skips pause without breaking", () => {
    const habit = { id: "h1", name: "Drink water", freqId: "daily", createdAt: "2026-10-01", archived: false, strength: 0.5 };
    const log = {
      "2026-10-01": "done",
      "2026-10-02": "done",
      "2026-10-03": "skip",
      "2026-10-04": "done",
    };
    const st = CALM.habitStats(habit, log, "2026-10-04");
    assert.equal(st.streak, 3); // 01, 02 done; 03 skip bridges; 04 done
    assert.equal(st.bestStreak, 3);
    assert.ok(st.strength > 0.5);
  });
  it("a missed past day breaks the streak", () => {
    const habit = { id: "h1", name: "Walk", freqId: "daily", createdAt: "2026-10-01", archived: false, strength: 0.5 };
    const log = { "2026-10-01": "done", "2026-10-02": "done", "2026-10-04": "done" };
    const st = CALM.habitStats(habit, log, "2026-10-04");
    assert.equal(st.streak, 1); // 10-03 missed
    assert.equal(st.bestStreak, 2);
  });
  it("today undecided never breaks the streak", () => {
    const habit = { id: "h1", name: "Walk", freqId: "daily", createdAt: "2026-10-01", archived: false, strength: 0.5 };
    const log = { "2026-10-01": "done", "2026-10-02": "done" };
    const st = CALM.habitStats(habit, log, "2026-10-03");
    assert.equal(st.streak, 2);
  });
  it("week progress counts Mon–Sun done vs target", () => {
    const habit = { id: "h1", name: "Gym", freqId: "3x", createdAt: "2026-10-05", archived: false, strength: 0.5 };
    // 2026-10-05 is a Monday; 10-08 is Thursday of the same week.
    const log = { "2026-10-05": "done", "2026-10-07": "done" };
    const st = CALM.habitStats(habit, log, "2026-10-08");
    assert.equal(st.weekDone, 2);
    assert.equal(st.weekTarget, 3);
  });
});

describe("freezes + calm streak", () => {
  it("a missed day spends a freeze instead of breaking the streak", () => {
    let s = CALM.defaultState(new Date(2026, 9, 10));
    s = CALM.setMood(s, "2026-10-08", "good", "");
    s = CALM.setMood(s, "2026-10-10", "good", "");
    // 10-09 is missed; settling should freeze it.
    s = CALM.settle(s, new Date(2026, 9, 10));
    assert.equal(s.freezesRemaining, 1);
    assert.equal(JSON.stringify(s.frozenDays), JSON.stringify(["2026-10-09"]));
    assert.equal(CALM.calmStreak(s, new Date(2026, 9, 10)), 2);
  });
  it("settling is idempotent — no double freeze charges", () => {
    let s = CALM.defaultState(new Date(2026, 9, 10));
    s = CALM.setMood(s, "2026-10-08", "good", "");
    s = CALM.settle(s, new Date(2026, 9, 10));
    const once = s.freezesRemaining;
    s = CALM.settle(s, new Date(2026, 9, 10));
    assert.equal(s.freezesRemaining, once);
  });
  it("freezes refill on month change", () => {
    let s = CALM.defaultState(new Date(2026, 8, 15));
    s = Object.assign({}, s, { freezesRemaining: 0, freezeRefillMonth: "2026-09" });
    s = CALM.settle(s, new Date(2026, 9, 1));
    // Refill restores 2; settling then spends one on missed 2026-09-30.
    assert.equal(s.freezesRemaining, 1);
    assert.equal(s.freezeRefillMonth, "2026-10");
    assert.equal(JSON.stringify(s.frozenDays), JSON.stringify(["2026-09-30"]));
  });
  it("streak breaks when freezes run out", () => {
    let s = CALM.defaultState(new Date(2026, 9, 10));
    s = Object.assign({}, s, { freezesRemaining: 0, frozenDays: [] });
    s = CALM.setMood(s, "2026-10-08", "good", "");
    s = CALM.settle(s, new Date(2026, 9, 10));
    assert.equal(CALM.calmStreak(s, new Date(2026, 9, 10)), 0);
  });
});

describe("sessions + consistency", () => {
  it("sessions under 60s do not count", () => {
    let s = CALM.defaultState(new Date(2026, 9, 10));
    s = CALM.recordSession(s, "breathe", 45, "2026-10-10", new Date(2026, 9, 10));
    assert.equal(CALM.totals(s).sessions, 0);
    s = CALM.recordSession(s, "breathe", 90, "2026-10-10", new Date(2026, 9, 10));
    assert.equal(CALM.totals(s).sessions, 1);
    assert.equal(CALM.totals(s).breatheSec, 90);
  });
  it("consistency is active days / window", () => {
    let s = CALM.defaultState(new Date(2026, 9, 10));
    s = CALM.setMood(s, "2026-10-10", "good", "");
    s = CALM.setMood(s, "2026-10-09", "okay", "");
    assert.equal(CALM.consistency(s, new Date(2026, 9, 10), 10), 0.2);
  });
});

describe("persistence", () => {
  it("save/load round-trips through localStorage", () => {
    const store = {
      _m: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
      setItem(k, v) { this._m[k] = String(v); },
    };
    const api = loadCalm(store);
    let s = api.load();
    s = api.addHabit(s, "Drink water", "daily", new Date(2026, 9, 10));
    api.save(s);
    const s2 = api.load();
    assert.equal(s2.habits.length, 1);
    assert.equal(s2.habits[0].name, "Drink water");
  });
  it("corrupt storage falls back to a fresh state, never throws", () => {
    const store = {
      getItem() { return "{not json"; },
      setItem() {},
    };
    const api = loadCalm(store);
    const s = api.load();
    assert.equal(s.habits.length, 0);
  });
});
