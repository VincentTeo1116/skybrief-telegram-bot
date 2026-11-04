/**
 * ALL user-facing text in English (en), Bahasa Melayu (ms) and Chinese (zh).
 * To add a language: add its code to LANGS / IDX, then append a translation to every row below
 * (a missing translation falls back to English).
 */
import type { ClockMode, Lang } from "./types";
import { fill } from "./util";

export const LANGS: Record<Lang, string> = { en: "🇬🇧 English", ms: "🇲🇾 Bahasa Melayu", zh: "🇨🇳 中文" };
export const DEFAULT_LANG: Lang = "en";
const IDX: Record<Lang, number> = { en: 0, ms: 1, zh: 2 };

type Row = [string, string, string];

// key: [English, Bahasa Melayu, 中文]
export const T: Record<string, Row> = {
  // ---- report section names (also used in Settings)
  sec_details: ["Details (humidity, wind…)", "Butiran (kelembapan, angin…)", "详细数据（湿度、风力…）"],
  sec_sun: ["Sun & UV", "Matahari & UV", "日出日落与紫外线"],
  sec_air: ["Air quality", "Kualiti udara", "空气质量"],
  sec_rain: ["Rain outlook", "Ramalan hujan", "降雨展望"],
  sec_forecast: ["Next days forecast", "Ramalan hari-hari akan datang", "未来几天预报"],
  sec_tips: ["Tips", "Petua", "贴心提示"],
  // ---- report labels
  humidity: ["Humidity", "Kelembapan", "湿度"],
  wind: ["Wind", "Angin", "风力"],
  cloud: ["Cloud", "Awan", "云量"],
  uv: ["UV", "UV", "紫外线"],
  feels: ["Feels like", "Terasa seperti", "体感"],
  air_title: ["Air quality", "Kualiti udara", "空气质量"],
  air_unavail: ["Unavailable right now", "Tidak tersedia buat masa ini", "暂时无法获取"],
  pollutant: ["main pollutant {p}", "bahan pencemar utama {p}", "主要污染物 {p}"],
  rain_title: ["Rain outlook", "Ramalan hujan", "降雨展望"],
  raining_now: ["Raining now", "Sedang hujan", "正在下雨"],
  raining_more: [
    " · chance stays up to {p}% over the next 6h",
    " · kebarangkalian kekal sehingga {p}% dalam 6 jam akan datang",
    "，未来6小时降雨概率最高 {p}%",
  ],
  rain_likely: ["Rain likely around {h} ({p}%)", "Hujan berkemungkinan sekitar {h} ({p}%)", "{h} 前后可能下雨（{p}%）"],
  rain_chance: [
    "Chance of showers around {h} ({p}%)",
    "Kemungkinan hujan renyai sekitar {h} ({p}%)",
    "{h} 前后可能有阵雨（{p}%）",
  ],
  rain_none: ["No rain expected in the next 6 hours", "Tiada hujan dijangka dalam 6 jam akan datang", "未来6小时预计无雨"],
  forecast_title: ["Next days", "Hari-hari akan datang", "未来几天"],
  tips_title: ["Tips", "Petua", "贴心提示"],
  tip_umbrella: ["Bring an umbrella", "Bawa payung", "记得带伞"],
  tip_storm: [
    "Thunderstorm risk in the next hours: avoid open areas",
    "Risiko ribut petir dalam beberapa jam akan datang: elakkan kawasan lapang",
    "未来数小时有雷暴风险，请避开空旷地带",
  ],
  tip_uv_vhigh: [
    "Very high UV: sunscreen and shade around midday",
    "UV sangat tinggi: guna pelindung matahari dan berteduh pada waktu tengah hari",
    "紫外线极强：正午请涂防晒并尽量待在阴凉处",
  ],
  tip_uv_high: ["High UV: wear sunscreen", "UV tinggi: guna pelindung matahari", "紫外线较强：请涂防晒霜"],
  tip_heat_danger: [
    "Dangerously hot feel: hydrate and limit outdoor time",
    "Terasa sangat panas dan berbahaya: minum air secukupnya dan hadkan masa di luar",
    "体感酷热，有危险：多补水并减少户外活动",
  ],
  tip_heat_hot: ["Hot and humid: drink plenty of water", "Panas dan lembap: minum air yang banyak", "闷热：请多喝水"],
  tip_cold: ["Cold: dress warmly", "Sejuk: pakai pakaian tebal", "天气寒冷：请注意保暖"],
  tip_gusts: ["Strong gusts expected", "Tiupan angin kencang dijangka", "预计有强阵风"],
  tip_aqi_bad: ["Poor air: wear an N95 mask outdoors", "Udara tidak sihat: pakai pelitup N95 di luar", "空气质量差：户外请佩戴 N95 口罩"],
  tip_aqi_sens: [
    "Sensitive groups should limit outdoor activity",
    "Golongan sensitif perlu hadkan aktiviti luar",
    "敏感人群请减少户外活动",
  ],
  tip_comfy: ["Conditions look comfortable", "Keadaan cuaca kelihatan selesa", "天气舒适"],
  observed: ["Observed {t} local", "Dicerap pada {t} (waktu tempatan)", "观测时间 {t}（当地）"],
  src_weather: ["Weather: Open-Meteo", "Cuaca: Open-Meteo", "天气：Open-Meteo"],
  src_air_station: ["Air: {name} station ({km} km)", "Udara: stesen {name} ({km} km)", "空气：{name} 监测站（{km} 公里）"],
  src_air_model: ["Air: modelled estimate", "Udara: anggaran model", "空气：模型估算"],
  ribbon_daily: ["Good morning! Here's your daily report", "Selamat pagi! Ini laporan harian anda", "早安！这是您的每日报告"],
  ribbon_saved: ["Location saved:", "Lokasi disimpan:", "位置已保存："],
  hourly_title: ["Next 12 hours", "12 jam akan datang", "未来12小时"],
  bars_note: ["Bars = chance of rain", "Bar = kebarangkalian hujan", "进度条 = 降雨概率"],
  // ---- welcome / help
  welcome: [
    "👋 <b>Hi {name}!</b> I'm <b>SkyBrief</b>, your personal weather &amp; air-quality assistant.\n\n" +
      "📍 Your current location is <b>{place}</b>.\n" +
      "🔔 I'll message you every day at <b>{time}</b> (local time of your location).\n\n" +
      "<b>Ways to change location, one tap:</b>\n" +
      "• Tap <b>📍 Share my location</b> for live GPS detection\n" +
      "• Tap <b>🏙 Change city</b> for quick shortcuts\n" +
      "• Or just <b>type any city name</b>\n\n" +
      "Use the buttons under each report to refresh or see hourly details.\n" +
      "⚙️ Tap <b>Settings</b> to choose what to show and to change the language.",
    "👋 <b>Hai {name}!</b> Saya <b>SkyBrief</b>, pembantu cuaca &amp; kualiti udara peribadi anda.\n\n" +
      "📍 Lokasi semasa anda ialah <b>{place}</b>.\n" +
      "🔔 Saya akan hantar laporan setiap hari pada <b>{time}</b> (waktu tempatan lokasi anda).\n\n" +
      "<b>Tukar lokasi dengan satu ketikan:</b>\n" +
      "• Ketik <b>📍 Kongsi lokasi saya</b> untuk pengesanan GPS\n" +
      "• Ketik <b>🏙 Tukar bandar</b> untuk pintasan pantas\n" +
      "• Atau <b>taip nama bandar</b> mana-mana\n\n" +
      "Gunakan butang di bawah setiap laporan untuk muat semula atau lihat butiran setiap jam.\n" +
      "⚙️ Ketik <b>Tetapan</b> untuk pilih maklumat yang dipaparkan dan tukar bahasa.",
    "👋 <b>你好，{name}！</b>我是 <b>SkyBrief</b>，您的专属天气与空气质量助手。\n\n" +
      "📍 您当前的位置：<b>{place}</b>\n" +
      "🔔 我会在每天 <b>{time}</b>（所在地当地时间）向您发送报告。\n\n" +
      "<b>一键更换位置：</b>\n" +
      "• 点击 <b>📍 分享我的位置</b>，GPS 自动定位\n" +
      "• 点击 <b>🏙 更换城市</b>，使用快捷城市\n" +
      "• 或直接<b>输入任意城市名称</b>\n\n" +
      "报告下方的按钮可刷新数据或查看逐小时预报。\n" +
      "⚙️ 点击<b>设置</b>可选择显示内容并切换语言。",
  ],
  help: [
    "<b>Commands</b>\n/weather: current weather &amp; air quality\n/hourly: next 12 hours\n/tomorrow: tomorrow's forecast\n/week: 7-day outlook\n/warnings: official weather warnings\n" +
      "/city: change location (or just type a city name)\n/daily: morning report on or off\n" +
      "/settime 07:45: change the morning report time\n/evening [19:00]: evening report (tomorrow's outlook)\n" +
      "/settings: sections, language, units, alerts\n/help: this message\n\n📍 Share your GPS location with the bottom button to auto-detect where you are.\n💡 Type @SkyBrief_AI_bot and a city in any chat to share its weather.",
    "<b>Arahan</b>\n/weather: cuaca &amp; kualiti udara semasa\n/hourly: 12 jam akan datang\n/tomorrow: ramalan esok\n/week: ramalan 7 hari\n/warnings: amaran cuaca rasmi\n" +
      "/city: tukar lokasi (atau taip nama bandar)\n/daily: hidup/matikan laporan pagi\n" +
      "/settime 07:45: tukar masa laporan pagi\n/evening [19:00]: laporan petang (ramalan esok)\n" +
      "/settings: bahagian, bahasa, unit, amaran\n/help: mesej ini\n\n📍 Kongsi lokasi GPS anda melalui butang di bawah untuk pengesanan automatik.\n💡 Taip @SkyBrief_AI_bot dan nama bandar dalam mana-mana sembang untuk berkongsi cuaca.",
    "<b>命令</b>\n/weather：当前天气与空气质量\n/hourly：未来12小时\n/tomorrow：明天的预报\n/week：7天预报\n/warnings：官方天气警报\n" +
      "/city：更换位置（也可直接输入城市名）\n/daily：开启/关闭早间报告\n" +
      "/settime 07:45：修改早间报告时间\n/evening [19:00]：晚间报告（明天的预报）\n" +
      "/settings：内容、语言、单位、提醒\n/help：显示此帮助\n\n📍 点击底部按钮分享 GPS 位置，可自动定位。\n💡 在任意聊天中输入 @SkyBrief_AI_bot 加城市名，即可分享天气。",
  ],
  // ---- reply keyboard + inline buttons
  btn_now: ["🌦 Weather now", "🌦 Cuaca sekarang", "🌦 当前天气"],
  btn_city: ["🏙 Change city", "🏙 Tukar bandar", "🏙 更换城市"],
  btn_loc: ["📍 Share my location", "📍 Kongsi lokasi saya", "📍 分享我的位置"],
  btn_settings: ["⚙️ Settings", "⚙️ Tetapan", "⚙️ 设置"],
  placeholder: ["Type a city name…", "Taip nama bandar…", "输入城市名称…"],
  b_refresh: ["🔄 Refresh", "🔄 Muat semula", "🔄 刷新"],
  b_hourly: ["⏱ Hourly", "⏱ Setiap jam", "⏱ 逐小时"],
  b_change: ["📍 Change location", "📍 Tukar lokasi", "📍 更换位置"],
  b_daily_on: ["🔔 Daily {time}: ON", "🔔 Harian {time}: HIDUP", "🔔 每日 {time}：开"],
  b_daily_off: ["🔕 Daily: OFF", "🔕 Harian: MATI", "🔕 每日：关"],
  b_back: ["⬅ Back", "⬅ Kembali", "⬅ 返回"],
  b_shortcuts: ["🏙 Shortcuts", "🏙 Pintasan", "🏙 快捷城市"],
  b_retry: ["🔄 Try again", "🔄 Cuba lagi", "🔄 重试"],
  // ---- toasts / messages
  toast_updated: ["Updated ✅", "Dikemas kini ✅", "已更新 ✅"],
  toast_uptodate: ["Already up to date ✅", "Sudah terkini ✅", "已是最新 ✅"],
  toast_switch: ["Switching location…", "Menukar lokasi…", "正在切换位置…"],
  toast_daily_on: ["Daily report ON 🔔", "Laporan harian HIDUP 🔔", "每日报告已开启 🔔"],
  toast_daily_off: ["Daily report OFF 🔕", "Laporan harian MATI 🔕", "每日报告已关闭 🔕"],
  err_wx: [
    "⚠️ I couldn't reach the weather service. Please try again in a moment.",
    "⚠️ Tidak dapat menghubungi perkhidmatan cuaca. Sila cuba sebentar lagi.",
    "⚠️ 无法连接天气服务，请稍后再试。",
  ],
  err_toast: [
    "⚠️ Weather service unreachable, try again.",
    "⚠️ Perkhidmatan cuaca tidak dapat dicapai, cuba lagi.",
    "⚠️ 天气服务暂时无法连接，请重试。",
  ],
  err_search: [
    "⚠️ City search is unavailable right now. Please try again shortly.",
    "⚠️ Carian bandar tidak tersedia buat masa ini. Sila cuba sebentar lagi.",
    "⚠️ 城市搜索暂时不可用，请稍后再试。",
  ],
  err_generic: [
    "😵 Something went wrong on my side. Please try again.",
    "😵 Berlaku masalah di pihak saya. Sila cuba lagi.",
    "😵 出了点问题，请再试一次。",
  ],
  err_loc: [
    "⚠️ I couldn't fetch weather for that spot. Please try again.",
    "⚠️ Tidak dapat mendapatkan cuaca untuk lokasi itu. Sila cuba lagi.",
    "⚠️ 无法获取该位置的天气，请重试。",
  ],
  list_expired: [
    "That list has expired. Type the city name again.",
    "Senarai itu telah tamat tempoh. Taip semula nama bandar.",
    "列表已过期，请重新输入城市名称。",
  ],
  not_found: [
    "🤔 I couldn't find “{q}”. Try a nearby big city, or <i>City, Country</i>.",
    "🤔 Saya tidak jumpa “{q}”. Cuba bandar besar berdekatan, atau <i>Bandar, Negara</i>.",
    "🤔 找不到“{q}”。请试试附近的大城市，或输入“城市, 国家”。",
  ],
  type_city: [
    "Type a city name (e.g. <i>Ipoh</i> or <i>Tokyo</i>), or tap 📍 to share your location.",
    "Taip nama bandar (cth. <i>Ipoh</i> atau <i>Tokyo</i>), atau ketik 📍 untuk kongsi lokasi anda.",
    "请输入城市名称（如 <i>怡保</i> 或 <i>Tokyo</i>），或点击 📍 分享位置。",
  ],
  which_one: ["🔎 Which one do you mean?", "🔎 Yang mana satu maksud anda?", "🔎 您指的是哪一个？"],
  city_menu: [
    "📍 Current location: <b>{p}</b>\n\nPick a city, <b>type any city name</b>, or use <b>📍 Share my location</b> below.",
    "📍 Lokasi semasa: <b>{p}</b>\n\nPilih bandar, <b>taip nama bandar</b>, atau guna <b>📍 Kongsi lokasi saya</b> di bawah.",
    "📍 当前位置：<b>{p}</b>\n\n请选择城市、<b>输入任意城市名称</b>，或使用下方的 <b>📍 分享我的位置</b>。",
  ],
  daily_on_msg: [
    "🔔 Daily report is <b>ON</b>, every day at <b>{time}</b> ({tz}).",
    "🔔 Laporan harian <b>HIDUP</b>, setiap hari pada <b>{time}</b> ({tz}).",
    "🔔 每日报告<b>已开启</b>，每天 <b>{time}</b>（{tz}）。",
  ],
  daily_off_msg: [
    "🔕 Daily report is <b>OFF</b>. Send /daily to turn it back on.",
    "🔕 Laporan harian <b>MATI</b>. Hantar /daily untuk hidupkan semula.",
    "🔕 每日报告<b>已关闭</b>。发送 /daily 可重新开启。",
  ],
  settime_usage: [
    "Usage: <code>/settime 07:45</code> (24-hour clock)",
    "Penggunaan: <code>/settime 07:45</code> (waktu 24 jam)",
    "用法：<code>/settime 07:45</code>（24小时制）",
  ],
  settime_ok: [
    "✅ Daily report set for <b>{time}</b> ({tz}).",
    "✅ Laporan harian ditetapkan pada <b>{time}</b> ({tz}).",
    "✅ 每日报告时间已设为 <b>{time}</b>（{tz}）。",
  ],
  settings_text: [
    "📋 <b>Report sections</b>\n\nTap a section to show ✅ or hide ⬜ it in your reports.",
    "📋 <b>Bahagian laporan</b>\n\nKetik bahagian untuk papar ✅ atau sembunyi ⬜ dalam laporan anda.",
    "📋 <b>报告内容</b>\n\n点击各部分可在报告中显示 ✅ 或隐藏 ⬜。",
  ],
  lang_changed: ["✅ Language set to English.", "✅ Bahasa ditukar kepada Bahasa Melayu.", "✅ 语言已切换为中文。"],
  // ---- access control (multi-user)
  acc_pending: [
    "⏳ Your access request has been sent to the admin. You'll get a message here once you're approved.",
    "⏳ Permintaan akses anda telah dihantar kepada pentadbir. Anda akan dimaklumkan di sini selepas diluluskan.",
    "⏳ 您的使用申请已发送给管理员，获批后会在此通知您。",
  ],
  acc_approved: [
    "✅ You're approved! Send /start to begin.",
    "✅ Anda telah diluluskan! Hantar /start untuk bermula.",
    "✅ 您已获批准！发送 /start 开始使用。",
  ],
  acc_closed: [
    "🔒 This is a private bot. Ask its owner to add you.",
    "🔒 Ini bot peribadi. Minta pemiliknya untuk menambah anda.",
    "🔒 这是私人机器人，请联系所有者添加您。",
  ],
  // ---- v2.1: best time outside, trend, AQI outlook
  sec_best: ["Best time outside", "Waktu terbaik di luar", "户外最佳时段"],
  today: ["Today", "Hari ini", "今天"],
  tomorrow: ["Tomorrow", "Esok", "明天"],
  trend_warmer: ["{d}° warmer than yesterday", "{d}° lebih panas daripada semalam", "比昨天热 {d}°"],
  trend_cooler: ["{d}° cooler than yesterday", "{d}° lebih sejuk daripada semalam", "比昨天凉 {d}°"],
  aqi_rising: [
    "Rising: peak ~{aqi} around {h} (model)",
    "Meningkat: puncak ~{aqi} sekitar {h} (model)",
    "将上升：{h} 前后达到约 {aqi}（模型）",
  ],
  aqi_falling: [
    "Improving: ~{aqi} by {h} (model)",
    "Bertambah baik: ~{aqi} menjelang {h} (model)",
    "将好转：{h} 前后降至约 {aqi}（模型）",
  ],
  aqi_steady: [
    "Steady around {aqi} for the next hours (model)",
    "Stabil sekitar {aqi} dalam beberapa jam akan datang (model)",
    "未来数小时保持在约 {aqi}（模型）",
  ],
  aqi_tomorrow: [
    "Expected peak ~{aqi} around {h} (model)",
    "Puncak dijangka ~{aqi} sekitar {h} (model)",
    "预计 {h} 前后达到峰值约 {aqi}（模型）",
  ],
  best_today: ["Today: {r}", "Hari ini: {r}", "今天：{r}"],
  best_tomorrow: ["Tomorrow: {r}", "Esok: {r}", "明天：{r}"],
  best_none_today: ["No comfortable window left today", "Tiada tempoh selesa lagi hari ini", "今天已没有舒适的时段"],
  best_none_tomorrow: ["Tomorrow: no comfortable window", "Esok: tiada tempoh yang selesa", "明天：没有舒适的时段"],
  best_hint: [
    "comfortable temperature, low UV, dry, clean air",
    "suhu selesa, UV rendah, kering, udara bersih",
    "气温舒适、紫外线低、无雨、空气清洁",
  ],
  // ---- v2.1: tomorrow / week views
  week_title: ["7-day outlook", "Ramalan 7 hari", "7天预报"],
  p_morning: ["Morning", "Pagi", "上午"],
  p_afternoon: ["Afternoon", "Tengah hari", "下午"],
  p_evening: ["Evening", "Petang", "傍晚"],
  rain_chance_day: ["Rain chance {p}%", "Kebarangkalian hujan {p}%", "降雨概率 {p}%"],
  rain_total: [" · {mm} mm expected", " · dijangka {mm} mm", " · 预计 {mm} 毫米"],
  wind_up_to: ["Wind up to {w}", "Angin sehingga {w}", "风速最高 {w}"],
  week_rainiest: ["Rainiest day: {d} ({p}%)", "Hari paling hujan: {d} ({p}%)", "降雨最多：{d}（{p}%）"],
  ribbon_evening: [
    "Good evening! Here's tomorrow's outlook",
    "Selamat petang! Ini ramalan esok",
    "晚上好！这是明天的预报",
  ],
  src_weather_backup: [
    "Weather: MET Norway (backup source)",
    "Cuaca: MET Norway (sumber sandaran)",
    "天气：MET Norway（备用数据源）",
  ],
  b_today: ["📋 Today", "📋 Hari ini", "📋 今天"],
  b_tomorrow: ["🌅 Tomorrow", "🌅 Esok", "🌅 明天"],
  b_week: ["🗓 7-day", "🗓 7 hari", "🗓 7天"],
  // ---- v2.1: settings pages
  settings_menu: [
    "⚙️ <b>Settings</b>\n\nWhat would you like to change?",
    "⚙️ <b>Tetapan</b>\n\nApa yang anda mahu ubah?",
    "⚙️ <b>设置</b>\n\n您想修改什么？",
  ],
  settings_lang: ["🌐 <b>Language</b>\n\nChoose your language:", "🌐 <b>Bahasa</b>\n\nPilih bahasa anda:", "🌐 <b>语言</b>\n\n请选择语言："],
  settings_units: [
    "📐 <b>Units &amp; display</b>\n\nChoose how numbers and times are shown. Compact mode gives a much shorter report.",
    "📐 <b>Unit &amp; paparan</b>\n\nPilih cara nombor dan masa dipaparkan. Mod ringkas memberi laporan yang jauh lebih pendek.",
    "📐 <b>单位与显示</b>\n\n选择数字和时间的显示方式。简洁模式会让报告短得多。",
  ],
  settings_alerts: [
    "🔔 <b>Alerts &amp; reports</b>\n\n🌧 Rain alerts: a heads-up when rain is likely within the next 1–2 hours.\n😷 AQI alert: a message when air quality reaches the level you pick (101 = unhealthy for sensitive groups, 151 = unhealthy, 201 = very unhealthy).\n⚠️ Official warnings: MetMalaysia thunderstorm, heavy-rain and hot-weather warnings for your state (Malaysia only; sent right away, silently at night).\n🌙 Evening report: tomorrow's outlook every evening (change the time with /evening 19:00).\n\nAlerts are paused overnight (22:00–06:30 by default, your local time).",
    "🔔 <b>Amaran &amp; laporan</b>\n\n🌧 Amaran hujan: pemberitahuan apabila hujan berkemungkinan dalam 1–2 jam akan datang.\n😷 Amaran AQI: mesej apabila kualiti udara mencapai tahap pilihan anda (101 = tidak sihat untuk golongan sensitif, 151 = tidak sihat, 201 = sangat tidak sihat).\n⚠️ Amaran rasmi: amaran ribut petir, hujan lebat dan cuaca panas MetMalaysia untuk negeri anda (Malaysia sahaja; dihantar serta-merta, senyap pada waktu malam).\n🌙 Laporan petang: ramalan esok setiap petang (tukar masa dengan /evening 19:00).\n\nAmaran dihentikan pada waktu malam (lalai 22:00–06:30, waktu tempatan anda).",
    "🔔 <b>提醒与报告</b>\n\n🌧 降雨提醒：未来1–2小时可能下雨时通知您。\n😷 AQI 提醒：空气质量达到您选择的级别时通知（101 = 对敏感人群不健康，151 = 不健康，201 = 非常不健康）。\n⚠️ 官方警报：马来西亚气象局针对您所在州属的雷暴、大雨和炎热天气警报（仅限马来西亚；即时发送，夜间静音）。\n🌙 晚间报告：每晚发送明天的预报（用 /evening 19:00 修改时间）。\n\n提醒在夜间暂停（默认当地时间 22:00–06:30）。",
  ],
  m_sections: ["📋 Report sections", "📋 Bahagian laporan", "📋 报告内容"],
  m_lang: ["🌐 Language", "🌐 Bahasa", "🌐 语言"],
  m_units: ["📐 Units & display", "📐 Unit & paparan", "📐 单位与显示"],
  m_alerts: ["🔔 Alerts & reports", "🔔 Amaran & laporan", "🔔 提醒与报告"],
  clock_auto: ["🕒 Auto", "🕒 Auto", "🕒 自动"],
  clock_12: ["🕒 12h", "🕒 12 jam", "🕒 12小时"],
  clock_24: ["🕒 24h", "🕒 24 jam", "🕒 24小时"],
  compact_on: ["✅ Compact report: ON", "✅ Laporan ringkas: HIDUP", "✅ 简洁模式：开"],
  compact_off: ["⬜ Compact report: OFF", "⬜ Laporan ringkas: MATI", "⬜ 简洁模式：关"],
  a_rain_on: ["✅ 🌧 Rain alerts: ON", "✅ 🌧 Amaran hujan: HIDUP", "✅ 🌧 降雨提醒：开"],
  a_rain_off: ["⬜ 🌧 Rain alerts: OFF", "⬜ 🌧 Amaran hujan: MATI", "⬜ 🌧 降雨提醒：关"],
  a_aqi_off: ["😷 AQI: off", "😷 AQI: mati", "😷 AQI：关"],
  a_aqi_at: ["AQI ≥{n}", "AQI ≥{n}", "AQI ≥{n}"],
  a_eve_on: ["✅ 🌙 Evening report {time}: ON", "✅ 🌙 Laporan petang {time}: HIDUP", "✅ 🌙 晚间报告 {time}：开"],
  a_eve_off: ["⬜ 🌙 Evening report: OFF", "⬜ 🌙 Laporan petang: MATI", "⬜ 🌙 晚间报告：关"],
  // ---- v2.1: alerts
  alert_rain: [
    "🌧 <b>Rain alert</b> · {place}\nRain likely around {h} ({p}%). Bring an umbrella ☂️",
    "🌧 <b>Amaran hujan</b> · {place}\nHujan berkemungkinan sekitar {h} ({p}%). Bawa payung ☂️",
    "🌧 <b>降雨提醒</b> · {place}\n{h} 前后可能下雨（{p}%）。请带伞 ☂️",
  ],
  alert_aqi: [
    "😷 <b>Air-quality alert</b> · {place}\nAQI is now <b>{aqi}</b> ({label}).\n{advice}",
    "😷 <b>Amaran kualiti udara</b> · {place}\nAQI kini <b>{aqi}</b> ({label}).\n{advice}",
    "😷 <b>空气质量提醒</b> · {place}\n当前 AQI 为 <b>{aqi}</b>（{label}）。\n{advice}",
  ],
  b_mute: ["🔕 Mute these alerts", "🔕 Matikan amaran ini", "🔕 关闭此类提醒"],
  b_report: ["📋 Full report", "📋 Laporan penuh", "📋 完整报告"],
  toast_muted: ["Muted 🔕", "Dimatikan 🔕", "已关闭 🔕"],
  // ---- v2.1: evening report
  evening_on_msg: [
    "🌙 Evening report is <b>ON</b>: tomorrow's outlook every day at <b>{time}</b> ({tz}).",
    "🌙 Laporan petang <b>HIDUP</b>: ramalan esok setiap hari pada <b>{time}</b> ({tz}).",
    "🌙 晚间报告<b>已开启</b>：每天 <b>{time}</b>（{tz}）发送明天的预报。",
  ],
  evening_off_msg: [
    "🌙 Evening report is <b>OFF</b>. Send /evening to turn it on.",
    "🌙 Laporan petang <b>MATI</b>. Hantar /evening untuk menghidupkan.",
    "🌙 晚间报告<b>已关闭</b>。发送 /evening 可开启。",
  ],
  evening_usage: [
    "Usage: <code>/evening 19:00</code> (24-hour clock), or just /evening to switch it on or off",
    "Penggunaan: <code>/evening 19:00</code> (waktu 24 jam), atau /evening sahaja untuk hidup/mati",
    "用法：<code>/evening 19:00</code>（24小时制），或直接发送 /evening 开启/关闭",
  ],
  // ---- v2.1: inline mode
  inline_open: ["Open SkyBrief", "Buka SkyBrief", "打开 SkyBrief"],
  inline_hint_title: ["Type a city name", "Taip nama bandar", "输入城市名称"],
  inline_hint_desc: ["e.g. Ipoh, Penang, Tokyo", "cth. Ipoh, Penang, Tokyo", "例如：怡保、槟城、Tokyo"],
  inline_hint_text: [
    "Type a city name after the bot's name, e.g. Ipoh",
    "Taip nama bandar selepas nama bot, cth. Ipoh",
    "请在机器人名称后输入城市名，例如：怡保",
  ],
  // ---- v2.2: official warnings (MetMalaysia)
  warn_block_title: ["Official warnings", "Amaran rasmi", "官方警报"],
  warn_until: ["until {t}", "sehingga {t}", "至 {t}"],
  warn_more: ["/warnings for details", "/warnings untuk butiran", "发送 /warnings 查看详情"],
  warn_alert_title: ["Official warning", "Amaran rasmi", "官方警报"],
  warn_valid: ["Valid {a} – {b}", "Sah {a} – {b}", "有效期 {a} – {b}"],
  warn_source: [
    "Source: Malaysian Meteorological Department (MetMalaysia)",
    "Sumber: Jabatan Meteorologi Malaysia (MetMalaysia)",
    "来源：马来西亚气象局（MetMalaysia）",
  ],
  warn_orig: ["Original text", "Teks asal", "（官方原文为英文）"],
  warn_none: [
    "✅ No active official warnings for {s}.",
    "✅ Tiada amaran rasmi yang aktif untuk {s}.",
    "✅ {s} 目前没有生效的官方警报。",
  ],
  warn_elsewhere: [
    "{n} warning(s) are active in other states.",
    "{n} amaran aktif di negeri lain.",
    "其他州属有 {n} 项生效警报。",
  ],
  warn_not_my: [
    "Official warnings are available for Malaysia only.",
    "Amaran rasmi hanya tersedia untuk Malaysia.",
    "官方警报仅适用于马来西亚。",
  ],
  warn_no_region: [
    "I couldn't work out which state you're in. Pick your city again with /city.",
    "Saya tidak dapat mengenal pasti negeri anda. Pilih bandar anda semula dengan /city.",
    "无法确定您所在的州属，请用 /city 重新选择城市。",
  ],
  warn_feed_down: [
    "⚠️ I couldn't reach the MetMalaysia warnings service. Please try again shortly.",
    "⚠️ Tidak dapat menghubungi perkhidmatan amaran MetMalaysia. Sila cuba sebentar lagi.",
    "⚠️ 无法连接马来西亚气象局警报服务，请稍后再试。",
  ],
  a_warn_on: ["✅ ⚠️ Official warnings: ON", "✅ ⚠️ Amaran rasmi: HIDUP", "✅ ⚠️ 官方警报：开"],
  a_warn_off: ["⬜ ⚠️ Official warnings: OFF", "⬜ ⚠️ Amaran rasmi: MATI", "⬜ ⚠️ 官方警报：关"],
  // ---- bot command menu
  cmd_weather: ["Current weather & air quality", "Cuaca & kualiti udara semasa", "当前天气与空气质量"],
  cmd_hourly: ["Next 12 hours", "12 jam akan datang", "未来12小时"],
  cmd_city: ["Change location", "Tukar lokasi", "更换位置"],
  cmd_daily: ["Turn daily report on/off", "Hidup/matikan laporan harian", "开启/关闭每日报告"],
  cmd_settime: ["Set daily time, e.g. /settime 07:45", "Tetapkan masa harian, cth. /settime 07:45", "设置每日时间，如 /settime 07:45"],
  cmd_settings: ["What to show & language", "Paparan & bahasa", "显示内容与语言"],
  cmd_tomorrow: ["Tomorrow's forecast", "Ramalan esok", "明天的预报"],
  cmd_week: ["7-day outlook", "Ramalan 7 hari", "7天预报"],
  cmd_evening: ["Evening report on/off or time", "Laporan petang hidup/mati atau masa", "晚间报告开关或时间"],
  cmd_warnings: ["Official weather warnings", "Amaran cuaca rasmi", "官方天气警报"],
  cmd_help: ["Show help", "Tunjuk bantuan", "查看帮助"],
};

