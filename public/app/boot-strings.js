// The only on-screen text that lives in the page itself: what is shown BEFORE the server has answered, or when it
// cannot answer at all. Everything else comes translated from the server (the "app_" rows in src/i18n.ts).
export const BOOT = {
  en: {
    loading: "Loading the weather…",
    outside: "This dashboard opens inside Telegram.",
    outsideHint: "Open the SkyBrief bot in Telegram, then tap “Open dashboard” or send /app.",
    offline: "I couldn't load the weather. Please check your connection and try again.",
    retry: "Try again",
  },
  ms: {
    loading: "Memuatkan cuaca…",
    outside: "Papan pemuka ini dibuka di dalam Telegram.",
    outsideHint: "Buka bot SkyBrief dalam Telegram, kemudian ketik “Buka papan pemuka” atau hantar /app.",
    offline: "Cuaca tidak dapat dimuatkan. Sila semak sambungan anda dan cuba lagi.",
    retry: "Cuba lagi",
  },
  zh: {
    loading: "正在加载天气…",
    outside: "此面板需在 Telegram 内打开。",
    outsideHint: "请在 Telegram 中打开 SkyBrief 机器人，然后点击“打开天气面板”或发送 /app。",
    offline: "无法加载天气。请检查网络连接后重试。",
    retry: "重试",
  },
};

/** "zh-hans" -> zh, "ms" -> ms, anything else -> en. */
export function bootLang(code) {
  const c = String(code || "").toLowerCase();
  return c.startsWith("zh") ? "zh" : c.startsWith("ms") ? "ms" : "en";
}
