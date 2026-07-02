// ============================================================
// LearnSphere Extension — Content Script
// Ekip arkadasinin n8n yaklasimi gibi: sayfadaki TUM mesajlari
// aninda yakala, her soru-cevap cifti ayri kart olsun.
// ============================================================

(function () {
  "use strict";

  const PLATFORM = window.location.hostname.includes("chatgpt.com")
    ? "ChatGPT"
    : window.location.hostname.includes("gemini.google.com")
    ? "Gemini"
    : null;

  if (!PLATFORM) return;

  // Gonderilmis hash seti — sayfa yasam suresi boyunca tekrar gonderme
  const sentHashes = new Set();
  let debounceTimer = null;

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  // "Siz sunu dediniz:" gibi Gemini UI prefix temizligi
  function cleanText(text) {
    return text
      .replace(/^(Siz\s+[sş]unu\s+dediniz\s*:?\s*)/i, '')
      .replace(/^(You\s+said\s*:?\s*)/i, '')
      .replace(/^\s*\n+/, '')
      .trim();
  }

  // ---- Gemini DOM Secicileri (birden fazla alternatif dene) ----
  function extractFromGemini() {
    // Gemini hala dusunuyorsa bekleme
    const isLoading = document.querySelector(
      'mat-progress-bar, .loading-indicator, [aria-label*="thinking"], model-response.pending'
    );
    if (isLoading) return null;

    // Kullanici mesajlari — farkli Gemini versiyonlarina gore alternatifler
    const userSelectors = [
      "user-query .query-text",
      "user-query",
      ".user-query-text",
      "[data-message-role='user']",
      ".user-message",
    ];
    const botSelectors = [
      "model-response .markdown",
      "message-content .markdown",
      "model-response",
      "message-content",
      "[data-message-role='model']",
      ".model-response-text",
    ];

    let userEls = [];
    let botEls = [];

    for (const sel of userSelectors) {
      userEls = Array.from(document.querySelectorAll(sel));
      if (userEls.length > 0) break;
    }
    for (const sel of botSelectors) {
      botEls = Array.from(document.querySelectorAll(sel));
      if (botEls.length > 0) break;
    }

    if (userEls.length === 0 || botEls.length === 0) return null;

    const pairs = [];
    const minLen = Math.min(userEls.length, botEls.length);
    for (let i = 0; i < minLen; i++) {
      const question = cleanText(userEls[i].innerText || "");
      const answer = (botEls[i].innerText || "").trim();
      if (question.length > 3 && answer.length > 50) {
        pairs.push({ question, answer });
      }
    }
    return pairs.length > 0 ? pairs : null;
  }

  // ---- ChatGPT ----
  function extractFromChatGPT() {
    if (document.querySelector('[data-testid="stop-button"]')) return null;

    const userEls = document.querySelectorAll('[data-message-author-role="user"]');
    const botEls  = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!userEls.length || !botEls.length) return null;

    const pairs = [];
    const minLen = Math.min(userEls.length, botEls.length);
    for (let i = 0; i < minLen; i++) {
      const question = (userEls[i].innerText || "").trim();
      const answer   = (botEls[i].innerText || "").trim();
      if (question && answer.length > 50) {
        pairs.push({ question, answer });
      }
    }
    return pairs.length > 0 ? pairs : null;
  }

  // ---- Gonder ----
  function sendPair(pair) {
    const cleanPair = {
      question: sanitizePII(pair.question),
      answer: sanitizePII(pair.answer),
    };

    const hash = simpleHash(cleanPair.question + cleanPair.answer);
    if (sentHashes.has(hash)) return false;
    sentHashes.add(hash);

    const sessionId = `${PLATFORM}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payload = {
      platform: PLATFORM,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      data: cleanPair,
    };

    // Extension context gecerliligi kontrolu
    if (!chrome.runtime?.id) {
      console.warn("[LearnSphere] Extension context invalidated. Sayfa yenilenince tekrar calisacak.");
      return false;
    }

    try {
      chrome.runtime.sendMessage({
        type: "SEND_TO_BACKEND",
        backendUrl: LS_CONFIG.BACKEND_URL,
        data: payload,
      });
    } catch (e) {
      // Extension yenilendikten sonra sayfa yenilenmemisse bu hata olusur
      console.warn("[LearnSphere] Gonderi hatasi (sayfayi yenile):", e.message);
      return false;
    }
    return true;
  }

  function captureAndSend() {
    const pairs = PLATFORM === "ChatGPT" ? extractFromChatGPT() : extractFromGemini();
    if (!pairs) return;
    let sent = 0;
    for (const pair of pairs) {
      if (sendPair(pair)) sent++;
    }
    if (sent > 0 && LS_CONFIG.DEBUG) {
      console.log(`[LearnSphere] ${sent} yeni mesaj gonderildi.`);
    }
  }

  function debouncedCapture() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(captureAndSend, LS_CONFIG.DEBOUNCE_DELAY_MS);
  }

  // --- Sayfa yuklendiginde HEMEN mevcut mesajlari gonder ---
  setTimeout(() => {
    captureAndSend(); // ilk tarama

    // Sonraki degisiklikleri izle
    const observer = new MutationObserver(debouncedCapture);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
    });

    if (LS_CONFIG.DEBUG) {
      console.log(`[LearnSphere] ${PLATFORM} izleniyor. Mevcut mesajlar taranadi.`);
    }
  }, 3000); // 3sn — Gemini SPA tam yuklenmesi icin

})();
