// pages/api/pdf.js
import puppeteer from "puppeteer";

export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

export default async function handler(req, res){
  try{
    if (req.method !== 'POST') { res.status(405).json({ok:false, error:'Method Not Allowed'}); return; }
    const { html = "", lang = "ar" } = req.body || {};
    if (!html) { res.status(400).json({ok:false, error:'No HTML provided'}); return; }

    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}"><head>
      <meta charset="utf-8" />
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        html,body{font-family:'Tajawal',system-ui;margin:0;padding:0}
        @page { size: A4; margin: 12mm; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
    </head><body>${html}</body></html>`, { waitUntil: 'networkidle0' });

    await page.emulateMediaType('screen'); // طباعة بألوان الشاشة
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Medical_Audit_Report.pdf"');
    res.status(200).send(pdf);
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
