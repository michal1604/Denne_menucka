// Spoločná extrakcia menu cez Claude API — používa scrape.mjs aj rucne.mjs

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Chýba ANTHROPIC_API_KEY"); process.exit(1); }

const MODEL = "claude-sonnet-5";   // lacnejšia alternatíva: "claude-haiku-4-5-20251001"
const DNI = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];

export const DATUM = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bratislava" });
export const DEN = DNI[new Date(DATUM + "T12:00:00").getDay()];

const SYSTEM = `Si extraktor denných menu zo slovenských reštaurácií.
Vstup je často TÝŽDENNÉ menu (pondelok až piatok na jednom PDF alebo stránke).
Vyber z neho IBA jedlá pre zadaný deň a vráť VÝHRADNE JSON, bez sprievodného
textu a bez markdown blokov.

Schéma:
{
  "stav": "ok" | "zatvorene" | "chyba",
  "polievka": {"nazov": string, "cena": number, "alergeny": number[]} | null,
  "jedla": [{"c": number, "nazov": string, "cena": number, "alergeny": number[], "veg": boolean}]
}

Pravidlá:
- Ceny sú čísla v eurách (8.90, nie "8,90 €"). Ak cena chýba, daj 0.
- Ak platí jedna cena pre celé menu, priraď ju každému jedlu.
- "alergeny": čísla uvedené pri jedle (napr. "(1,3,7)" alebo "A6,9"). Inak prázdne pole.
- "veg": true len ak jedlo neobsahuje mäso ani ryby.
- Z názvu odstráň poradové číslo, cenu a gramáž. Diakritiku zachovaj.
- Ak vstup obsahuje menu na iný týždeň než je zadaný dátum, vráť stav "chyba".
- Ak sa pre zadaný deň nedá nič nájsť, vráť stav "chyba" a prázdne polia.
- Ak je reštaurácia v ten deň zatvorená, vráť stav "zatvorene".`;

export async function extrahuj(r, vstup) {
  const pokyn = `Reštaurácia: ${r.nazov}\nHľadaný deň: ${DEN} ${DATUM}` +
                (r.poznamka ? `\nPoznámka: ${r.poznamka}` : "");

  const content = vstup.typ === "text"
    ? [{ type: "text", text: `${pokyn}\n\n--- OBSAH ---\n${vstup.text}` }]
    : [
        { type: vstup.typ === "pdf" ? "document" : "image",
          source: { type: "base64", media_type: vstup.mime, data: vstup.base64 } },
        { type: "text", text: pokyn }
      ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM,
                           messages: [{ role: "user", content }] })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
