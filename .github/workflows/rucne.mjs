// Ručné doplnenie menu pre podniky, ktoré publikujú len na Facebooku.
// Odfoť/stiahni si screenshot príspevku a spusti:
//
//   ANTHROPIC_API_KEY=sk-... node scraper/rucne.mjs forchetta ~/Downloads/menu.jpg
//
// Skript z obrázka vytiahne menu a uloží ho do data/rucne/<id>.json.
// Ranný scraper si ho odtiaľ prevezme, ak je z dnešného dňa.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { extrahuj, DATUM, DEN } from "./ai.mjs";

const [id, subor] = process.argv.slice(2);
if (!id || !subor) {
  console.error("Použitie: node scraper/rucne.mjs <id-restauracie> <obrazok.jpg>");
  process.exit(1);
}

const restauracie = JSON.parse(await readFile("scraper/restauracie.json", "utf8"));
const r = restauracie.find(x => x.id === id);
if (!r) { console.error(`Reštaurácia "${id}" nie je v restauracie.json`); process.exit(1); }

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
               ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };
const pripona = extname(subor).toLowerCase();
const mime = MIME[pripona];
if (!mime) { console.error(`Nepodporovaný formát: ${pripona}`); process.exit(1); }

const buf = await readFile(subor);
const menu = await extrahuj(r, {
  typ: mime === "application/pdf" ? "pdf" : "obrazok",
  mime, base64: buf.toString("base64")
});

await mkdir("data/rucne", { recursive: true });
await writeFile(`data/rucne/${id}.json`, JSON.stringify({ datum: DATUM, ...menu }, null, 2));

console.log(`\n${r.nazov} — ${DEN} ${DATUM}`);
if (menu.polievka) console.log(`  P. ${menu.polievka.nazov} — ${menu.polievka.cena} €`);
(menu.jedla || []).forEach(j => console.log(`  ${j.c}. ${j.nazov} — ${j.cena} €`));
console.log(`\nUložené do data/rucne/${id}.json`);