// WMO weather code -> [English, Bahasa Melayu, 中文]
const WMO_TEXT: Record<number, Row> = {
  0: ["Clear sky", "Langit cerah", "晴"],
  1: ["Mainly clear", "Kebanyakannya cerah", "大部晴朗"],
  2: ["Partly cloudy", "Separa mendung", "局部多云"],
  3: ["Overcast", "Mendung", "阴天"],
  45: ["Fog", "Kabus", "雾"],
  48: ["Rime fog", "Kabus beku", "冻雾"],
  51: ["Light drizzle", "Gerimis ringan", "小毛毛雨"],
  53: ["Drizzle", "Gerimis", "毛毛雨"],
  55: ["Heavy drizzle", "Gerimis lebat", "大毛毛雨"],
  56: ["Freezing drizzle", "Gerimis beku", "冻毛毛雨"],
  57: ["Freezing drizzle", "Gerimis beku", "冻毛毛雨"],
  61: ["Light rain", "Hujan ringan", "小雨"],
  63: ["Rain", "Hujan", "中雨"],
  65: ["Heavy rain", "Hujan lebat", "大雨"],
  66: ["Freezing rain", "Hujan beku", "冻雨"],
  67: ["Freezing rain", "Hujan beku", "冻雨"],
  71: ["Light snow", "Salji ringan", "小雪"],
  73: ["Snow", "Salji", "中雪"],
  75: ["Heavy snow", "Salji lebat", "大雪"],
  77: ["Snow grains", "Butiran salji", "米雪"],
  80: ["Light showers", "Hujan renyai ringan", "小阵雨"],
  81: ["Showers", "Hujan renyai", "阵雨"],
  82: ["Violent showers", "Hujan renyai lebat", "强阵雨"],
  85: ["Snow showers", "Hujan salji", "阵雪"],
  86: ["Heavy snow showers", "Hujan salji lebat", "强阵雪"],
  95: ["Thunderstorm", "Ribut petir", "雷暴"],
  96: ["Thunderstorm, hail", "Ribut petir dan hujan batu", "雷暴伴冰雹"],
  99: ["Severe thunderstorm, hail", "Ribut petir teruk dan hujan batu", "强雷暴伴冰雹"],
};
const UNKNOWN_WX: Row = ["Unknown", "Tidak diketahui", "未知"];

