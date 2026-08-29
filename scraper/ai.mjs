// Spoločná extrakcia menu cez Claude API

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Chýba ANTHROPIC_API_KEY"); process.exit(1); }

const MODEL = "claude-sonnet-5";   // lacnejšia alternatíva: "claude-haiku-4-5-20251001"
const DNI = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];

export const DATUM = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bratislava" });
export const DEN = DNI[new Date(DATUM + "T12:00:00").getDay()];

const SYSTEM = `Si extraktor denných menu zo slovenských reštaurácií.

Vstupy majú dva tvary:

A) TÝŽDENNÉ menu — jeden PDF alebo stránka so sekciami PONDELOK, UTOROK,
   STREDA, ŠTVRTOK, PIATOK. Jedlá bývajú číslované 1., 2., 3.
B) DENNÉ menu — stránka pre jeden konkrétny deň, členená podľa druhu jedla
   (Polievky, Hlavné jedlá, Šaláty, Prílohy, Dezerty). Čísla tu chýbajú.

Postupuj takto:
1. Nájdi dátum alebo rozsah dátumov (napr. "24.08. – 28.08." alebo
   "Streda 26. augusta"). Over, či zadaný dátum sedí. AK NESEDÍ, okamžite vráť
   {"stav":"chyba","polievky":[],"jedla":[]} — ide o menu z iného dňa.
2. Pri tvare A nájdi sekciu pre zadaný deň a ber jedlá IBA z nej.
   Pri tvare B ber celý obsah stránky, je už len pre jeden deň.
3. Vytiahni polievky a hlavné jedlá.

Vráť VÝHRADNE JSON, bez sprievodného textu a bez markdown blokov:
{
  "stav": "ok" | "zatvorene" | "chyba",
  "polievky": [{"nazov": string, "cena": number, "alergeny": number[]}],
  "jedla": [{"c": string, "nazov": string, "cena": number,
             "alergeny": number[], "veg": boolean}]
}

Pravidlá:
- "polievky" je pole — mnohé podniky ich ponúkajú viac.
- "c" je označenie z jedálneho lístka: "1", "2", "3". Pre jedlá bez čísla
  označené TIP, TIP ŠÉFKUCHÁRA alebo ŠPECIÁL použi "TIP". Ak jedlá číslované
  nie sú vôbec, očísluj ich sám v poradí, v akom sú uvedené.
- NÁZOV JE IBA NÁZOV. Pod názvom býva zoznam surovín ("kuracie prsia, vajcia,
  cesnak, korenie") — ten do názvu NEPATRÍ, vynechaj ho celý.
- Z názvu odstráň aj poradové číslo, cenu, gramáž a objem. Diakritiku zachovaj.
- Ceny sú čísla v eurách (7.90, nie "7,90 €"). Ak cena chýba, daj 0.
- AK MÁ JEDNA POLOŽKA DVE CENY podľa veľkosti porcie (napr. "0,4l 4,50 /
  0,3l 2,90"), použi cenu MENŠEJ porcie a jej objem pripoj k názvu
  v zátvorke: "Frankfurtská polievka s párkom (0,3 l)".
- "alergeny": čísla pri jedle. Bývajú ako "(1,3,7)", "/A6,9/" alebo malým
  písmom hneď za názvom ("3,7"). Inak prázdne pole.
- "veg": true len ak jedlo neobsahuje mäso ani ryby. Pomôcť môže označenie
  VEGAN, VEGE alebo ikona rastlinky. Pri pochybnostiach daj false.
- Reklamné vety ("Nezabudnite ochutnať…", "Čapujeme…") nie sú jedlá.
- Nápoje, kávu a pečivo predávané zvlášť vynechaj.
- Ak sa pre zadaný deň nedá nič nájsť, vráť stav "chyba" a prázdne polia.
  Nikdy si nič nedomýšľaj a nikdy nepouži jedlá z iného dňa ako náhradu.
- Ak je podnik v ten deň zatvorený, vráť stav "zatvorene". Pozor: staré
  oznamy o zatvorení z minulých rokov neplatia, riaď sa zadaným dátumom.`;

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
