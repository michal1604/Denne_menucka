// Stiahne zdroje reštaurácií, nechá ich spracovať cez Claude API
// a uloží výsledok do data/menu.json
//
// Spustenie:  ANTHROPIC_API_KEY=sk-... node scraper/scrape.mjs
// Node 20+ (kvôli vstavanému fetch)

import { readFile, writeFile } from "node:fs/promises";
import { extrahuj, DATUM, DEN } from "./ai.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const nacitaj = (url, ...typy) =>
  fetch(url, { headers: { "User-Agent": UA, "Accept": typy.join(",") || "*/*" },
               redirect: "follow", signal: AbortSignal.timeout(25000) });

/* ---------- objavenie PDF odkazu na stránke ---------- */
// PDF-ká majú v názve dátum týždňa, takže sa nesmú zadávať natvrdo.
// Namiesto toho prehľadáme stránku a vezmeme najnovší zhodný odkaz.
async function najdiPdf(stranka, vzor) {
  const res = await nacitaj(stranka, "text/html");
  if (!res.ok) throw new Error(`stránka HTTP ${res.status}`);
  const html = await res.text();

  const re = new RegExp(`href\\s*=\\s*["']([^"']*${vzor}[^"']*)["']`, "gi");
  const odkazy = [...html.matchAll(re)].map(m => new URL(m[1], res.url).href);
  if (!odkazy.length) throw new Error(`na stránke nie je odkaz podľa vzoru ${vzor}`);

  // pri viacerých vyberieme ten s najvyšším číslom v názve (najnovší týždeň)
  const skore = u => (u.match(/\d+/g) || []).map(Number).reduce((a, b) => a * 1000 + b, 0);
  return [...new Set(odkazy)].sort((a, b) => skore(b) - skore(a))[0];
}

/* ---------- načítanie jedného zdroja ---------- */
async function zdrojNaVstup(z) {
  if (z.typ === "rucne") {
    const f = `data/rucne/${z.id}.json`;
    const obsah = JSON.parse(await readFile(f, "utf8"));
    if (obsah.datum !== DATUM) throw new Error(`ručný zápis je z ${obsah.datum}, nie z dneška`);
    return { hotove: obsah };
  }

  const url = z.typ === "pdf-odkaz" ? await najdiPdf(z.stranka, z.vzor) : z.url;
  const res = await nacitaj(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (z.typ === "pdf" || z.typ === "pdf-odkaz" || ct.includes("pdf")) {
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

// hrubé očistenie HTML na čitateľný text — AI si s tým poradí
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

/* ---------- beh: skúšaj zdroje po rade, kým jeden nevyjde ---------- */
const restauracie = JSON.parse(await readFile("scraper/restauracie.json", "utf8"));
const vysledok = [];

for (const r of restauracie) {
  const zaklad = { id: r.id, nazov: r.nazov, adresa: r.adresa, cas: r.cas, url: r.url };
  let menu = null, chyby = [];

  for (const z of r.zdroje) {
    try {
      const vstup = await zdrojNaVstup({ ...z, id: r.id });
      const m = vstup.hotove ?? await extrahuj(r, vstup);
      if (m.stav === "ok" && (m.jedla?.length || m.polievka)) { menu = m; break; }
      if (m.stav === "zatvorene") { menu = m; break; }
      chyby.push(`${z.typ}: prázdne menu`);
    } catch (e) {
      chyby.push(`${z.typ}: ${e.message}`);
    }
  }

  if (menu) {
    vysledok.push({ ...zaklad, ...menu });
    console.log(`✓ ${r.nazov} — ${menu.jedla?.length ?? 0} jedál`);
  } else {
    vysledok.push({ ...zaklad, stav: "chyba", polievka: null, jedla: [] });
    console.log(`✗ ${r.nazov} — ${chyby.join(" | ")}`);
  }
}

await writeFile("data/menu.json", JSON.stringify({
  datum: DATUM, den: DEN,
  aktualizovane: new Date().toISOString(),
  restauracie: vysledok
}, null, 2));

console.log(`\nHotovo: ${vysledok.filter(r => r.stav === "ok").length}/${vysledok.length} úspešných.`);