const AQI_LABELS: Row[] = [
  ["Good", "Baik", "良好"],
  ["Moderate", "Sederhana", "中等"],
  ["Unhealthy for sensitive groups", "Tidak sihat untuk golongan sensitif", "对敏感人群不健康"],
  ["Unhealthy", "Tidak sihat", "不健康"],
  ["Very unhealthy", "Sangat tidak sihat", "非常不健康"],
  ["Hazardous", "Berbahaya", "危险"],
];
const UV_LABELS: Row[] = [
  ["Low", "Rendah", "低"],
  ["Moderate", "Sederhana", "中等"],
  ["High", "Tinggi", "高"],
  ["Very high", "Sangat tinggi", "很高"],
  ["Extreme", "Melampau", "极高"],
];

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  ms: ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu", "Ahad"],
  zh: ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
};
const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  ms: ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"],
  zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
};
const MONTHS: Record<"en" | "ms", string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ms: ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"],
};
// Malay and Chinese use 8 named directions; English keeps 16 points.
const COMPASS16_EN = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const COMPASS8: Partial<Record<Lang, string[]>> = {
  ms: ["U", "TL", "T", "TG", "S", "BD", "B", "BL"],
  zh: ["北", "东北", "东", "东南", "南", "西南", "西", "西北"],
};

