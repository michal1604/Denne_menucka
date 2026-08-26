// Stiahne zdroje podnikov a uloží výsledok do data/menu.json
//   ANTHROPIC_API_KEY=sk-... node scraper/scrape.mjs        (Node 20+)

import { readFile, writeFile } from "node:fs/promises";
import { extrahuj, DATUM, DEN } from "./ai.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const nacitaj = url =>
  fetch(url, { headers: { "User-Agent": UA }, redirect: "follow",
               signal: AbortSignal.timeout(25000) });

/* ---------- objavenie PDF odkazu na stránke ----------
   PDF-ká majú v názve dátum týždňa, preto sa nesmú zadávať natvrdo.
   Vytiahneme VŠETKY odkazy a až potom filtrujeme — vzor sa nikdy
   nesmie skladať do jedného výrazu s okolím, lebo ".*" prekročí
   úvodzovky a zachytí niekoľko odkazov naraz. */
async function najdiPdf(stranka, vzor) {
  const res = await nacitaj(stranka);
  if (!res.ok) throw new Error(`stránka HTTP ${res.status}`);
  const html = await res.text();

  const vsetky = [...html.matchAll(/href\s*=\s*["']([^"'\s]+)["']/gi)].map(m => m[1]);
  const re = new RegExp(vzor, "i");
  const zhody = [...new Set(vsetky.filter(u => re.test(u) && /\.pdf(\?|#|$)/i.test(u)))]
    .map(u => new URL(u, res.url).href);

  if (!zhody.length) throw new Error(`na stránke nie je PDF podľa vzoru ${vzor}`);

  // pri viacerých vezmeme ten s najvyšším číslom v ceste (najnovší týždeň)
  const skore = u => (u.match(/\d+/g) || []).map(Number).reduce((a, b) => a * 1000 + b, 0);
  return zhody.sort((a, b) => skore(b) - skore(a))[0];
}

/* ---------- načítanie jedného zdroja ---------- */
async function zdrojNaVstup(z) {
  if (z.typ === "prehliadac") {
    const { cezPrehliadac } = await import("./prehliadac.mjs");
    return cezPrehliadac(z);
  }

  const url = z.typ === "pdf-odkaz" ? await najdiPdf(z.stranka, z.vzor) : z.url;
  const res = await nacitaj(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_000_000) throw new Error("PDF je príliš veľké");
    return { typ: "pdf", mime: "application/pdf", base64: buf.toString("base64"), url };
  }
  if (ct.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { typ: "obrazok", mime: ct.split(";")[0], base64: buf.toString("base64"), url };
  }
  return { typ: "text", text: naText(await res.text()), url };
}

function naText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br|td)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&euro;/g, "€")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 30000);
}

/* ---------- doterajší obsah, aby sa ručné opravy nezmazali ---------- */
let stare = {};
try {
  const p = JSON.parse(await readFile("data/menu.json", "utf8"));
  if (p.datum === DATUM) for (const r of p.restauracie) stare[r.id] = r;
} catch { /* prvý beh alebo iný deň — nevadí */ }

/* ---------- beh ---------- */
const restauracie = JSON.parse(await readFile("scraper/restauracie.json", "utf8"));
const vysledok = [];

for (const r of restauracie) {
  const zaklad = { id: r.id, nazov: r.nazov, adresa: r.adresa, cas: r.cas, url: r.url };
  let menu = null, sposob = "";
  const chyby = [];

  for (const z of r.zdroje || []) {
    if (z.typ === "rucne") { chyby.push("rucne: dopĺňa sa cez admin"); continue; }
    try {
      const vstup = await zdrojNaVstup(z);
      const m = await extrahuj(r, vstup);
      if (m.stav === "ok" && (m.jedla.length || m.polievky.length)) {
        menu = m; sposob = vstup.sposob || z.typ; break;
      }
      if (m.stav === "zatvorene") { menu = m; break; }
      chyby.push(`${z.typ}: menu pre ${DEN} sa nenašlo`);
    } catch (e) {
      chyby.push(`${z.typ}: ${e.message}`);
    }
  }

  // Automatika zlyhala — ak už dnes existuje ručne doplnené menu, necháme ho.
  if (!menu && stare[r.id]?.stav === "ok") {
    menu = { stav: "ok", polievky: stare[r.id].polievky || [], jedla: stare[r.id].jedla || [] };
    console.log(`= ${r.nazov} — ponechané dnešné ručné menu`);
  } else if (menu) {
    console.log(`✓ ${r.nazov} — ${menu.polievky.length} pol. + ${menu.jedla.length} jedál (${sposob})`);
  } else {
    menu = { stav: "chyba", polievky: [], jedla: [] };
    console.log(`✗ ${r.nazov} — ${chyby.join(" | ")}`);
  }

  vysledok.push({ ...zaklad, ...menu });
}

await writeFile("data/menu.json", JSON.stringify({
  datum: DATUM, den: DEN,
  aktualizovane: new Date().toISOString(),
  restauracie: vysledok
}, null, 2));

console.log(`\nHotovo: ${vysledok.filter(r => r.stav === "ok").length}/${vysledok.length}.`);
