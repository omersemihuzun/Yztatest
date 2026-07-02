// ============================================================
// LearnSphere Extension — PII (Kişisel Veri) Filtresi
// Hassas bilgileri gönderilmeden önce temizler.
// ============================================================

const PII_PATTERNS = [
  // Şifre ifadeleri
  { pattern: /(?:şifre(?:m|si|niz)?|password|parola)\s*[:=]?\s*\S+/gi, replacement: "[ŞİFRE GİZLENDİ]" },

  // TC Kimlik Numarası (11 haneli)
  { pattern: /\b[1-9][0-9]{10}\b/g, replacement: "[TC KİMLİK GİZLENDİ]" },

  // Kredi Kartı (13-19 haneli, boşluklu/tiresiz)
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[KART NO GİZLENDİ]" },

  // E-posta adresleri
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[E-POSTA GİZLENDİ]" },

  // Türkiye'ye özgü telefon numaraları
  { pattern: /(?:\+90|0090|0)?\s*(?:\d{3,4})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g, replacement: "[TELEFON GİZLENDİ]" },

  // API key / Token benzeri uzun alfanumerik diziler (30+ karakter)
  { pattern: /\b[A-Za-z0-9_\-]{30,}\b/g, replacement: "[TOKEN/ANAHTAR GİZLENDİ]" },
];

/**
 * Metindeki PII'yı temizler ve temizlenmiş versiyonu döner.
 * @param {string} text - Ham metin
 * @returns {string} - PII'sı temizlenmiş metin
 */
function sanitizePII(text) {
  if (!text || typeof text !== "string") return "";
  let sanitized = text;
  PII_PATTERNS.forEach(({ pattern, replacement }) => {
    sanitized = sanitized.replace(pattern, replacement);
  });
  return sanitized;
}