// ------------------------------------------------------------------ helpers
export function normLang(lang: string | null | undefined): Lang {
  return lang && lang in LANGS ? (lang as Lang) : DEFAULT_LANG;
}

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const row = T[key];
  if (!row) throw new Error(`Missing translation key: ${key}`);
  const s = row[IDX[normLang(lang)]] || row[0];
  return fill(s, params);
}

export function allVariants(key: string): Set<string> {
  return new Set(T[key]);
}

export function wmoText(code: number | null | undefined, lang: Lang): string {
  const row = (code != null && WMO_TEXT[code]) || UNKNOWN_WX;
  return row[IDX[normLang(lang)]];
}

export const aqiLabel = (level: number, lang: Lang) => AQI_LABELS[level][IDX[normLang(lang)]];
export const uvText = (level: number, lang: Lang) => UV_LABELS[level][IDX[normLang(lang)]];

export function compassDir(degrees: number, lang: Lang): string {
  const eight = COMPASS8[normLang(lang)];
  if (eight) return eight[Math.round(degrees / 45) % 8];
  return COMPASS16_EN[Math.round(degrees / 22.5) % 16];
}

// ---- date/time helpers. Open-Meteo returns LOCAL times as "YYYY-MM-DDTHH:MM", so we format the string
// ---- directly and never involve the server's timezone.
function parseLocal(iso: string) {
  const [d, tm = "00:00"] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = tm.split(":").map(Number);
  return { y, mo, da, h, mi };
}

