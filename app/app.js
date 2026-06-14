/* app.js — RHCSA10 English Edition. A faithful English port of the Japanese
   screens (app/js/ui/screens.js + main.js), kept separate so no Japanese-build
   file is touched. It reuses the language-neutral assets read-only:
     QUESTIONS (../js/data/questions.js), CATEGORIES (../js/data/categories.js),
     Progress (../js/ui/progress.js), Grader (../js/grader.js), Bridge (../js/bridge.js).
   English content comes from QUESTIONS_EN (data/questions_en.js); a question with
   no English entry falls back to its Japanese fields. Same DOM and CSS classes as
   the Japanese edition, so the layout matches. */
(function (global) {
  "use strict";

  var ALL = (typeof QUESTIONS !== "undefined" && QUESTIONS) || [];
  var EN = global.QUESTIONS_EN || {};
  var CATS = (typeof CATEGORIES !== "undefined" && CATEGORIES) || [];
  var CAT_MAP = {};
  CATS.forEach(function (c) { CAT_MAP[c.slug] = c; });
  var Q_MAP = {};
  ALL.forEach(function (q) { Q_MAP[q.id] = q; });

  // ---- English overlay: merge English display fields onto a question ----
  function catName(slug) { return (CAT_MAP[slug] && CAT_MAP[slug].official) || slug; }
  function eq(q) {
    var e = EN[q.id];
    var m = {};
    for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) m[k] = q[k];
    m.categoryLabel = catName(q.category);
    if (e) {
      if (e.title_en) m.title = e.title_en;
      if (e.promptHtml_en) m.promptHtml = e.promptHtml_en;
      if (Array.isArray(e.specHtml_en)) m.specHtml = e.specHtml_en;
      if (e.solutionHtml_en) m.solutionHtml = e.solutionHtml_en;
      if (Array.isArray(e.pitfallsHtml_en)) m.pitfallsHtml = e.pitfallsHtml_en;
      if (Array.isArray(e.verifyHtml_en)) m.verifyHtml = e.verifyHtml_en;
      if (typeof e.rebootCheckHtml_en === "string") m.rebootCheckHtml = e.rebootCheckHtml_en;
      if (Array.isArray(e.lab_en)) m.lab = e.lab_en;
      m._checksEn = e.checks_en || null;
      m._translated = true;
    }
    return m;
  }
  function isTranslated(id) { return !!EN[id]; }

  // ---- question mode (learn / practice), persisted ----
  var QMODE_KEY = "rhcsa_en_qmode";
  function getQuestionMode() {
    try { return global.localStorage.getItem(QMODE_KEY) === "practice" ? "practice" : "learn"; }
    catch (e) { return "learn"; }
  }
  function setQuestionMode(m) { try { global.localStorage.setItem(QMODE_KEY, m); } catch (e) {} }

  // ---- small helpers ----
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function gradeSym(g) {
    return g === "correct" ? "○" : g === "partial" ? "△" : g === "wrong" ? "×" : "·";
  }
  function gradeClass(g) {
    return g === "correct" ? "g-correct" : g === "partial" ? "g-partial"
      : g === "wrong" ? "g-wrong" : "";
  }
  function scopeBadge(q) {
    if (q.test === 7)
      return '<span class="badge scope-extra" title="Supplementary practice material.">extra</span>';
    return "";
  }
  function qualityBadge(q) {
    if (q.graderQuality === "A")
      return '<span class="badge grader-a" title="High-precision grading (Class A): strict, spec-based checks. You can rely on the VM result to judge pass/fail.">◆ High-precision A</span>';
    if (q.graderQuality === "B")
      return '<span class="badge grader-b" title="Assisted grading (Class B): mainly final-state checks. Compare against the model answer too.">◇ Assisted B</span>';
    return "";
  }
  function qHeader(q) {
    return '<div class="qhead">'
      + '<span class="qno">Test ' + q.test + " Q" + q.qno + "</span>"
      + '<span class="badge cat">' + esc(q.categoryLabel) + "</span>"
      + qualityBadge(q) + scopeBadge(q)
      + (q.legacy ? '<span class="badge legacy scope-legacy">Beyond exam scope '
        + esc(q.legacyReason || "") + "</span>" : "")
      + '<span class="badge diff">Level ' + q.difficulty + "/5</span>"
      + "</div>"
      + '<h2 style="border:none;margin:6px 0">' + esc(q.title) + "</h2>";
  }
  function focusedLabHTML(q) {
    var label = q.serverLabel || (q.server ? "Server" + String(q.server).toUpperCase() : "(unspecified)");
    var head = '<div class="lab-focused">Target: <strong>' + esc(label) + "</strong></div>";
    var details = (q.lab && q.lab.length)
      ? '<details class="labbox lab-detail"><summary>Show lab details</summary>'
        + '<ul class="lab-list">'
        + q.lab.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("")
        + "</ul></details>"
      : "";
    return head + details;
  }
  function specHTML(q) {
    var items = q.specHtml;
    if (!items || !items.length) return "";
    return '<ol class="spec-list">'
      + items.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>";
  }
  function renderPitfalls(items) {
    if (!items || !items.length) return "";
    var critical = items.slice(0, Math.min(2, items.length));
    var common = items.slice(2, 5);
    var alt = items.slice(5);
    function sec(label, list, cls) {
      if (!list.length) return "";
      return '<div class="pf-section pf-' + cls + '"><h4>' + label + "</h4><ul>"
        + list.map(function (h) { return "<li>" + h + "</li>"; }).join("") + "</ul></div>";
    }
    return '<div class="pitfalls pitfalls-stacked">'
      + "<h3>Pitfalls and exam tips</h3>"
      + sec("Most important", critical, "critical")
      + sec("Common mistakes", common, "common")
      + sec("Alternatives and notes", alt, "alt")
      + "</div>";
  }
  function verifyHTML(q) {
    var hasV = q.verifyHtml && q.verifyHtml.length;
    var hasR = q.rebootCheckHtml;
    if (!hasV && !hasR) return "";
    var vs = hasV
      ? '<ul class="vf-list">'
        + q.verifyHtml.map(function (v) { return "<li>" + v + "</li>"; }).join("") + "</ul>"
      : "";
    var rb = hasR
      ? '<div class="vf-reboot"><span class="vf-reboot-lbl">After reboot</span><span>'
        + q.rebootCheckHtml + "</span></div>"
      : "";
    return '<details class="verifybox"><summary>How to verify - check your own work before revealing the answer</summary>'
      + '<div class="verifybox-body">'
      + '<p class="vf-hint">Confirm your work on the VM with these checks. RHCSA requires settings to survive a reboot.</p>'
      + vs + rb + "</div></details>";
  }
  function solutionBlock(q) {
    return '<div class="solution"><h3>Model answer and walkthrough</h3>'
      + '<div class="md">' + q.solutionHtml + "</div>"
      + renderPitfalls(q.pitfallsHtml) + "</div>";
  }
  function selfGradeHTML(g) {
    return '<button class="sg-btn correct' + (g === "correct" ? " sel" : "") + '" data-g="correct">○ Got it</button>'
      + '<button class="sg-btn partial' + (g === "partial" ? " sel" : "") + '" data-g="partial">△ Unsure</button>'
      + '<button class="sg-btn wrong' + (g === "wrong" ? " sel" : "") + '" data-g="wrong">× Missed</button>';
  }
  function notFound(msg) {
    return { html: '<div class="empty">' + esc(msg || "Page not found")
      + '<br><br><a href="#home">Home</a></div>', bind: null };
  }

  // ---- VM auto-grade rendering ----
  function checkLabel(q, c) {
    if (q._checksEn && q._checksEn[c.id]) return q._checksEn[c.id];
    return c.label || c.id;
  }
  function autoGradeCheckRows(q, scored) {
    return scored.perCheck.map(function (c) {
      var label = esc(checkLabel(q, c));
      if (!c.score) {
        return '<div class="ag-check precond ' + (c.passed ? "pass" : "fail") + '" '
          + 'title="Environment precondition (no points). A fail here points to the VM setup, not your work.">'
          + '<span class="ag-mark">' + (c.passed ? "○" : "×") + "</span>"
          + '<span class="ag-label">' + label + "</span>"
          + '<span class="ag-score">' + (c.passed ? "OK" : "NG") + "</span></div>";
      }
      return '<div class="ag-check ' + (c.passed ? "pass" : "fail") + '">'
        + '<span class="ag-mark">' + (c.passed ? "○" : "×") + "</span>"
        + '<span class="ag-label">' + label + "</span>"
        + '<span class="ag-score">' + c.earned + " / " + c.score + "</span></div>";
    }).join("");
  }
  function autoGradeResultHTML(q, scored) {
    var phaseLabel = scored.phase === "reboot" ? "After-reboot check" : "Current-state check";
    var hasReboot = typeof Grader !== "undefined" && Grader.hasRebootChecks(q);
    var classBwarn = q.graderQuality === "B"
      ? '<div class="ag-classb-warn"><strong>◇ Assisted grading (Class B)</strong>'
        + '<p>These checks look only at the final state. They cannot judge your steps, so '
        + '<strong>compare your work against the model answer</strong> before deciding pass or fail.</p></div>'
      : "";
    var html = '<div class="autograde-result' + (q.graderQuality === "B" ? " is-classb" : "") + '">'
      + "<h3>VM grading - " + phaseLabel + "</h3>" + classBwarn
      + autoGradeCheckRows(q, scored)
      + '<div class="ag-total">Subtotal ' + scored.earned + " / " + scored.max + "</div>";
    if (scored.phase === "live" && hasReboot) {
      html += '<div class="ag-reboot-note">This question has an after-reboot persistence check. '
        + "Reboot the VM, then press the button below.</div>"
        + '<button data-role="rebootgrade">Run after-reboot check on VM</button>'
        + '<div data-role="rebootresult"></div>';
    }
    return html + "</div>";
  }

  // ---- interactive question card (drill + exam) ----
  function questionInteractiveHTML(q, state, mode) {
    state = state || {};
    var isExam = (mode || "drill") === "exam";
    var qmode = isExam ? "exam" : getQuestionMode();
    var isPractice = qmode === "practice";
    var connected = !!(global.Bridge && global.Bridge.connected);
    var hasVM = !!q.autoGradeReady && !isExam;
    var vmPrimary = hasVM && connected;
    var qcardCls = "qcard" + (isPractice ? " mode-practice" : "");

    var html = '<div class="' + qcardCls + '">' + qHeader(q);
    if (!isExam) {
      html += '<div class="mode-toggle" data-role="mode-toggle">'
        + '<button data-mode="learn"' + (qmode === "learn" ? ' class="active"' : "")
        + ' title="Study with the verify checklist and the answer visible">Learn</button>'
        + '<button data-mode="practice"' + (isPractice ? ' class="active"' : "")
        + ' title="Work hands-on with no hints (reveal on give up)">Practice</button></div>';
      html += '<div class="mode-hint">'
        + (isPractice
          ? 'Working on your own. Use "Open help" for the verify checklist, or "Give up and reveal" for the full answer.'
          : "Verify checklist and answer are shown (good for a first pass).")
        + "</div>";
    }

    if (!isExam) html += '<div class="step-label">Task</div>';
    html += '<div class="prompt">' + (q.promptHtml || esc(q.prompt)) + "</div>";
    if (q.specHtml && q.specHtml.length) {
      if (!isExam) html += '<div class="step-label">Requirements</div>';
      html += specHTML(q);
    }
    if (!isExam) html += '<div class="step-label">Target</div>';
    html += focusedLabHTML(q);
    if (!isExam) {
      html += '<div class="step-label">Grade and check'
        + '<span class="step-hint">verification checklist and answer appear here</span></div>';
      html += verifyHTML(q);
    }

    html += '<div class="action-bar">';
    if (!isExam) {
      if (hasVM)
        html += '<button data-role="autograde"' + (vmPrimary ? ' class="primary"' : "") + ">Grade on VM</button>";
      if (isPractice) {
        html += '<button data-role="showhelp" title="Open just the verify checklist">Open help</button>'
          + '<button data-role="surrender" title="Give up and see the model answer">Give up and reveal</button>';
      } else {
        html += '<button data-role="check"' + (!vmPrimary ? ' class="primary"' : "") + ">Show answer</button>";
      }
      html += '<span class="ab-sep"></span>';
    }
    html += '<span class="sg-group">' + selfGradeHTML(state.selfGrade != null ? state.selfGrade : q._selfGrade) + "</span>";
    if (!isExam) html += '<span class="ab-spacer"></span><button data-role="reset">Reset</button>';
    html += '</div><div data-role="agwrap"></div>';
    if (!isExam) html += '<div data-role="solwrap"></div><div data-role="nextwrap"></div>';
    return html + "</div>";
  }

  function nextActionsHTML(q, revealed) {
    var sess = App.session;
    var weak = Progress.weakInCategory(q.category, ALL, q.id);
    var sessNext = "";
    if (sess && sess.list) {
      var i = sess.list.indexOf(q.id);
      if (i >= 0 && i < sess.list.length - 1) sessNext = sess.list[i + 1];
    }
    var untried = Progress.untouchedList(ALL).filter(function (id) { return id !== q.id; });
    var nextUntried = sessNext || untried[0] || null;
    var nextWeak = weak[0] || null;
    var btns = [];
    if (nextUntried)
      btns.push('<button class="na-btn na-next primary" data-target="#q/' + esc(nextUntried) + '">▶ '
        + (sessNext ? "Next question" : "Next untried") + "</button>");
    if (nextWeak)
      btns.push('<button class="na-btn na-weak" data-target="#q/' + esc(nextWeak) + '">'
        + 'Next weak spot in this category <span class="na-sub">(' + esc(catName(q.category))
        + " · " + weak.length + " left)</span></button>");
    if (!revealed)
      btns.push('<button class="na-btn" data-target="reveal">Show the model answer</button>');
    btns.push('<button class="na-btn" data-target="back">Back to the list</button>');
    if (!btns.length) return "";
    return '<div class="next-actions"><div class="na-title">Next</div>' + btns.join("") + "</div>";
  }

  function bindQuestionInteractive(root, q, opts) {
    opts = opts || {};
    var qcardEl = root.querySelector(".qcard");
    var solwrap = root.querySelector("[data-role=solwrap]");
    var agwrap = root.querySelector("[data-role=agwrap]");
    var checkBtn = root.querySelector("[data-role=check]");
    var resetBtn = root.querySelector("[data-role=reset]");
    var agBtn = root.querySelector("[data-role=autograde]");
    var helpBtn = root.querySelector("[data-role=showhelp]");
    var surBtn = root.querySelector("[data-role=surrender]");
    var modeToggle = root.querySelector("[data-role=mode-toggle]");
    var sgBtns = root.querySelectorAll(".action-bar .sg-btn");
    var nextwrap = root.querySelector("[data-role=nextwrap]");
    var state = opts.state || { revealed: false, selfGrade: q._selfGrade || null };

    function showNextActions() {
      if (!nextwrap) return;
      nextwrap.innerHTML = nextActionsHTML(q, state.revealed);
      nextwrap.querySelectorAll(".na-btn").forEach(function (b) {
        b.onclick = function () {
          var t = b.getAttribute("data-target");
          if (t === "reveal") { if (checkBtn) checkBtn.click(); else if (surBtn) surBtn.click(); }
          else if (t === "back") {
            var crumbBack = root.querySelector(".crumbs a");
            location.hash = crumbBack ? crumbBack.getAttribute("href") : "#home";
          } else location.hash = t;
        };
      });
    }
    function showSolution() { if (solwrap) solwrap.innerHTML = solutionBlock(q); }
    function renderAutoGrade(scored) {
      agwrap.innerHTML = autoGradeResultHTML(q, scored);
      var rb = agwrap.querySelector("[data-role=rebootgrade]");
      if (rb) rb.onclick = function () {
        rb.disabled = true; rb.textContent = "Grading…";
        global.Bridge.grade(q.id, "reboot").then(function (res) {
          var s2 = Grader.score(q, res);
          var rr = agwrap.querySelector("[data-role=rebootresult]");
          if (rr) rr.innerHTML = autoGradeCheckRows(q, s2)
            + '<div class="ag-total">After reboot subtotal ' + s2.earned + " / " + s2.max + "</div>";
        }).catch(function (e) {
          rb.disabled = false; rb.textContent = "Run after-reboot check on VM";
          var rr = agwrap.querySelector("[data-role=rebootresult]");
          if (rr) rr.innerHTML = '<div class="ag-msg ag-err">Grading error: ' + esc(e.message) + "</div>";
        });
      };
    }
    if (agBtn) agBtn.onclick = function () {
      if (!global.Bridge || !global.Bridge.connected) {
        agwrap.innerHTML = '<div class="ag-msg ag-err">The VM bridge is offline. '
          + "Start tools/vmbridge.py and connect a VM (see SETUP-vmbridge.md).</div>";
        return;
      }
      agBtn.disabled = true; agBtn.textContent = "Grading…";
      agwrap.innerHTML = '<div class="ag-msg">Grading on the VM…</div>';
      global.Bridge.grade(q.id, "live").then(function (res) {
        var scored = Grader.score(q, res);
        renderAutoGrade(scored);
        if (opts.onAutoGrade) opts.onAutoGrade(scored);
        else { try { Progress.recordAutoGrade(q.id, scored); } catch (e) {} }
        showNextActions();
        agwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }).catch(function (e) {
        agwrap.innerHTML = '<div class="ag-msg ag-err">Grading error: ' + esc(e.message) + "</div>";
      }).then(function () { agBtn.disabled = false; agBtn.textContent = "Grade on VM"; });
    };
    sgBtns.forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute("data-g");
        state.selfGrade = g;
        sgBtns.forEach(function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        if (opts.onGrade) opts.onGrade(g);
        else { try { Progress.recordQuestion(q.id, g, "single"); } catch (e) {} }
        showNextActions();
      };
    });
    if (checkBtn) checkBtn.onclick = function () {
      state.revealed = true; showSolution(); showNextActions();
      if (solwrap) solwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    if (resetBtn) resetBtn.onclick = function () {
      state.revealed = false; state.selfGrade = null;
      if (solwrap) solwrap.innerHTML = "";
      if (agwrap) agwrap.innerHTML = "";
      if (nextwrap) nextwrap.innerHTML = "";
      sgBtns.forEach(function (x) { x.classList.remove("sel"); });
      if (qcardEl) qcardEl.classList.remove("helped");
      if (opts.onReset) opts.onReset();
    };
    if (modeToggle) modeToggle.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        var nm = b.getAttribute("data-mode");
        if (nm === getQuestionMode()) return;
        setQuestionMode(nm); App.render();
      };
    });
    if (helpBtn) helpBtn.onclick = function () {
      if (qcardEl) qcardEl.classList.add("helped");
      helpBtn.disabled = true; helpBtn.textContent = "Help shown";
    };
    if (surBtn) surBtn.onclick = function () {
      if (!global.confirm("Give up and show the model answer?")) return;
      if (qcardEl) { qcardEl.classList.remove("mode-practice"); qcardEl.classList.add("helped"); }
      state.revealed = true; showSolution();
      if (solwrap) solwrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    // revisiting an already-graded question: reveal the answer like the JP app does
    if (state.revealed && (opts.mode || "drill") !== "exam") { showSolution(); showNextActions(); }
  }

  // ---- home dashboard ----
  function dashBox(num, lbl, sub, dim) {
    return '<div class="dash-box"><div class="dash-num' + (dim ? " dim" : "") + '">'
      + esc(num) + '</div><div class="dash-lbl">' + esc(lbl)
      + '</div><div class="dash-sub">' + esc(sub) + "</div></div>";
  }
  function actionCard(hash, title, sub, desc) {
    return '<div class="card" data-hash="' + esc(hash) + '">'
      + "<h3>" + esc(title) + '</h3><div class="ico">' + esc(sub) + "</div>"
      + '<div class="meta" style="margin-top:6px">' + esc(desc) + "</div></div>";
  }
  function todayCardHTML(key, title, count, desc) {
    var off = count === 0;
    return '<div class="card today-card' + (off ? " disabled" : "") + '"'
      + (off ? "" : ' data-review="' + key + '"') + ">"
      + "<h3>" + esc(title) + "</h3>"
      + '<div class="big" style="font-size:22px;margin-top:4px">'
      + (off ? "None" : count + (count === 1 ? " question" : " questions")) + "</div>"
      + '<div class="meta">' + esc(desc) + "</div></div>";
  }
  function renderTodayCards() {
    var wrong = Progress.wrongList();
    var partial = Progress.partialList();
    var untouched = Progress.untouchedList(ALL);
    var html = '<div class="grid home-today">'
      + todayCardHTML("wrong", "× Missed", wrong.length, "Retry the ones you marked missed")
      + todayCardHTML("partial", "△ Unsure", partial.length, "Retry the ones you marked unsure")
      + todayCardHTML("untouched", "· Not started", untouched.length, "Start with questions you have not tried (legacy excluded)")
      + "</div>";
    return { html: html, wrong: wrong, partial: partial, untouched: untouched };
  }
  function bindTodayCards(root, lists) {
    function startReview(list, label) {
      if (!list.length) return;
      App.session = { mode: "review", label: label, baseHash: location.hash || "#home", list: list.slice() };
      location.hash = "#q/" + list[0];
    }
    root.querySelectorAll(".today-card[data-review]").forEach(function (card) {
      card.onclick = function () {
        var k = card.getAttribute("data-review");
        if (k === "wrong") startReview(lists.wrong, "Review (missed)");
        else if (k === "partial") startReview(lists.partial, "Review (unsure)");
        else startReview(lists.untouched, "Review (not started)");
      };
    });
  }
  function renderCategoryCoverage() {
    var cstat = Progress.categoryStats(ALL);
    var officialByCat = {};
    CATS.forEach(function (c) {
      officialByCat[c.slug] = ALL.filter(function (q) { return q.category === c.slug && !q.legacy; }).length;
    });
    var rows = CATS.map(function (c) {
      var s = cstat[c.slug] || { attempted: 0, correct: 0, partial: 0 };
      var off = officialByCat[c.slug] || 0;
      var pct = off ? Math.round((s.correct + s.partial * 0.5) / off * 100) : 0;
      return '<div class="cat-stat"><span><a href="#drill/' + esc(c.slug) + '">'
        + esc(c.official) + "</a></span>"
        + '<div class="bar"><span style="width:' + pct + '%"></span></div>'
        + '<span class="cs-detail">' + s.attempted + "/" + off + " (" + pct + "%)</span></div>";
    }).join("");
    return '<div class="dash-cover">' + rows + "</div>";
  }
  function home() {
    var off = Progress.officialSummary(ALL);
    var st = Progress.stats(ALL);
    var streakN = Progress.streak();
    var today = renderTodayCards();
    var vmReadyCount = ALL.filter(function (q) { return q.autoGradeReady; }).length;
    var vmDone = Progress.vmGradedCount();
    var html = "<h1>RHCSA 10 exam practice</h1>"
      + '<p class="subtitle">RHEL 10 EX200 practice — engine demo on an original sample task set. The full question bank is excluded for copyright.</p>'
      + '<div class="dash-row">'
      + dashBox(off.score + "%", "Readiness score", "Sample " + off.attempted + "/" + off.total + " started · ○" + off.correct + " △" + off.partial)
      + dashBox(vmDone + " / " + vmReadyCount, "Graded on VM", "Questions checked on a real VM", vmDone === 0)
      + dashBox(streakN + (streakN === 1 ? " day" : " days"), "Study streak",
          streakN >= 7 ? "A week or more. The habit is forming."
          : streakN >= 3 ? "Three days or more. Almost a habit."
          : streakN > 0 ? "Keep going a little each day."
          : "Solve one today to start a streak.", streakN === 0)
      + dashBox(st.wrong, "× Missed", "Retry these first from Review", st.wrong === 0)
      + "</div>"
      + '<h2 style="margin-top:24px">Today</h2>' + today.html
      + "<h2>Coverage by category</h2>"
      + '<p class="subtitle" style="margin:0 0 8px">Self-graded accuracy per category. Click a name to drill.</p>'
      + renderCategoryCoverage()
      + "<h2>Menu</h2>"
      + '<div class="home-actions">'
      + actionCard("#drill", "▶ Drill by category", "By category", "Pick a category and focus. All categories, or random from your misses.")
      + actionCard("#history", "▶ Review", "Retry weak spots", "Missed, unsure, and not-started questions from Today.")
      + "</div>";
    return { html: html, bind: function (root) { bindTodayCards(root, today); } };
  }

  // ---- drill grid + list ----
  function drillGrid() {
    var cards = CATS.map(function (c) {
      var official = ALL.filter(function (q) { return q.category === c.slug && !q.legacy; });
      var attempted = official.filter(function (q) {
        var rec = Progress.getQuestion(q.id); return rec && rec.selfGrade;
      }).length;
      return '<div class="card" data-hash="#drill/' + esc(c.slug) + '">'
        + "<h3>" + esc(c.official) + "</h3>"
        + '<div class="meta">&nbsp;</div>'
        + '<div class="big" style="font-size:20px;margin-top:6px">' + attempted + " / " + official.length + "</div>"
        + '<div class="meta">&nbsp;</div></div>';
    }).join("");
    var officialTotal = ALL.filter(function (q) { return !q.legacy && q.test !== 7; }).length;
    cards += '<div class="card" data-hash="#random"><h3>▶ Random from all</h3>'
      + '<div class="meta">' + officialTotal + ' official questions</div>'
      + '<div class="big" style="font-size:18px;margin-top:6px">Check yourself</div>'
      + '<div class="meta">Shuffled across every category.</div></div>'
      + '<div class="card" data-hash="#random/wrong"><h3>▶ Random from misses</h3>'
      + '<div class="meta">Review</div>'
      + '<div class="big" style="font-size:18px;margin-top:6px">Close the gaps</div>'
      + '<div class="meta">Shuffled from questions you marked missed.</div></div>';
    var html = "<h1>Drill by category</h1>"
      + '<p class="subtitle">RHCSA exam domains. Pick a category to drill its tasks. '
      + "(This demo runs on an original sample set.)</p>"
      + '<div class="grid">' + cards + "</div>";
    return { html: html, bind: null };
  }
  function qRow(q) {
    var rec = Progress.getQuestion(q.id);
    var g = rec && rec.selfGrade;
    var extra = q.test === 7 ? '<span class="badge scope-extra" title="supplementary sample">extra</span>' : "";
    var vmReady = q.autoGradeReady ? '<span class="badge badge-vm" title="Can be graded on the VM">VM</span>' : "";
    return '<div class="qrow" data-qid="' + esc(q.id) + '">'
      + '<span class="qmark ' + gradeClass(g) + '">' + gradeSym(g) + "</span>"
      + '<span class="qid">T' + q.test + "Q" + q.qno + "</span>"
      + '<span class="qtitle">' + esc(q.title) + "</span>"
      + vmReady + extra
      + (q.legacy ? '<span class="badge legacy scope-legacy">beyond scope</span>' : "")
      + '<span class="badge diff">Lv' + q.difficulty + "</span></div>";
  }
  function drillList(slug) {
    var cat = CAT_MAP[slug];
    if (!cat) return notFound("Unknown category: " + slug);
    var list = ALL.filter(function (q) { return q.category === slug && !q.legacy; })
      .sort(function (a, b) { return (a.test - b.test) || (a.qno - b.qno); })
      .map(eq);
    var html = '<div class="crumbs"><a href="#drill">Drill by category</a> / ' + esc(cat.official) + "</div>"
      + "<h1>" + esc(cat.official) + "</h1>"
      + '<p class="subtitle">' + list.length + " sample questions</p>"
      + '<div class="toolbar"><button data-role="startall" class="primary">Solve in order</button></div>'
      + '<div class="filter-chips">'
      + '<label><input type="checkbox" data-filter="untouched"> Not started</label>'
      + '<label><input type="checkbox" data-filter="partial"> △ Unsure</label>'
      + '<label><input type="checkbox" data-filter="wrong"> × Missed</label>'
      + '<label><input type="checkbox" data-filter="autograde"> VM-gradable</label>'
      + "</div><div class=\"qlist\" data-role=\"qlist\"></div>";
    return {
      html: html, bind: function (root) {
        var listEl = root.querySelector("[data-role=qlist]");
        var chips = root.querySelectorAll(".filter-chips input[type=checkbox]");
        function getChecks() { var c = {}; chips.forEach(function (cb) { c[cb.getAttribute("data-filter")] = cb.checked; }); return c; }
        function applyFilters(items) {
          var c = getChecks();
          var stateGroup = c.untouched || c.partial || c.wrong;
          var wrongSet = c.wrong ? new Set(Progress.wrongList()) : null;
          var partialSet = c.partial ? new Set(Progress.partialList()) : null;
          var untouchedSet = c.untouched ? new Set(Progress.untouchedList(ALL, { includeLegacy: true })) : null;
          return items.filter(function (q) {
            if (c.autograde && !q.autoGradeReady) return false;
            if (stateGroup) {
              var match = (wrongSet && wrongSet.has(q.id)) || (partialSet && partialSet.has(q.id)) || (untouchedSet && untouchedSet.has(q.id));
              if (!match) return false;
            }
            return true;
          });
        }
        function draw() {
          var shown = applyFilters(list);
          listEl.innerHTML = shown.map(qRow).join("") || '<div class="empty">No matching questions</div>';
          listEl.querySelectorAll(".qrow").forEach(function (row) {
            row.onclick = function () {
              App.session = { mode: "drill", label: cat.official + " drill", baseHash: "#drill/" + slug, list: shown.map(function (q) { return q.id; }) };
              location.hash = "#q/" + row.getAttribute("data-qid");
            };
          });
        }
        chips.forEach(function (cb) { cb.onchange = draw; });
        root.querySelector("[data-role=startall]").onclick = function () {
          var shown = applyFilters(list);
          if (!shown.length) return;
          App.session = { mode: "drill", label: cat.official + " drill", baseHash: "#drill/" + slug, list: shown.map(function (q) { return q.id; }) };
          location.hash = "#q/" + shown[0].id;
        };
        draw();
      }
    };
  }

  // ---- AI tutor chat pane (right of the question) ----
  var CHAT_OPEN_KEY = "rhcsa10_en_chatopen_v1";
  function isChatOpen() { try { return global.localStorage.getItem(CHAT_OPEN_KEY) === "1"; } catch (e) { return false; } }
  function setChatOpen(v) { try { global.localStorage.setItem(CHAT_OPEN_KEY, v ? "1" : "0"); } catch (e) {} }

  function chatPaneHTML(qid) {
    var open = isChatOpen();
    return '<aside class="chat-pane ' + (open ? "open" : "collapsed") + '" data-qid="' + esc(qid) + '">'
      + '<button class="chat-toggle" data-role="chat-toggle" title="Toggle the AI tutor panel">'
      + '<span class="chat-toggle-arrow">' + (open ? "▾" : "▸") + "</span>"
      + '<span class="chat-toggle-label">AI tutor</span>'
      + '<span class="chat-toggle-hint">' + (open ? "close" : "open") + "</span></button>"
      + '<div class="chat-body" data-role="chat-body"><div class="chat-head">'
      + '<span class="chat-title">AI tutor</span><span class="chat-status" data-role="chat-status"></span></div>'
      + '<div class="chat-modes" data-role="chat-modes">'
      + '<button class="chat-mode" data-mode="hint">Hint</button>'
      + '<button class="chat-mode active" data-mode="explain">Explain</button>'
      + '<button class="chat-mode" data-mode="debug">Debug</button></div>'
      + '<div class="chat-modehint" data-role="chat-modehint"></div>'
      + '<div class="chat-log" data-role="chat-log"></div>'
      + '<div class="chat-input-row"><textarea class="chat-input" data-role="chat-input" rows="2" placeholder="Ask about this question… (Cmd/Ctrl+Enter to send)"></textarea>'
      + '<button class="chat-send" data-role="chat-send" title="Send">Send</button></div>'
      + '<div class="chat-foot"><button class="chat-clear" data-role="chat-clear" title="Clear this question\'s chat history">Clear history</button></div>'
      + "</div></aside>";
  }

  function renderMarkdownLite(text) {
    var blocks = [];
    var src = String(text == null ? "" : text).replace(/```([a-z]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var idx = blocks.length;
      blocks.push('<pre><code class="lang-' + esc(lang || "bash") + '">' + esc(code) + "</code></pre>");
      return "\n@@CB" + idx + "@@\n";
    });
    src = esc(src);
    function inline(s) { return s.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
    var lines = src.split("\n"), out = [], listType = null;
    function closeList() { if (listType) { out.push("</" + listType + ">"); listType = null; } }
    function openList(type) { if (listType !== type) { closeList(); out.push("<" + type + ">"); listType = type; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;
      if (/^@@CB\d+@@$/.test(line.trim())) { closeList(); out.push(line.trim()); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); out.push("<hr>"); continue; }
      m = /^\s*(#{1,6})\s+(.*)$/.exec(line);
      if (m) { closeList(); var lvl = m[1].length <= 2 ? 4 : 5; out.push("<h" + lvl + ' class="md-h">' + inline(m[2]) + "</h" + lvl + ">"); continue; }
      m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (m) { openList("ul"); var done = m[1] !== " "; out.push('<li class="md-task' + (done ? " done" : "") + '"><span class="md-box">' + (done ? "☑" : "☐") + "</span><span>" + inline(m[2]) + "</span></li>"); continue; }
      m = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (m) { openList("ul"); out.push("<li>" + inline(m[1]) + "</li>"); continue; }
      m = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (m) { openList("ol"); out.push("<li>" + inline(m[1]) + "</li>"); continue; }
      if (line.trim() === "") { closeList(); continue; }
      closeList(); out.push('<div class="md-line">' + inline(line) + "</div>");
    }
    closeList();
    return out.join("\n").replace(/@@CB(\d+)@@/g, function (_, i) { return blocks[+i]; });
  }

  var MODE_INFO = {
    hint: { desc: "Returns hints and a way to think, without the answer. For when you want to try first.",
      ph: "Describe the operation you want a hint for…",
      examples: ['<div class="ce-ex">How do I extract only the lines that start with <code>Host</code>?</div>', '<div class="ce-ex">What approach skips comment lines?</div>'] },
    explain: { desc: "Explains each command and how it works. For when you want to understand it.",
      ph: "Name a command or concept you do not understand…",
      examples: ['<div class="ce-ex">What does the <code>-v</code> in <code>grep -v \'^#\'</code> do?</div>', '<div class="ce-ex">Difference between <code>&gt;</code> and <code>&gt;&gt;</code>?</div>'] },
    debug: { desc: "Paste the error you got and it diagnoses the cause and the fix. For when you are stuck.",
      ph: "Paste the error output from the VM…",
      examples: ['<div class="ce-ex">I got <code>Permission denied</code> (also paste the command)</div>', '<div class="ce-ex">My saved file ends up empty…</div>'] }
  };

  var chatStatusPoll = null;
  function bindChatPane(root, qid) {
    var pane = root.querySelector(".chat-pane");
    if (!pane) return;
    var toggleBtn = pane.querySelector("[data-role=chat-toggle]");
    var statusEl = pane.querySelector("[data-role=chat-status]");
    var modesEl = pane.querySelector("[data-role=chat-modes]");
    var logEl = pane.querySelector("[data-role=chat-log]");
    var inputEl = pane.querySelector("[data-role=chat-input]");
    var sendBtn = pane.querySelector("[data-role=chat-send]");
    var clearBtn = pane.querySelector("[data-role=chat-clear]");
    var modehintEl = pane.querySelector("[data-role=chat-modehint]");
    var currentMode = "explain";
    var streamAnchorKey = null;

    function applyOpenState(open) {
      pane.classList.toggle("open", open); pane.classList.toggle("collapsed", !open);
      if (toggleBtn) {
        var arrow = toggleBtn.querySelector(".chat-toggle-arrow"), hint = toggleBtn.querySelector(".chat-toggle-hint");
        if (arrow) arrow.textContent = open ? "▾" : "▸";
        if (hint) hint.textContent = open ? "close" : "open";
      }
      setChatOpen(open);
      if (open && inputEl) setTimeout(function () { inputEl.focus(); }, 60);
    }
    if (toggleBtn) toggleBtn.onclick = function () { applyOpenState(!pane.classList.contains("open")); };
    pane._toggleChat = function () { applyOpenState(!pane.classList.contains("open")); };

    function updateStatus() {
      if (!document.body.contains(pane)) { if (chatStatusPoll) { clearInterval(chatStatusPoll); chatStatusPoll = null; } return; }
      var ready = global.ChatEn && global.ChatEn.isReady();
      if (ready) {
        statusEl.textContent = "● connected"; statusEl.className = "chat-status ok";
        sendBtn.disabled = false; inputEl.disabled = false;
        inputEl.placeholder = (MODE_INFO[currentMode] || MODE_INFO.explain).ph;
      } else {
        statusEl.textContent = "● offline"; statusEl.className = "chat-status off";
        sendBtn.disabled = true; inputEl.disabled = true;
        var bridgeUp = global.Bridge && global.Bridge.bridgeUp;
        inputEl.placeholder = bridgeUp ? "Set anthropic_api_key in vmbridge.config.json" : "Start vmbridge.py";
      }
    }
    updateStatus();
    if (chatStatusPoll) clearInterval(chatStatusPoll);
    chatStatusPoll = setInterval(updateStatus, 5000);

    function renderHistory(opts) {
      opts = opts || {};
      var nearBottom = (logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight) < 120;
      var hist = global.ChatEn.getHistory(qid);
      if (!hist.length) {
        var info0 = MODE_INFO[currentMode] || MODE_INFO.explain;
        logEl.innerHTML = '<div class="chat-empty"><div class="ce-ex-h">Example questions</div>' + info0.examples.join("") + "</div>";
        return;
      }
      logEl.innerHTML = hist.map(function (m) {
        var cls = "chat-msg " + (m.role === "user" ? "u" : "a") + (m.streaming ? " streaming" : "");
        return '<div class="' + cls + '"><div class="chat-msg-body">' + renderMarkdownLite(m.content) + "</div></div>";
      }).join("");
      var last = hist[hist.length - 1];
      if (last && last.streaming && last.content) {
        var key = qid + ":" + hist.length;
        if (streamAnchorKey !== key) {
          streamAnchorKey = key;
          var msgs = logEl.querySelectorAll(".chat-msg");
          var ansEl = msgs[msgs.length - 1];
          if (ansEl) logEl.scrollTop = ansEl.getBoundingClientRect().top - logEl.getBoundingClientRect().top + logEl.scrollTop - 6;
        }
        return;
      }
      if (opts.forceBottom || nearBottom) logEl.scrollTop = logEl.scrollHeight;
    }
    function applyMode(mode) {
      currentMode = mode;
      modesEl.querySelectorAll(".chat-mode").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-mode") === mode); });
      var info = MODE_INFO[mode] || MODE_INFO.explain;
      if (modehintEl) modehintEl.textContent = info.desc;
      if (global.ChatEn && global.ChatEn.isReady()) inputEl.placeholder = info.ph;
      if (!global.ChatEn.getHistory(qid).length) renderHistory();
    }
    applyMode(currentMode);
    renderHistory({ forceBottom: true });
    modesEl.querySelectorAll(".chat-mode").forEach(function (btn) { btn.onclick = function () { applyMode(btn.getAttribute("data-mode")); }; });

    function scrollChatIntoView() {
      var body = pane.querySelector("[data-role=chat-body]") || logEl;
      if (body && body.scrollIntoView) body.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function doSend() {
      if (sendBtn.disabled) return;
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = ""; sendBtn.disabled = true;
      global.ChatEn.send({
        qid: qid, mode: currentMode, userText: text,
        onChunk: function () { renderHistory(); },
        onDone: function () { renderHistory(); sendBtn.disabled = false; inputEl.focus(); },
        onError: function (msg) {
          renderHistory();
          var div = document.createElement("div"); div.className = "chat-msg err";
          div.innerHTML = '<div class="chat-msg-body">[error] ' + esc(msg) + "</div>";
          logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
          sendBtn.disabled = false; inputEl.focus();
        }
      });
      renderHistory({ forceBottom: true });
      scrollChatIntoView();
    }
    sendBtn.onclick = doSend;
    inputEl.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSend(); } });
    clearBtn.onclick = function () { if (global.confirm("Clear this question's chat history?")) { global.ChatEn.clearHistory(qid); renderHistory(); } };
  }

  // ---- question screen ----
  function question(qid) {
    var raw = Q_MAP[qid];
    if (!raw) return notFound("Unknown question: " + qid);
    var q = eq(raw);
    var rec = Progress.getQuestion(qid) || {};
    var state = { revealed: !!rec.selfGrade, selfGrade: rec.selfGrade || null };
    q._selfGrade = state.selfGrade;
    var sess = App.session;
    var prevHash = "", nextHash = "", crumbs = catName(raw.category), backHash = "#drill/" + raw.category;
    if (sess && sess.list) {
      backHash = sess.baseHash || "#home";
      var i = sess.list.indexOf(qid);
      if (i >= 0) {
        crumbs = sess.label + " - " + (i + 1) + " / " + sess.list.length;
        if (i > 0) prevHash = "#q/" + sess.list[i - 1];
        if (i < sess.list.length - 1) nextHash = "#q/" + sess.list[i + 1];
      }
    }
    var navHtml = '<div class="navrow big-navrow">'
      + (prevHash ? '<button data-nav="prev" class="big-nav-btn">← Previous</button>' : "")
      + '<span class="spacer"></span>'
      + (nextHash ? '<button data-nav="next" class="primary big-nav-btn big-nav-next">Next →</button>'
        : '<button data-nav="back" class="big-nav-btn">Back to the list</button>')
      + "</div>";
    var html = '<div class="crumbs">' + esc(crumbs) + ' &nbsp;|&nbsp; <a href="' + esc(backHash) + '">Back to the list</a></div>'
      + (isTranslated(qid) ? "" : '<div class="ag-msg">Not yet translated - shown in Japanese.</div>')
      + '<div class="q-with-chat"><div class="q-main">' + questionInteractiveHTML(q, state) + navHtml + "</div>"
      + chatPaneHTML(qid) + "</div>";
    return { html: html, bind: function (root) {
      bindQuestionInteractive(root, q, {
        state: state, mode: "drill",
        onGrade: function (g) { try { Progress.recordQuestion(qid, g, sess ? sess.mode : "single"); } catch (e) {} },
        onAutoGrade: function (scored) { try { Progress.recordAutoGradeAndSync(qid, scored, { ctx: "vm-auto" }); } catch (e) {} },
        onReset: function () { try { Progress.clearQuestion(qid); } catch (e) {} }
      });
      var p = root.querySelector("[data-nav=prev]"); if (p) p.onclick = function () { location.hash = prevHash; };
      var n = root.querySelector("[data-nav=next]"); if (n) n.onclick = function () { location.hash = nextHash; };
      var b = root.querySelector("[data-nav=back]"); if (b) b.onclick = function () { location.hash = backHash; };
      bindChatPane(root, qid);
    } };
  }

  // ---- review (history) ----
  function review() {
    var today = renderTodayCards();
    var html = "<h1>Review</h1>"
      + '<p class="subtitle">Retry your weak spots. Pick a stack to run through it.</p>'
      + today.html;
    return { html: html, bind: function (root) { bindTodayCards(root, today); } };
  }

  // ---- random ----
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function randomSetup(filter) {
    var isWrong = filter === "wrong";
    var pool = isWrong
      ? Progress.wrongList().map(function (id) { return Q_MAP[id]; }).filter(Boolean)
      : ALL.filter(function (q) { return !q.legacy && q.test !== 7; });
    var title = isWrong ? "Random from misses" : "Random from all";
    var crumbs = '<div class="crumbs"><a href="#drill">Drill by category</a> / ' + esc(title) + "</div><h1>" + esc(title) + "</h1>";
    if (!pool.length) {
      return { html: crumbs + '<div class="empty">'
        + (isWrong ? "No missed questions yet. Mark a question × to review it here." : "No questions available.")
        + '<br><br><a href="#drill">Back to drill</a></div>', bind: null };
    }
    var counts = [10, 20, 30].filter(function (n) { return n < pool.length; });
    counts.push(pool.length);
    var btns = counts.map(function (n) {
      return '<button class="btn" data-n="' + n + '">' + (n === pool.length ? "All " + n : n + " questions") + "</button>";
    }).join(" ");
    return {
      html: crumbs + '<p class="subtitle">' + pool.length + " questions in the pool. Pick how many to shuffle and start.</p>"
        + '<div class="toolbar">' + btns + "</div>",
      bind: function (root) {
        root.querySelectorAll("[data-n]").forEach(function (b) {
          b.onclick = function () {
            var n = parseInt(b.getAttribute("data-n"), 10);
            var order = shuffle(pool).slice(0, n);
            App.session = { mode: "random", label: title, baseHash: "#drill", list: order.map(function (q) { return q.id; }) };
            location.hash = "#q/" + order[0].id;
          };
        });
      }
    };
  }

  // ---- exams ----
  function EXAMS_DATA() { return (typeof EXAMS !== "undefined" && EXAMS) || []; }
  function examName(e) {
    return e.name || e.id;
  }
  function fmtDur(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + "m " + (s < 10 ? "0" : "") + s + "s";
  }
  function examList() {
    var exams = Progress.getExams();
    function bestFor(id) {
      var best = null;
      exams.forEach(function (e) { if (e.examId === id && (best === null || e.score > best)) best = e.score; });
      return best;
    }
    var cards = EXAMS_DATA().map(function (e) {
      var best = bestFor(e.id);
      var active = App.examSession && App.examSession.examId === e.id && !App.examSession.submitted;
      var isBoss = e.boss === true;
      var bossTag = isBoss ? '<span class="badge exam-boss-badge" title="A final dress rehearsal.">★ BOSS</span>' : "";
      return '<div class="card exam-card' + (isBoss ? " exam-boss" : "") + '" data-hash="#exam-run/' + esc(e.id) + '">'
        + "<h3>" + esc(examName(e)) + " " + bossTag + (active ? " <span class='badge'>in progress</span>" : "") + "</h3>"
        + '<div class="meta">' + e.tasks.length + " tasks / " + e.totalScore + " points / pass " + e.passScore + "</div>"
        + '<div class="meta">Time limit ' + Math.round(e.timeLimit / 60) + " min</div>"
        + '<div class="big" style="font-size:16px;margin-top:8px">' + (best != null ? "Best " + best : "Not taken") + "</div></div>";
    }).join("");
    var html = "<h1>Mock exams</h1>"
      + '<div class="exam-mode-banner"><span class="emb-icon">●</span>'
      + '<span class="emb-text"><strong>Exam mode</strong>: once you start, the countdown runs. Solve the tasks in order. The exam keeps running even if you visit other screens.</span></div>'
      + '<p class="subtitle">A timed sample exam built from original tasks (demo). Start it to run the countdown and self-assess. '
      + "The real exam sets belong to the excluded private dataset.</p>"
      + '<div class="grid">' + cards + "</div>";
    return { html: html, bind: null };
  }
  function markSidebar(root, idx, task) {
    var it = root.querySelector('.titem[data-ti="' + idx + '"] .tst');
    if (!it) return;
    it.innerHTML = task.selfGrade
      ? '<span class="' + gradeClass(task.selfGrade) + '">' + gradeSym(task.selfGrade) + "</span>"
      : '<span style="color:var(--fg-dim)">·</span>';
  }
  function examRun(examId) {
    var exam = null;
    EXAMS_DATA().forEach(function (e) { if (e.id === examId) exam = e; });
    if (!exam) return notFound("Unknown exam: " + examId);
    if (!App.examSession || App.examSession.examId !== examId || App.examSession.submitted) App.startExam(exam);
    var S = App.examSession;
    var idx = Math.min(S.index, S.tasks.length - 1);
    S.index = idx;
    var task = S.tasks[idx];
    var raw = Q_MAP[task.qid];
    if (!raw) return notFound("Task '" + task.qid + "' is missing from the question data (possible rebuild). Abort the exam with the × next to the timer and retry.");
    var q = eq(raw);
    var side = S.tasks.map(function (t, i) {
      var mark = t.selfGrade ? '<span class="' + gradeClass(t.selfGrade) + '">' + gradeSym(t.selfGrade) + "</span>"
        : '<span style="color:var(--fg-dim)">·</span>';
      return '<div class="titem' + (i === idx ? " active" : "") + '" data-ti="' + i + '"><span class="tno">' + (i + 1) + "</span>"
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((Q_MAP[t.qid] ? eq(Q_MAP[t.qid]).title : t.qid)) + "</span>"
        + '<span class="tst">' + mark + "</span></div>";
    }).join("");
    var vmConn = !!(global.Bridge && global.Bridge.connected);
    var autoCount = S.tasks.filter(function (t) { var qq = Q_MAP[t.qid]; return qq && qq.autoGradeReady; }).length;
    var submitButtons = '<div style="padding:8px;display:flex;flex-direction:column;gap:6px">'
      + (vmConn
        ? '<button data-role="vmsubmit" class="primary" style="width:100%">Grade all on VM and submit</button>'
          + '<div style="font-size:11px;color:var(--fg-dim);text-align:center">VM-auto: ' + autoCount + " / " + S.tasks.length + " tasks<br>the rest use your ○△× self-grade</div>"
        : '<div style="font-size:11px;color:var(--fg-dim);text-align:center">● VM offline - batch VM grading disabled<br>start vmbridge.py to enable it</div>')
      + '<button data-role="submit" class="danger" style="width:100%">' + (vmConn ? "Submit with self-grade only" : "Grade and submit") + "</button></div>";
    var html = '<div class="pagehead"><h1>' + esc(examName(exam)) + "</h1>"
      + '<span class="badge">Task ' + (idx + 1) + " / " + S.tasks.length + "</span>"
      + '<span class="badge">' + task.points + " points</span></div>"
      + '<div class="exam-layout"><div class="task-sidebar">' + side + submitButtons + "</div><div>"
      + questionInteractiveHTML(q, task, "exam")
      + '<div class="navrow">'
      + (idx > 0 ? '<button data-role="prev" data-nav="prev">← Previous</button>' : "")
      + '<span class="spacer"></span>'
      + (idx < S.tasks.length - 1
        ? '<button data-role="next" data-nav="next" class="primary">Next →</button>'
        : (vmConn ? '<button data-role="vmsubmit2" class="primary">Grade all on VM and submit</button>'
          : '<button data-role="submit2" class="danger">Grade and submit</button>'))
      + "</div></div></div>";
    return {
      html: html, bind: function (root) {
        bindQuestionInteractive(root, q, {
          state: task, mode: "exam",
          onGrade: function (g) {
            task.selfGrade = g;
            try { Progress.recordQuestion(q.id, g, "exam:" + examId); } catch (e) {}
            App.saveExam(); markSidebar(root, idx, task);
          }
        });
        root.querySelectorAll(".titem").forEach(function (it) {
          it.onclick = function () { S.index = parseInt(it.getAttribute("data-ti"), 10); App.saveExam(); App.render(); };
        });
        var prev = root.querySelector("[data-role=prev]");
        if (prev) prev.onclick = function () { S.index--; App.saveExam(); App.render(); };
        var next = root.querySelector("[data-role=next]");
        if (next) next.onclick = function () { S.index++; App.saveExam(); App.render(); };
        function selfSubmit() {
          if (global.confirm("Submit with your self-grade (○△×) results? This cannot be undone.")) App.finalizeExam({ mode: "self" });
        }
        function vmSubmit() {
          if (global.confirm("Grade every task on the VM and submit.\n\n- autoGradeReady tasks are checked over SSH\n- other tasks use your ○△× self-grade\n- do not close the tab while grading\n- takes tens of seconds to a few minutes\n\nContinue?")) App.finalizeExam({ mode: "vm-batch" });
        }
        var sb = root.querySelector("[data-role=submit]"); if (sb) sb.onclick = selfSubmit;
        var sb2 = root.querySelector("[data-role=submit2]"); if (sb2) sb2.onclick = selfSubmit;
        var vsb = root.querySelector("[data-role=vmsubmit]"); if (vsb) vsb.onclick = vmSubmit;
        var vsb2 = root.querySelector("[data-role=vmsubmit2]"); if (vsb2) vsb2.onclick = vmSubmit;
      }
    };
  }
  function examResult() {
    var r = App.lastExamResult;
    if (!r) {
      var exams = Progress.getExams();
      if (!exams.length) return notFound("No exam records yet.");
      r = exams[exams.length - 1];
    }
    function sourceCell(t) {
      if (t.source === "vm-auto" && t.vmGrade && t.vmGrade.max > 0) {
        var ratio = t.vmGrade.earned / t.vmGrade.max;
        var cls = ratio >= 1 ? "perfect" : ratio > 0 ? "partial" : "zero";
        var mark = ratio >= 1 ? "○" : ratio > 0 ? "△" : "×";
        return '<div class="judgement ' + cls + '" title="VM SSH grading"><div class="big-mark">' + mark + '</div>'
          + '<div class="src-tag">VM ' + t.vmGrade.earned + "/" + t.vmGrade.max + "</div></div>";
      }
      if (t.source === "vm-error") {
        var cls2 = t.selfGrade === "correct" ? "perfect" : t.selfGrade === "partial" ? "partial" : t.selfGrade === "wrong" ? "zero" : "none";
        return '<div class="judgement ' + cls2 + '" title="VM grading failed, used self-grade"><div class="big-mark">' + gradeSym(t.selfGrade) + '</div><div class="src-tag warn">⚠ VM failed</div></div>';
      }
      var cls3 = t.selfGrade === "correct" ? "perfect" : t.selfGrade === "partial" ? "partial" : t.selfGrade === "wrong" ? "zero" : "none";
      return '<div class="judgement ' + cls3 + '" title="self-grade"><div class="big-mark">' + gradeSym(t.selfGrade) + '</div><div class="src-tag">self</div></div>';
    }
    var rows = r.results.map(function (t, i) {
      var q = Q_MAP[t.qid] ? eq(Q_MAP[t.qid]) : null;
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(q ? q.categoryLabel : "") + "</td><td>" + esc(q ? q.title : t.qid) + "</td>"
        + '<td style="text-align:center">' + sourceCell(t) + '</td><td style="text-align:right">' + t.earned + " / " + t.points + "</td></tr>";
    }).join("");
    var catAgg = {};
    r.results.forEach(function (t) { var q = Q_MAP[t.qid]; if (!q) return; if (!catAgg[q.category]) catAgg[q.category] = { e: 0, p: 0 }; catAgg[q.category].e += t.earned; catAgg[q.category].p += t.points; });
    var catRows = Object.keys(catAgg).map(function (slug) {
      var a = catAgg[slug]; var pct = a.p ? Math.round(a.e / a.p * 100) : 0;
      return '<div class="cat-stat"><span>' + esc(catName(slug)) + '</span><div class="bar"><span style="width:' + pct + '%"></span></div><span>' + a.e + "/" + a.p + "</span></div>";
    }).join("");
    var passed = r.passed;
    var modeLabel = r.gradeMode === "vm-batch"
      ? ' <span class="badge badge-vm">VM batch grading</span>'
      : r.gradeMode === "self" ? ' <span class="badge">self-graded</span>' : "";
    var weakIds = r.results.filter(function (t) { return t.earned < t.points; }).map(function (t) { return t.qid; });
    var reviewBtn = weakIds.length ? '<button class="primary" data-role="review-weak">↺ Review the ' + weakIds.length + " weak spots from this exam</button>" : "";
    var html = "<h1>" + esc(examName(r)) + " - results" + modeLabel + "</h1>"
      + '<div class="verdict ' + (passed ? "pass" : "fail") + '">' + (passed ? "PASS" : "FAIL") + " &nbsp; " + r.score + " / " + r.totalScore + " &nbsp;(pass line " + r.passScore + ")</div>"
      + '<p class="subtitle">Time: ' + fmtDur(r.durationSec) + " &nbsp;|&nbsp; VM = real SSH grading / ○ = full / △ = half / × or ungraded = 0</p>"
      + (weakIds.length
        ? '<div class="exam-review-cta"><div class="cta-text"><strong>Next</strong> &nbsp;Run the ' + weakIds.length + " questions you did not ace as a review session.</div>" + reviewBtn + "</div>"
        : '<div class="exam-review-cta cta-perfect">🏆 Full marks. Try another mock exam next.</div>')
      + "<h2>By category</h2>" + catRows
      + "<h2>Task breakdown</h2><table class=\"result-table\"><thead><tr><th>#</th><th>Category</th><th>Title</th><th>Result</th><th>Score</th></tr></thead><tbody>" + rows + "</tbody></table>"
      + '<div class="navrow">' + reviewBtn + '<button data-hash="#exam">Back to exams</button><button data-hash="#history">Review</button><span class="spacer"></span><button class="primary" data-hash="#home">Home</button></div>';
    return {
      html: html, bind: function (root) {
        root.querySelectorAll("[data-role=review-weak]").forEach(function (btn) {
          btn.onclick = function () {
            if (!weakIds.length) return;
            App.session = { mode: "review", label: "Review (" + examName(r) + " weak spots)", baseHash: "#exam-result", list: weakIds.slice() };
            location.hash = "#q/" + weakIds[0];
          };
        });
      }
    };
  }
  function examRunGuarded(examId) {
    var S = App.examSession;
    if (S && !S.submitted && S.examId !== examId) {
      if (!global.confirm("Another exam (" + examName(S) + ") is in progress. Discard it and start a new one?")) {
        location.hash = "#exam-run/" + S.examId; return null;
      }
      App.examSession = null; App.stopTimer(); App.saveExam();
    }
    return examRun(examId);
  }

  // ---- guides ----
  function GUIDES_DATA() { return (typeof GUIDES !== "undefined" && GUIDES) || []; }
  function guideEn(slug) { return (global.GUIDES_EN && global.GUIDES_EN[slug]) || null; }
  function guideTitle(g) { var e = guideEn(g.slug); return (e && e.title_en) || g.title; }
  function guidesList() {
    var rows = GUIDES_DATA().map(function (g) {
      return '<a class="qrow en-qrow" href="#guide/' + esc(g.slug) + '"><span class="qid">' + esc(g.slug.split("-")[0]) + "</span>"
        + '<span class="qtitle">' + esc(guideTitle(g)) + "</span>"
        + (guideEn(g.slug) ? "" : '<span class="badge">JA</span>') + "</a>";
    }).join("");
    return { html: "<h1>Study guides</h1>"
      + '<p class="subtitle">Cheat sheets per objective: commands, common patterns, and exam tips.</p>'
      + '<div class="qlist">' + rows + "</div>", bind: null };
  }
  function guide(slug) {
    var g = null;
    GUIDES_DATA().forEach(function (x) { if (x.slug === slug) g = x; });
    if (!g) return notFound("Unknown guide: " + slug);
    var e = guideEn(slug);
    var bodyHtml = (e && e.html_en) || g.html;
    var jaNote = e ? "" : '<div class="ag-msg">Not yet translated - shown in Japanese.</div>';
    return { html: '<div class="crumbs"><a href="#guides">Study guides</a> / ' + esc(guideTitle(g)) + "</div>"
      + jaNote + '<div class="md guide-body">' + bodyHtml + "</div>"
      + '<div class="navrow"><button data-hash="#guides">Back to guides</button><span class="spacer"></span><button class="primary" data-hash="#home">Home</button></div>', bind: null };
  }

  // ---- copy buttons on <pre> (matches the Japanese app) ----
  function attachCopyButtons(root) {
    if (!root || !navigator.clipboard) return;
    root.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".code-copy-btn")) return;
      pre.classList.add("code-with-copy");
      var btn = document.createElement("button");
      btn.className = "code-copy-btn"; btn.type = "button";
      btn.textContent = "Copy"; btn.title = "Copy to clipboard";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var code = pre.querySelector("code");
        var text = (code ? code.innerText : pre.innerText).replace(/^\s*Copy\s*$/m, "").trim();
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied"; btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500);
        }).catch(function () { btn.textContent = "Failed"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); });
      });
      pre.appendChild(btn);
    });
  }

  // ---- App: routing, mount, bridge status ----
  var App = {
    session: null,
    mount: function (res) {
      var app = document.getElementById("app");
      app.innerHTML = res.html;
      app.querySelectorAll("[data-hash]").forEach(function (el) {
        el.addEventListener("click", function () { location.hash = el.getAttribute("data-hash"); });
      });
      if (res.bind) res.bind(app);
      attachCopyButtons(app);
    },
    render: function () {
      var hash = location.hash.replace(/^#/, "") || "home";
      var parts = hash.split("/");
      var route = parts[0];
      setActiveNav(route);
      var res;
      try {
        switch (route) {
          case "home": res = home(); break;
          case "drill": res = parts[1] ? drillList(parts[1]) : drillGrid(); break;
          case "q": res = question(parts[1]); break;
          case "history": res = review(); break;
          case "random": res = randomSetup(parts[1]); break;
          case "guides": res = guidesList(); break;
          case "guide": res = guide(parts.slice(1).join("/")); break;
          case "exam": res = examList(); break;
          case "exam-run": res = examRunGuarded(parts[1]); break;
          case "exam-result": res = examResult(); break;
          default: res = notFound("Unknown page: " + hash);
        }
      } catch (e) {
        res = notFound("Render error: " + e.message);
      }
      if (res && res.html != null) App.mount(res);
      App.updateTimerDisplay();
      window.scrollTo(0, 0);
    }
  };
  global.App = App;

  // ---- exam session, timer, finalize (ported from main.js, English) ----
  var EXAM_KEY = "rhcsa10_en_examsession_v1";
  App.examSession = null;
  App.lastExamResult = null;
  App._timerId = null;
  App.startExam = function (exam) {
    var now = Date.now();
    App.examSession = {
      examId: exam.id, name: examName(exam),
      startedAt: now, endsAt: now + exam.timeLimit * 1000, timeLimit: exam.timeLimit,
      totalScore: exam.totalScore, passScore: exam.passScore, index: 0, submitted: false,
      tasks: exam.tasks.map(function (t) { return { qid: t.questionId, points: t.points, selfGrade: null }; })
    };
    App.saveExam(); App.startTimer();
  };
  App.saveExam = function () {
    try {
      if (App.examSession) global.sessionStorage.setItem(EXAM_KEY, JSON.stringify(App.examSession));
      else global.sessionStorage.removeItem(EXAM_KEY);
    } catch (e) {}
  };
  App.restoreExam = function () {
    try {
      var raw = global.sessionStorage.getItem(EXAM_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && !s.submitted && Date.now() < s.endsAt) { App.examSession = s; App.startTimer(); }
      else global.sessionStorage.removeItem(EXAM_KEY);
    } catch (e) {}
  };
  App.startTimer = function () {
    App.stopTimer();
    App._timerId = global.setInterval(function () {
      if (!App.examSession || App.examSession.submitted) { App.stopTimer(); return; }
      if (Date.now() >= App.examSession.endsAt) { App.finalizeExam({ timeout: true, mode: "self" }); return; }
      App.updateTimerDisplay();
    }, 1000);
  };
  App.stopTimer = function () { if (App._timerId) { global.clearInterval(App._timerId); App._timerId = null; } };
  App.updateTimerDisplay = function () {
    var timerEl = document.getElementById("exam-timer");
    if (!timerEl) return;
    var S = App.examSession;
    if (!S || S.submitted) { timerEl.classList.add("hidden"); timerEl.innerHTML = ""; timerEl._examId = null; return; }
    var rem = Math.max(0, Math.floor((S.endsAt - Date.now()) / 1000));
    var h = Math.floor(rem / 3600), m = Math.floor((rem % 3600) / 60), s = rem % 60;
    var txt = (h > 0 ? h + ":" : "") + (h > 0 && m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    if (timerEl._examId !== S.examId) {
      timerEl._examId = S.examId;
      timerEl.innerHTML = '<span class="t-text" title="Back to the exam screen"></span><button class="t-abandon" title="Abort and discard this exam">✕</button>';
      timerEl.querySelector(".t-text").addEventListener("click", function () { if (App.examSession) location.hash = "#exam-run/" + App.examSession.examId; });
      timerEl.querySelector(".t-abandon").addEventListener("click", function () { App.abandonExam(); });
    }
    timerEl.querySelector(".t-text").textContent = "⏱ " + txt + " - " + S.name;
    timerEl.classList.remove("hidden", "warn", "danger");
    if (rem <= 300) timerEl.classList.add("danger");
    else if (rem <= 900) timerEl.classList.add("warn");
  };
  App.abandonExam = function () {
    var S = App.examSession;
    if (!S) return;
    if (!global.confirm("Abort and discard the exam in progress (" + S.name + ")? Your answers will not be saved.")) return;
    App.examSession = null; App.stopTimer(); App.saveExam(); App.updateTimerDisplay();
    var route = location.hash.replace(/^#/, "").split("/")[0];
    if (route === "exam-run") location.hash = "#exam"; else App.render();
  };
  App.finalizeExam = function (opts) {
    opts = opts || {};
    var auto = !!opts.timeout;
    var mode = opts.mode || "self";
    var S = App.examSession;
    if (!S || S.submitted) return;
    if (mode === "vm-batch" && global.Bridge && global.Bridge.connected) { App._vmBatchGrade(S, auto); return; }
    App._completeExam(S, auto, mode);
  };
  App._vmBatchGrade = function (S, auto) {
    var tasks = S.tasks, total = tasks.length, i = 0, gradedVm = 0, skippedSelf = 0, errors = 0;
    App._showGradingOverlay(0, total);
    function next() {
      if (i >= total) { App._hideGradingOverlay(); App._completeExam(S, auto, "vm-batch", { gradedVm: gradedVm, skippedSelf: skippedSelf, errors: errors }); return; }
      var t = tasks[i];
      var q = Q_MAP[t.qid];
      var label = q ? eq(q).title : t.qid;
      App._updateGradingOverlay(i, total, label);
      if (!q || !q.autoGradeReady) { skippedSelf++; i++; setTimeout(next, 0); return; }
      global.Bridge.grade(t.qid, "live").then(function (br) {
        var sc = global.Grader.score(q, br);
        t.vmGrade = { earned: sc.earned, max: sc.max };
        try { Progress.recordAutoGradeAndSync(t.qid, sc, { ctx: "vm-batch" }); } catch (e) {}
        gradedVm++;
      }).catch(function (e) { t.vmGradeError = (e && e.message) || String(e); errors++; })
        .then(function () { i++; App.saveExam(); App._updateGradingOverlay(i, total, label); setTimeout(next, 80); });
    }
    next();
  };
  App._completeExam = function (S, auto, mode, summary) {
    S.submitted = true; App.stopTimer();
    var results = S.tasks.map(function (t) {
      var earned = 0, source = "self";
      if (t.vmGrade && typeof t.vmGrade.earned === "number" && t.vmGrade.max > 0) {
        earned = Math.round(t.vmGrade.earned / t.vmGrade.max * t.points); source = "vm-auto";
      } else if (t.vmGradeError) {
        source = "vm-error";
        if (t.selfGrade === "correct") earned = t.points; else if (t.selfGrade === "partial") earned = Math.round(t.points / 2);
      } else {
        if (t.selfGrade === "correct") earned = t.points; else if (t.selfGrade === "partial") earned = Math.round(t.points / 2);
      }
      return { qid: t.qid, points: t.points, selfGrade: t.selfGrade, vmGrade: t.vmGrade || null, vmGradeError: t.vmGradeError || null, source: source, earned: earned };
    });
    var score = results.reduce(function (a, r) { return a + r.earned; }, 0);
    var durationSec = Math.min(S.timeLimit, Math.max(0, Math.round((Date.now() - S.startedAt) / 1000)));
    var rec = {
      examId: S.examId, name: S.name, durationSec: durationSec,
      totalScore: S.totalScore, passScore: S.passScore, score: score, passed: score >= S.passScore,
      auto: !!auto, gradeMode: mode, gradeSummary: summary || null, results: results
    };
    try { Progress.recordExam(rec); } catch (e) {}
    App.lastExamResult = rec; App.examSession = null; App.saveExam(); App.updateTimerDisplay();
    if (auto) global.alert("Time is up. The exam was graded and submitted automatically.");
    if (location.hash === "#exam-result") App.render(); else location.hash = "#exam-result";
  };
  App._showGradingOverlay = function (done, total) {
    var ov = document.getElementById("grading-overlay");
    if (!ov) {
      ov = document.createElement("div"); ov.id = "grading-overlay";
      ov.innerHTML = '<div class="grading-box"><div class="grading-title">Grading on the VM…</div>'
        + '<div class="grading-progress"><span></span></div><div class="grading-status"></div>'
        + '<div class="grading-note">This takes tens of seconds to a few minutes. Do not close the tab.</div></div>';
      document.body.appendChild(ov);
    }
    App._updateGradingOverlay(done, total, "");
  };
  App._updateGradingOverlay = function (done, total, label) {
    var ov = document.getElementById("grading-overlay");
    if (!ov) return;
    var pct = total ? Math.round(done / total * 100) : 0;
    ov.querySelector(".grading-progress span").style.width = pct + "%";
    ov.querySelector(".grading-status").textContent = done + " / " + total + " done" + (label ? " (" + label + ")" : "");
  };
  App._hideGradingOverlay = function () { var ov = document.getElementById("grading-overlay"); if (ov) ov.parentNode.removeChild(ov); };

  var NAV_MAP = { home: "home", drill: "drill", random: "drill", q: "drill", history: "history", guides: "guides", guide: "guides", exam: "exam", "exam-run": "exam", "exam-result": "exam" };
  function setActiveNav(route) {
    var target = NAV_MAP[route] || "";
    document.querySelectorAll("#topnav a").forEach(function (a) {
      var h = (a.getAttribute("href") || "").replace(/^#/, "").split("/")[0];
      if (h === target) a.classList.add("active"); else a.classList.remove("active");
    });
  }

  function updateBridgeStatus() {
    var s = document.getElementById("bridge-status");
    if (!s) return;
    if (Bridge.connected) { s.className = "bridge-status up"; s.textContent = "● VM connected"; }
    else if (Bridge.bridgeUp) { s.className = "bridge-status warn"; s.textContent = "● VM unreachable"; }
    else { s.className = "bridge-status down"; s.textContent = "● VM offline"; }
  }
  function pollBridge() { if (typeof Bridge !== "undefined") Bridge.checkStatus().then(updateBridgeStatus); }

  window.addEventListener("hashchange", function () { App.render(); });
  document.addEventListener("DOMContentLoaded", function () {
    App.restoreExam(); App.render(); pollBridge(); setInterval(pollBridge, 15000);
  });
})(window);
