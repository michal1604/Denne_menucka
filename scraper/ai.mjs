// Spoločná extrakcia menu cez Claude API

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Chýba ANTHROPIC_API_KEY"); process.exit(1); }

const MODEL = "claude-sonnet-5";   // lacnejšia alternatíva: "claude-haiku-4-5-20251001"
const DNI = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];

export const DATUM = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bratislava" });
export const DEN = DNI[new Date(DATUM + "T12:00:00").getDay()];

const SYSTEM = `Si extraktor denných menu zo slovenských reštaurácií.
Vstup je takmer vždy TÝŽDENNÉ menu — jeden PDF alebo stránka so sekciami
PONDELOK, UTOROK, STREDA, ŠTVRTOK, PIATOK.

Postupuj takto:
1. Nájdi v hlavičke rozsah dátumov (napr. "24.08. – 28.08."). Over, či zadaný
   dátum do tohto rozsahu patrí. AK NEPATRÍ, okamžite vráť {"stav":"chyba",
   "polievky":[],"jedla":[]} — ide o menu z iného týždňa a je bezcenné.
2. Nájdi sekciu presne pre zadaný deň v týždni.
3. Vytiahni JEDLÁ IBA Z TEJTO SEKCIE. Nikdy nemiešaj jedlá z viacerých dní.

Vráť VÝHRADNE JSON, bez sprievodného textu a bez markdown blokov:
{
  "stav": "ok" | "zatvorene" | "chyba",
  "polievky": [{"nazov": string, "cena": number, "alergeny": number[]}],
  "jedla": [{"c": string, "nazov": string, "cena": number,
             "alergeny": number[], "veg": boolean}]
}

Pravidlá:
- "polievky" je pole — mnohé podniky ponúkajú dve. Uveď všetky pre daný deň.
- "c" je krátke označenie ako v jedálnom lístku: "1", "2", "3".
  Pre jedlá bez čísla označené TIP, TIP ŠÉFKUCHÁRA alebo ŠPECIÁL použi "TIP".
- Ceny sú čísla v eurách (7.90, nie "7,90 €"). Ak cena chýba, daj 0.
- "alergeny": čísla pri jedle, napr. "(1,3,7)" alebo "/A6,9/". Inak prázdne pole.
- "veg": true len ak jedlo neobsahuje mäso ani ryby.
- Z názvu odstráň poradové číslo, cenu, gramáž a slovo TIP. Diakritiku zachovaj.
- Reklamné vety ("Nezabudnite ochutnať…", "Čapujeme…") nie sú jedlá — vynechaj ich.
- Prílohy a nápoje predávané zvlášť (káva, citronáda, šalátik k menu) nie sú
  hlavné jedlá — vynechaj ich.
- Ak sa pre zadaný deň nedá nič nájsť, vráť stav "chyba" a prázdne polia.
  Nikdy si nič nedomýšľaj a nikdy nepouži jedlá z iného dňa ako náhradu.
- Ak je podnik v ten deň zatvorený, vráť stav "zatvorene".`;

export async function extrahuj(r, vstup) {
  const pokyn = `Podnik: ${r.nazov}\nHľadaný deň: ${DEN} ${DATUM}` +
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
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: SYSTEM,
                           messages: [{ role: "user", content }] })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  const menu = JSON.parse(text.replace(/```json|```/g, "").trim());

  menu.polievky = Array.isArray(menu.polievky) ? menu.polievky : [];
  menu.jedla = Array.isArray(menu.jedla) ? menu.jedla : [];
  return menu;
}