/** 0 = Monday … 6 = Sunday, for the calendar date in an ISO local string. */
function weekdayIndex(iso: string): number {
  const { y, mo, da } = parseLocal(iso);
  return (new Date(Date.UTC(y, mo - 1, da)).getUTCDay() + 6) % 7;
}

/** Saturday or Sunday? */
export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

export function weekday(iso: string, lang: Lang, short = false): string {
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[normLang(lang)][weekdayIndex(iso)];
}

export function dateLong(iso: string, lang: Lang): string {
  const l = normLang(lang);
  const { mo, da } = parseLocal(iso);
  if (l === "zh") return `${mo}月${da}日 ${weekday(iso, l)}`;
  return `${weekday(iso, l)}, ${da} ${MONTHS[l][mo - 1]}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 12h or 24h? "auto" follows the language (Chinese: 24h; English/Malay: 12h). */
export function use12h(lang: Lang, mode: ClockMode = "auto"): boolean {
  return mode === "12" ? true : mode === "24" ? false : normLang(lang) !== "zh";
}

const meridian = (h: number, lang: Lang) => (normLang(lang) === "zh" ? (h < 12 ? "上午" : "下午") : h < 12 ? "AM" : "PM");

export function clock(iso: string, lang: Lang, mode: ClockMode = "auto"): string {
  const { h, mi } = parseLocal(iso);
  if (!use12h(lang, mode)) return `${pad2(h)}:${pad2(mi)}`;
  const h12 = h % 12 || 12;
  return normLang(lang) === "zh" ? `${meridian(h, lang)}${h12}:${pad2(mi)}` : `${h12}:${pad2(mi)} ${meridian(h, lang)}`;
}

export function hourLabel(iso: string, lang: Lang, mode: ClockMode = "auto"): string {
  const { h } = parseLocal(iso);
  if (!use12h(lang, mode)) return `${pad2(h)}:00`;
  const h12 = h % 12 || 12;
  return normLang(lang) === "zh" ? `${meridian(h, lang)}${h12}时` : `${h12} ${meridian(h, lang)}`;
}

/** "7–9 AM", "11 AM–1 PM", "07:00–09:00". `endIso` is the END boundary (the hour after the last good hour). */
export function rangeLabel(startIso: string, endIso: string, lang: Lang, mode: ClockMode = "auto"): string {
  const a = parseLocal(startIso);
  const b = parseLocal(endIso);
  if (use12h(lang, mode) && normLang(lang) !== "zh" && a.h < 12 === b.h < 12) {
    // same AM/PM on both sides: say it once ("7–9 AM")
    return `${a.h % 12 || 12}–${b.h % 12 || 12} ${meridian(b.h, lang)}`;
  }
  return `${hourLabel(startIso, lang, mode)}–${hourLabel(endIso, lang, mode)}`;
}
