// pages/api/pdf.js
import puppeteer from "puppeteer";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const bad = (res, code, msg) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json({ ok: false, error: msg });
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");

    const { html, lang = "ar" } = req.body || {};
    if (!html) return bad(res, 400, "Missing HTML content for PDF generation.");

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate((l) => { document.documentElement.dir = l === "ar" ? "rtl" : "ltr"; }, lang);

    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "2cm", right: "2cm", bottom: "2cm", left: "2cm" },
      printBackground: true,
    });

    await browser.close();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="Medical_Audit_Report.pdf"');
    res.send(pdfBuffer);
  } catch (e) {
    console.error("PDF generation error:", e);
    return bad(res, 500, `PDF generation failed: ${e.message}`);
  }
}
