// pages/api/pdf.js
import puppeteer from "puppeteer";

export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

const ok  = (res, buf) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="Medical_Audit_Report.pdf"');
  res.send(buf);
};
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Only POST is accepted.");
    const { html, lang = "ar" } = req.body || {};
    if (!html) return bad(res, 400, "Missing HTML content.");

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true
    });
    const page = await browser.newPage();

    await page.setContent(
      `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
          body{font-family:'Tajawal',system-ui,sans-serif; padding:2cm; box-sizing:border-box; color:#111}
          .report-section{page-break-inside:avoid; margin-bottom:18px}
          .audit-table{width:100%;border-collapse:collapse}
          .audit-table th,.audit-table td{border:1px solid #ddd;padding:8px;vertical-align:top}
          .risk-critical td{background:#fce8e6}.risk-warning td{background:#fff0e1}.risk-ok td{background:#e6f4ea}
        </style>
       </head><body>${html}</body></html>`,
      { waitUntil: "networkidle0" }
    );

    // انتظر تحميل الخطوط لمنع صفحات بيضاء
    await page.evaluate(async () => { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } });

    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "18mm", right: "18mm", bottom: "18mm", left: "18mm" } });
    await browser.close();
    return ok(res, pdf);
  } catch (e) {
    console.error("PDF error:", e);
    return bad(res, 500, `PDF generation failed: ${e.message}`);
  }
}
