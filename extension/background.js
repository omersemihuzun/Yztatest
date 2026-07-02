// ============================================================
// LearnSphere Extension — Background Service Worker
// Content script'ten gelen mesajları alır ve n8n'e POST atar.
// Content script'in bizzat fetch yapması CORS sorununa yol açar,
// bu yüzden tüm network çağrıları buradan yapılır.
// ============================================================

const SEND_QUEUE = [];
let isSending = false;

/**
 * Mesaj kuyruğunu sırayla işler (seri gönderim, spam yapmaz).
 */
async function processQueue() {
  if (isSending || SEND_QUEUE.length === 0) return;
  isSending = true;

  const payload = SEND_QUEUE.shift();

  try {
    const response = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.data),
    });

    if (!response.ok) {
      throw new Error(`n8n HTTP ${response.status}: ${response.statusText}`);
    }

    console.log(`[LearnSphere BG] ✅ Başarıyla gönderildi → ${payload.data.platform}`);
  } catch (error) {
    console.error("[LearnSphere BG] ❌ Gönderim başarısız:", error.message);
    // Retry: Hatalı mesajı kuyruğun sonuna geri koy (max 3 deneme)
    if ((payload.retryCount || 0) < 3) {
      SEND_QUEUE.push({ ...payload, retryCount: (payload.retryCount || 0) + 1 });
      console.warn(`[LearnSphere BG] 🔄 Yeniden deneme kuyruğa eklendi (${payload.retryCount + 1}/3)`);
    } else {
      console.error("[LearnSphere BG] ⛔ Maksimum deneme sayısına ulaşıldı, mesaj düşürüldü.");
    }
  } finally {
    isSending = false;
    // Kuyrukta başka mesaj varsa devam et
    if (SEND_QUEUE.length > 0) {
      setTimeout(processQueue, 500);
    }
  }
}

// Content script'ten gelen "SEND_TO_BACKEND" mesajlarını dinle
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SEND_TO_BACKEND") {
    SEND_QUEUE.push({
      webhookUrl: message.backendUrl,
      data: message.data,
      retryCount: 0,
    });
    processQueue();
    sendResponse({ status: "queued" });
  }
  return true;
});
