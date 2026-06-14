/* bridge.js — SSH bridge client
   Communicates with vmbridge.py (http://127.0.0.1:8770) to check VM reachability and perform live grading.
   When the bridge is not running or the VM is unreachable, connected=false and the UI falls back to self-grading. */
(function (global) {
  "use strict";

  // The base URL can be overridden by defining `window.RHCSA_BRIDGE_BASE = "http://127.0.0.1:NNNN"`
  // in index.html. The default is 8770, the same as in vmbridge.config.example.json.
  var BASE = (typeof global.RHCSA_BRIDGE_BASE === "string"
    && global.RHCSA_BRIDGE_BASE) || "http://127.0.0.1:8770";

  var Bridge = {
    bridgeUp: false,    // whether vmbridge.py was reachable
    connected: false,   // whether the VM (SSH) was also reachable
    token: null,
    info: null,

    /* Calls /status to refresh the state. Always resolves (never throws, even on failure). */
    checkStatus: function () {
      return fetch(BASE + "/status", { method: "GET" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          Bridge.bridgeUp = true;
          Bridge.connected = !!(d && d.ok);
          Bridge.token = (d && d.token) || null;
          Bridge.info = d || null;
          return d;
        })
        .catch(function () {
          Bridge.bridgeUp = false;
          Bridge.connected = false;
          Bridge.token = null;
          Bridge.info = null;
          return null;
        });
    },

    /* Performs live grading for a single question. phase = "live" | "reboot".
       Returns: Promise<{ questionId, phase, results:[{id,exitCode}] }>. Rejects on failure. */
    grade: function (questionId, phase) {
      return fetch(BASE + "/grade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RHCSA-Bridge-Token": Bridge.token || ""
        },
        body: JSON.stringify({ questionId: questionId, phase: phase || "live" })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
          return d;
        });
      });
    }
  };

  global.Bridge = Bridge;
})(window);
