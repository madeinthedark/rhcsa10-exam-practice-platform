/* grader.js — score aggregation
   Takes the per-check exitCode returned by the bridge, matches it against the
   question's grader definition (from questions.js), and computes perCheck / earned / max.
   Exit code 0 = pass. */
(function (global) {
  "use strict";

  var Grader = {
    /* question: a single entry from QUESTIONS
       bridgeResult: { questionId, phase, results:[{id,exitCode}] }
       return value: { phase, perCheck:[{id,label,scope,passed,score,earned,exitCode}], earned, max } */
    score: function (question, bridgeResult) {
      var phase = (bridgeResult && bridgeResult.phase) || "live";
      var checks = (question.grader && question.grader.checks) || [];
      var byId = {};
      ((bridgeResult && bridgeResult.results) || []).forEach(function (r) {
        byId[r.id] = r;
      });
      var perCheck = [];
      var earned = 0, max = 0;
      checks.forEach(function (c) {
        var scope = c.scope || "live";          // default to "live" to match the bridge (c.get("scope","live"))
        if (scope !== phase) return;            // only aggregate checks for the requested phase
        var res = byId[c.id];
        var passed = !!res && res.exitCode === 0;
        var sc = (typeof c.score === "number") ? c.score : 0;
        max += sc;
        if (passed) earned += sc;
        perCheck.push({
          id: c.id, label: c.label || c.id, scope: scope,
          passed: passed, score: sc, earned: passed ? sc : 0,
          exitCode: res ? res.exitCode : null
        });
      });
      return { phase: phase, perCheck: perCheck, earned: earned, max: max };
    },

    /* Whether this question has any reboot-scope checks */
    hasRebootChecks: function (question) {
      var checks = (question.grader && question.grader.checks) || [];
      return checks.some(function (c) { return c.scope === "reboot"; });
    }
  };

  global.Grader = Grader;
})(window);
