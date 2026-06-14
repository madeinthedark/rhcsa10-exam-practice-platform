/* chat_en.js — English AI tutor chat. Talks to the same vmbridge /chat endpoint
   as the Japanese app, but asks for English replies. The bridge builds its system
   prompt server-side (in Japanese) from the question context; this module appends a
   short English instruction to the latest user turn so the model answers in English.
   No Japanese-build file is touched. History is stored under a separate key so it
   never mixes with the Japanese app's chat. */
(function (global) {
  "use strict";

  var BASE = (typeof global.RHCSA_BRIDGE_BASE === "string" && global.RHCSA_BRIDGE_BASE) || "http://127.0.0.1:8770";
  var KEY = "rhcsa10_en_chat_v1";
  var MAX_TURNS_PER_QID = 40;
  // Prepended to the latest user message sent to the model (not shown in the UI).
  // Prepended (not appended) so the bridge's per-message content[:8000] cap, which
  // truncates from the END, cannot drop it on long pastes.
  var EN_INSTRUCTION = "[Respond ENTIRELY in English. Do not answer in Japanese. If the reference context is in Japanese, translate any quoted text into English.]\n\n";

  function loadAll() { try { return JSON.parse(global.localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveAll(data) { try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
  function getHistory(qid) { return (loadAll()[qid] || []).slice(); }
  function setHistory(qid, history) { var all = loadAll(); all[qid] = history.slice(-MAX_TURNS_PER_QID); saveAll(all); }
  function clearHistory(qid) { var all = loadAll(); delete all[qid]; saveAll(all); }

  function send(opts) {
    var qid = opts.qid;
    var mode = opts.mode || "explain";
    var userText = (opts.userText || "").trim();
    if (!userText) { opts.onError && opts.onError("The message is empty."); return; }

    var history = getHistory(qid);
    history.push({ role: "user", content: userText, at: Date.now(), mode: mode });
    setHistory(qid, history);

    var token = (global.Bridge && global.Bridge.token) || "";
    // Build the API messages from the stored turns, then append the English
    // instruction to the LAST user message only (the stored/displayed text is unchanged).
    var apiMessages = history.map(function (m) { return { role: m.role, content: m.content }; });
    for (var i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === "user") { apiMessages[i].content = EN_INSTRUCTION + apiMessages[i].content; break; }
    }
    var body = JSON.stringify({ questionId: qid, mode: mode, messages: apiMessages });

    var fullReply = "";
    var assistantPlaceholder = { role: "assistant", content: "", at: Date.now(), mode: mode, streaming: true };
    history.push(assistantPlaceholder);
    setHistory(qid, history);

    fetch(BASE + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RHCSA-Bridge-Token": token },
      body: body
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) {
          var msg = "HTTP " + resp.status;
          try { msg = JSON.parse(t).error || msg; } catch (e) {}
          throw new Error(msg);
        });
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var sseBuf = "";
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            assistantPlaceholder.streaming = false;
            // The bridge sends API-level failures as a 200 + SSE "[ERROR] ..." chunk.
            // Surface those through onError instead of rendering them as the tutor's answer.
            if (/^\s*\[ERROR\]/.test(fullReply)) {
              var eidx = history.indexOf(assistantPlaceholder);
              if (eidx >= 0) history.splice(eidx, 1);
              setHistory(qid, history);
              opts.onError && opts.onError(fullReply.replace(/^\s*\[ERROR\]\s*/, "") || "chat error");
              return;
            }
            assistantPlaceholder.content = fullReply;
            setHistory(qid, history);
            opts.onDone && opts.onDone(fullReply);
            return;
          }
          sseBuf += decoder.decode(chunk.value, { stream: true });
          var parts = sseBuf.split("\n\n");
          sseBuf = parts.pop();
          parts.forEach(function (block) {
            block.split("\n").forEach(function (line) {
              if (line.indexOf("data: ") !== 0) return;
              try {
                var obj = JSON.parse(line.slice(6));
                if (typeof obj.text === "string") {
                  fullReply += obj.text;
                  assistantPlaceholder.content = fullReply;
                  opts.onChunk && opts.onChunk(obj.text);
                }
              } catch (e) {}
            });
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      var idx = history.indexOf(assistantPlaceholder);
      if (idx >= 0) history.splice(idx, 1);
      setHistory(qid, history);
      opts.onError && opts.onError(err.message || String(err));
    });
  }

  global.ChatEn = {
    BASE: BASE,
    getHistory: getHistory,
    clearHistory: clearHistory,
    send: send,
    isReady: function () {
      return !!(global.Bridge && global.Bridge.bridgeUp && global.Bridge.info && global.Bridge.info.chat);
    }
  };
})(window);
