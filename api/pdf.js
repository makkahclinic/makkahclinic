import puppeteer from 'puppeteer-core';
import chrome from 'chrome-aws-lambda';

// --- إعدادات Puppeteer للبيئات المختلفة (الإنتاج والمحلي) ---
const getLaunchOptions = async () => {
  if (process.env.NODE_ENV === 'production') {
    return {
      args: chrome.args,
      executablePath: await chrome.executablePath,
      headless: chrome.headless,
    };
  } else {
    // استخدم مسار Chrome المثبت على جهازك المحلي
    // لمستخدمي Mac: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
    // لمستخدمي Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
    const localChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; 
    return {
      args: [],
      executablePath: localChromePath,
      headless: true,
    };
  }
};

// --- دالة مساعدة لإرسال الأخطاء ---
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

// --- معالج طلبات إنشاء PDF ---
export default async function handler(req, res) {
  console.log("--- PDF Generation Request Received ---");

  if (req.method !== 'POST') {
    return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
  }

  const { html, lang = 'ar' } = req.body;
  if (!html) {
    return bad(res, 400, "Bad Request: HTML content is missing.");
  }

  let browser = null;
  try {
    const options = await getLaunchOptions();
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    // --- إعداد محتوى الصفحة بالـ HTML المستلم ---
    // نستخدم `setContent` لضمان تحميل جميع الأنماط والصور المضمنة (base64)
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // --- إنشاء PDF بجودة عالية ---
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, // مهم لطباعة الألوان والخلفيات
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px',
      },
    });

    // --- إرسال ملف PDF كاستجابة ---
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Medical_Audit_Report.pdf"');
    res.send(pdfBuffer);
    console.log("--- PDF Generated Successfully ---");

  } catch (err) {
    console.error("---!!!--- PDF Generation Error ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `PDF generation failed: ${err.message}`);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}
