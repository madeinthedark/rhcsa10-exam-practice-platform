/* progress.js — localStorage progress store
   Stores self-grading (correct/partial/wrong) and mock exam results (recordExam).
   Mock exams are also stored via the same recordExam even in VM batch-grading mode;
   results[].source ("vm-auto"/"vm-error"/"self") and results[].vmGrade allow
   distinguishing the grading source. */
(function (global) {
  "use strict";

  var KEY = "rhcsa10_progress_v1";

  var DEFAULT = {
    version: 1,
    questions: {},   // qid -> { selfGrade, reviewedAt, attemptCount }
    log: [],         // [{ qid, selfGrade, ctx, at }] append-only
    exams: []        // [{ examId, name, startedAt, submittedAt, durationSec,
                     //    totalScore, score, passed, results:[{qid,selfGrade,points,earned}] }]
  };

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT);
      var data = JSON.parse(raw);
      if (!data || data.version !== 1) return clone(DEFAULT);
      data.questions = data.questions || {};
      data.log = data.log || [];
      data.exams = data.exams || [];
      return data;
    } catch (e) {
      return clone(DEFAULT);
    }
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var state = load();

  function persist() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save to localStorage:", e);
    }
  }

  var Progress = {
    /* Record the self-grade for a single question */
    recordQuestion: function (qid, selfGrade, ctx) {
      var now = new Date().toISOString();
      var q = state.questions[qid] || { attemptCount: 0 };
      q.selfGrade = selfGrade;
      q.reviewedAt = now;
      q.attemptCount = (q.attemptCount || 0) + 1;
      state.questions[qid] = q;
      state.log.push({ qid: qid, selfGrade: selfGrade, ctx: ctx || "", at: now });
      if (state.log.length > 2000) state.log = state.log.slice(-2000);
      persist();
    },

    getQuestion: function (qid) {
      return state.questions[qid] || null;
    },

    /* Record the result of automatic grading (VM bridge). Stored per phase ("live"/"reboot"). */
    recordAutoGrade: function (qid, result) {
      var now = new Date().toISOString();
      var q = state.questions[qid] || { attemptCount: 0 };
      q.autoGrade = q.autoGrade || {};
      q.autoGrade[result.phase || "live"] = {
        earned: result.earned, max: result.max,
        perCheck: result.perCheck, at: now
      };
      state.questions[qid] = q;
      persist();
    },

    /* VM grading + automatic reflection into selfGrade (so it shows in review and accuracy).
       A manually assigned selfGrade (selfGradeSource !== "vm-auto") is respected and
       not overwritten. A stale VM-derived grade can be overwritten by re-grading. */
    recordAutoGradeAndSync: function (qid, scored, opts) {
      this.recordAutoGrade(qid, scored);
      var q = state.questions[qid] || { attemptCount: 0 };
      if (q.selfGrade && q.selfGradeSource !== "vm-auto") return;
      if (!scored.max) return;
      var grade = scored.earned >= scored.max ? "correct"
                : scored.earned > 0          ? "partial"
                :                              "wrong";
      var now = new Date().toISOString();
      q.selfGrade = grade;
      q.selfGradeSource = "vm-auto";
      q.reviewedAt = now;
      q.attemptCount = (q.attemptCount || 0) + 1;
      state.questions[qid] = q;
      state.log.push({
        qid: qid, selfGrade: grade,
        ctx: (opts && opts.ctx) || "vm-auto",
        at: now
      });
      if (state.log.length > 2000) state.log = state.log.slice(-2000);
      persist();
    },

    /* Record a mock exam result */
    recordExam: function (rec) {
      state.exams.push(rec);
      if (state.exams.length > 100) state.exams = state.exams.slice(-100);
      persist();
    },

    getExams: function () { return state.exams.slice(); },

    /* Overall statistics */
    stats: function (allQuestions) {
      var attempted = 0, correct = 0, partial = 0, wrong = 0;
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        var g = state.questions[qid].selfGrade;
        if (!g) continue;
        attempted++;
        if (g === "correct") correct++;
        else if (g === "partial") partial++;
        else if (g === "wrong") wrong++;
      }
      var total = allQuestions ? allQuestions.length : 0;
      var graded = correct + partial + wrong;
      var accuracy = graded ? Math.round((correct + partial * 0.5) / graded * 100) : 0;
      return {
        total: total, attempted: attempted,
        correct: correct, partial: partial, wrong: wrong,
        accuracy: accuracy
      };
    },

    /* Per-category statistics { slug: {attempted, correct, partial, wrong, total} } */
    categoryStats: function (allQuestions) {
      var out = {};
      allQuestions.forEach(function (q) {
        if (!out[q.category]) out[q.category] = { attempted: 0, correct: 0, partial: 0, wrong: 0, total: 0 };
        out[q.category].total++;
        var rec = state.questions[q.id];
        if (rec && rec.selfGrade) {
          out[q.category].attempted++;
          out[q.category][rec.selfGrade]++;
        }
      });
      return out;
    },

    /* Array of qids for incorrectly answered questions (latest self-grade is wrong) */
    wrongList: function () {
      var out = [];
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        if (state.questions[qid].selfGrade === "wrong") out.push(qid);
      }
      return out;
    },

    /* Array of qids with partial credit (partial) */
    partialList: function () {
      var out = [];
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        if (state.questions[qid].selfGrade === "partial") out.push(qid);
      }
      return out;
    },

    /* Array of qids for not-yet-started questions (no record). Excludes legacy by default. */
    untouchedList: function (allQuestions, opts) {
      opts = opts || {};
      var includeLegacy = !!opts.includeLegacy;
      var out = [];
      (allQuestions || []).forEach(function (q) {
        if (!includeLegacy && q.legacy) return;
        var rec = state.questions[q.id];
        if (!rec || !rec.selfGrade) out.push(q.id);
      });
      return out;
    },

    /* Number of questions that have undergone VM grading (live phase) */
    vmGradedCount: function () {
      var n = 0;
      for (var qid in state.questions) {
        if (!state.questions.hasOwnProperty(qid)) continue;
        var ag = state.questions[qid].autoGrade;
        if (ag && (ag.live || ag.reboot)) n++;
      }
      return n;
    },

    /* Exam-readiness summary limited to the official scope (legacy=false).
       score = (correct + partial * 0.5) / official_total * 100 */
    officialSummary: function (allQuestions) {
      var official = (allQuestions || []).filter(function (q) { return !q.legacy; });
      var attempted = 0, correct = 0, partial = 0;
      official.forEach(function (q) {
        var rec = state.questions[q.id];
        if (!rec || !rec.selfGrade) return;
        attempted++;
        if (rec.selfGrade === "correct") correct++;
        else if (rec.selfGrade === "partial") partial++;
      });
      return {
        total: official.length,
        attempted: attempted,
        correct: correct,
        partial: partial,
        score: official.length
          ? Math.round((correct + partial * 0.5) / official.length * 100)
          : 0
      };
    },

    /* Best mock exam score (per exam ID) and overall best */
    examBest: function () {
      var byId = {};
      var overall = null;
      state.exams.forEach(function (e) {
        if (byId[e.examId] == null || e.score > byId[e.examId].score)
          byId[e.examId] = { score: e.score, totalScore: e.totalScore, name: e.name };
        if (overall == null || e.score > overall.score)
          overall = { score: e.score, totalScore: e.totalScore, name: e.name };
      });
      return { byId: byId, overall: overall, count: state.exams.length };
    },

    /* Clear everything */
    reset: function () {
      state = clone(DEFAULT);
      persist();
    },

    /* Clear the record for a single question (for the reset button) */
    clearQuestion: function (qid) {
      delete state.questions[qid];
      persist();
    },

    /* Number of questions completed through actual VM grading via high-precision grading (Class A) */
    highPrecisionCompleted: function (allQuestions) {
      var qmap = {};
      (allQuestions || []).forEach(function (q) { qmap[q.id] = q; });
      var done = 0, total = 0;
      (allQuestions || []).forEach(function (q) {
        if (q.graderQuality === "A" && !q.legacy) {
          total++;
          var rec = state.questions[q.id];
          if (rec && rec.autoGrade && rec.autoGrade.live) done++;
        }
      });
      return { done: done, total: total };
    },

    /* Today's study volume (local date) — number of grading log entries */
    todayCompleted: function () {
      var today = localDateKey(new Date());
      var qids = {};
      state.log.forEach(function (e) {
        var d = localDateKey(new Date(e.at));
        if (d === today) qids[e.qid] = true;
      });
      return Object.keys(qids).length;
    },

    /* Study streak — how many consecutive recent days have at least one recorded question */
    streak: function () {
      var dates = {};
      state.log.forEach(function (e) {
        dates[localDateKey(new Date(e.at))] = true;
      });
      var d = new Date();
      var n = 0;
      // If there is no record for today, start counting from yesterday (grace so it doesn't drop in the morning)
      if (!dates[localDateKey(d)]) {
        d.setDate(d.getDate() - 1);
      }
      while (dates[localDateKey(d)]) {
        n++;
        d.setDate(d.getDate() - 1);
      }
      return n;
    },

    /* Per-category achievement rank (Bronze/Silver/Gold/ExamReady) and progress */
    categoryRanks: function (allQuestions) {
      var byCat = {};
      (allQuestions || []).forEach(function (q) {
        if (q.legacy) return;
        if (!byCat[q.category]) byCat[q.category] = { total: 0, correct: 0, partial: 0 };
        byCat[q.category].total++;
        var rec = state.questions[q.id];
        if (rec && rec.selfGrade === "correct") byCat[q.category].correct++;
        else if (rec && rec.selfGrade === "partial") byCat[q.category].partial++;
      });
      var out = {};
      Object.keys(byCat).forEach(function (slug) {
        var c = byCat[slug];
        var score = c.total ? (c.correct + c.partial * 0.5) / c.total : 0;
        var rank = "none";
        if (score >= 1.0) rank = "exam-ready";
        else if (score >= 0.75) rank = "gold";
        else if (score >= 0.5) rank = "silver";
        else if (score >= 0.25) rank = "bronze";
        out[slug] = {
          rank: rank,
          score: Math.round(score * 100),
          correct: c.correct, partial: c.partial, total: c.total
        };
      });
      return out;
    },

    /* Array of qids in the same category graded wrong or partial (for the next-action feature) */
    weakInCategory: function (slug, allQuestions, excludeQid) {
      var out = [];
      (allQuestions || []).forEach(function (q) {
        if (q.category !== slug) return;
        if (q.id === excludeQid) return;
        var rec = state.questions[q.id];
        if (rec && (rec.selfGrade === "wrong" || rec.selfGrade === "partial")) {
          out.push(q.id);
        }
      });
      return out;
    },

    /* Exposed: recent log (for testing) */
    _state: function () { return state; }
  };

  function localDateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  global.Progress = Progress;
})(window);
