// Vykreslí stránku v headless prehliadači a vráti jej obsah.
// Používa sa pre podniky, ktoré načítavajú menu cez JavaScript —
// obyčajné stiahnutie HTML u nich vráti prázdnu kostru.
//
// Prednostne vracia VYKRESLENÝ TEXT. Ten je presnejší aj lacnejší
// než obrázok. Screenshot sa použije až vtedy, keď v texte nie sú
// ani ceny — vtedy je menu zrejme vykreslené v grafike.

import { chromium } from "playwright";

const MA_CENY = /\d+[,.]\d{2}\s*(€|eur)/i;

export async function cezPrehliadac(z) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({
    viewport: { width: 900, height: 1600 },
    deviceScaleFactor: 2,
    locale: "sk-SK",
    timezoneId: "Europe/Bratislava"
  });

  try {
    await page.goto(z.url, { waitUntil: "networkidle", timeout: 60000 });

    // počkaj, kým sa objaví to, čo signalizuje načítané menu
    if (z.cakaj) {
      await page.waitForSelector(z.cakaj, { timeout: 25000 }).catch(() => {});
    } else {
      await page.waitForFunction(
        () => /\d+[,.]\d{2}\s*(€|eur)/i.test(document.body.innerText),
        { timeout: 25000 }
      ).catch(() => {});
    }
    await page.waitForTimeout(2500);   // dobehnutie animácií a dopočtov

    const oblast = z.vyrez ? page.locator(z.vyrez).first() : page.locator("body");
    const text = (await oblast.innerText().catch(() => "")).trim();

    if (MA_CENY.test(text) && text.length > 120) {
      return { typ: "text", text: text.slice(0, 30000), url: z.url, sposob: "text" };
    }

    // v texte nie sú ceny — menu je zrejme obrázok, odfoť to
    const buf = z.vyrez
      ? await oblast.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: true });

    return { typ: "obrazok", mime: "image/png", base64: buf.toString("base64"),
             url: z.url, sposob: "screenshot" };
  } finally {
    await browser.close();
  }
}
