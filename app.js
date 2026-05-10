const STORAGE_KEY = "hsr_planner_v1";

function parseStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { banners: [], calc: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { banners: [], calc: {} };
    return {
      banners: Array.isArray(parsed.banners) ? parsed.banners : [],
      calc: parsed.calc && typeof parsed.calc === "object" ? parsed.calc : {},
    };
  } catch {
    return { banners: [], calc: {} };
  }
}

function writeStorage(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function formatDateTime(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function formatDaysLeft(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((abs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const parts = [];
  parts.push(`${days}g`);
  parts.push(`${hours}h`);
  return parts.join(" ");
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value || ""), 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toInputDateTimeValue(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function buildBannerStatus(now, start, end) {
  if (now < start) return { key: "upcoming", label: "In arrivo" };
  if (now > end) return { key: "ended", label: "Finito" };
  return { key: "active", label: "Attivo" };
}

function estimateProbAtLeastOneFeatured(pulls, guaranteed) {
  const n = Math.max(0, clampInt(pulls, 0, 99999));
  if (n === 0) return 0;
  const fiveStarRate = 0.006;
  const featuredFactor = guaranteed ? 1 : 0.5;
  const p = Math.min(0.999, fiveStarRate * featuredFactor);
  return 1 - Math.pow(1 - p, n);
}

function pct(x) {
  const v = Math.max(0, Math.min(1, x));
  return `${(v * 100).toFixed(1)}%`;
}

const store = parseStorage();

const bannersListEl = document.getElementById("banners-list");
const bannersEmptyEl = document.getElementById("banners-empty");
const bannerFormEl = document.getElementById("banner-form");
const bannerNameEl = document.getElementById("banner-name");
const bannerStartEl = document.getElementById("banner-start");
const bannerEndEl = document.getElementById("banner-end");
const clearBannersBtn = document.getElementById("clear-banners");
const exportBannersBtn = document.getElementById("export-banners");

const calcFormEl = document.getElementById("calc-form");
const jadeEl = document.getElementById("jade");
const passesEl = document.getElementById("passes");
const pityEl = document.getElementById("pity");
const guaranteedEl = document.getElementById("guaranteed");
const plannedEl = document.getElementById("planned");
const calcOutputEl = document.getElementById("calc-output");
const resetCalcBtn = document.getElementById("reset-calc");

function renderBanners() {
  const now = new Date();
  const banners = [...store.banners].sort((a, b) => (a.end || 0) - (b.end || 0));

  bannersListEl.innerHTML = "";
  bannersEmptyEl.style.display = banners.length ? "none" : "block";

  for (const b of banners) {
    const start = new Date(b.start);
    const end = new Date(b.end);
    const status = buildBannerStatus(now, start, end);
    const msToEnd = end.getTime() - now.getTime();

    const minus30 = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const minus1 = new Date(end.getTime() - 1 * 24 * 60 * 60 * 1000);

    const card = document.createElement("div");
    card.className = "banner";

    const top = document.createElement("div");
    top.className = "banner-top";

    const title = document.createElement("div");
    title.className = "banner-title";
    title.textContent = b.name || "Banner";

    const badge = document.createElement("div");
    badge.className = `badge ${status.key === "active" ? "active" : status.key === "ended" ? "ended" : ""}`;
    badge.textContent =
      status.key === "upcoming"
        ? `In arrivo • ${formatDaysLeft(start.getTime() - now.getTime())}`
        : status.key === "ended"
          ? "Finito"
          : `Scade tra • ${formatDaysLeft(msToEnd)}`;

    top.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "banner-meta";
    meta.innerHTML = `
      <div>Inizio: ${formatDateTime(start)}</div>
      <div>Fine: ${formatDateTime(end)}</div>
      <div>Notifica (≈ 1 mese prima): ${formatDateTime(minus30)}</div>
      <div>Notifica (1 giorno prima): ${formatDateTime(minus1)}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "banner-actions";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn danger ghost";
    del.textContent = "Rimuovi";
    del.addEventListener("click", () => {
      store.banners = store.banners.filter((x) => x.id !== b.id);
      writeStorage(store);
      renderBanners();
    });
    actions.append(del);

    card.append(top, meta, actions);
    bannersListEl.append(card);
  }
}

function renderCalc(out) {
  if (!out) {
    calcOutputEl.innerHTML = "";
    return;
  }

  const items = [
    { label: "Pull da Jade", value: String(out.pullsFromJade), sub: "Jade / 160 (arrotondato)" },
    { label: "Pull totali", value: String(out.totalPulls), sub: "Pass + pull da Jade" },
    { label: "Pull al prossimo 5★ (peggior caso)", value: String(out.toNextFiveStar), sub: "90 - pity" },
    {
      label: "Pull al personaggio banner (peggior caso)",
      value: String(out.worstToFeatured),
      sub: out.guaranteed ? "Garantito" : "Non garantito (+90)",
    },
    { label: "Prob. (stima) di ottenere il featured", value: pct(out.probFeatured), sub: `${out.planned} pull` },
    { label: "Note", value: "Stima grezza", sub: "Non include soft pity / regole complete" },
  ];

  calcOutputEl.innerHTML = "";
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `
      <div class="label">${it.label}</div>
      <div class="value">${it.value}</div>
      <div class="sub">${it.sub}</div>
    `;
    calcOutputEl.append(div);
  }
}

function calcNow(values) {
  const jade = Math.max(0, clampInt(values.jade, 0, 999999999));
  const passes = Math.max(0, clampInt(values.passes, 0, 999999));
  const pity = clampInt(values.pity, 0, 89);
  const guaranteed = Boolean(values.guaranteed);

  const pullsFromJade = Math.floor(jade / 160);
  const totalPulls = pullsFromJade + passes;
  const toNextFiveStar = Math.max(0, 90 - pity);
  const worstToFeatured = guaranteed ? toNextFiveStar : toNextFiveStar + 90;

  const planned = Math.max(0, clampInt(values.planned, 0, 999999));
  const probFeatured = estimateProbAtLeastOneFeatured(planned, guaranteed);

  return {
    jade,
    passes,
    pity,
    guaranteed,
    pullsFromJade,
    totalPulls,
    toNextFiveStar,
    worstToFeatured,
    planned,
    probFeatured,
  };
}

bannerFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = String(bannerNameEl.value || "").trim();
  const start = new Date(bannerStartEl.value);
  const end = new Date(bannerEndEl.value);

  if (!name) return;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end.getTime() <= start.getTime()) return;

  store.banners.push({
    id: crypto.randomUUID(),
    name,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  writeStorage(store);
  bannerNameEl.value = "";
  bannerStartEl.value = "";
  bannerEndEl.value = "";
  renderBanners();
});

clearBannersBtn.addEventListener("click", () => {
  store.banners = [];
  writeStorage(store);
  renderBanners();
});

exportBannersBtn.addEventListener("click", async () => {
  const payload = JSON.stringify(store.banners, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    exportBannersBtn.textContent = "Copiato";
  } catch {
    exportBannersBtn.textContent = "Non copiato";
  } finally {
    setTimeout(() => {
      exportBannersBtn.textContent = "Esporta JSON";
    }, 900);
  }
});

calcFormEl.addEventListener("submit", (e) => {
  e.preventDefault();

  const values = {
    jade: jadeEl.value,
    passes: passesEl.value,
    pity: pityEl.value,
    guaranteed: guaranteedEl.checked,
    planned: plannedEl.value,
  };
  const out = calcNow(values);

  store.calc = {
    jade: out.jade,
    passes: out.passes,
    pity: out.pity,
    guaranteed: out.guaranteed,
    planned: out.planned,
  };
  writeStorage(store);
  renderCalc(out);
});

resetCalcBtn.addEventListener("click", () => {
  store.calc = {};
  writeStorage(store);
  jadeEl.value = "";
  passesEl.value = "";
  pityEl.value = "";
  plannedEl.value = "";
  guaranteedEl.checked = false;
  renderCalc(null);
});

function hydrateCalc() {
  const c = store.calc || {};
  jadeEl.value = c.jade ?? "";
  passesEl.value = c.passes ?? "";
  pityEl.value = c.pity ?? "";
  guaranteedEl.checked = Boolean(c.guaranteed);
  plannedEl.value = c.planned ?? "";
  const plannedDefault = Number.isFinite(Number(c.planned)) ? Number(c.planned) : null;
  if (plannedDefault == null && (c.jade != null || c.passes != null)) {
    const quick = calcNow(c);
    plannedEl.value = String(quick.totalPulls);
  }
  if (jadeEl.value !== "" || passesEl.value !== "" || pityEl.value !== "" || plannedEl.value !== "") {
    renderCalc(calcNow({ ...c, planned: plannedEl.value }));
  }
}

function hydrateBannerDefaults() {
  const now = new Date();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in21d = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
  bannerStartEl.value = toInputDateTimeValue(in2h);
  bannerEndEl.value = toInputDateTimeValue(in21d);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

hydrateBannerDefaults();
hydrateCalc();
renderBanners();
