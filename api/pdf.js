import puppeteer from 'puppeteer-core';
import chrome from 'chrome-aws-lambda';

// --- دالة للحصول على إعدادات تشغيل المتصفح ---
const getLaunchOptions = async () => {
  // البيئة الإنتاجية (مثل Vercel)
  if (process.env.NODE_ENV === 'production') {
    return {
      args: chrome.args,
      executablePath: await chrome.executablePath,
      headless: chrome.headless,
    };
  }
  // البيئة المحلية (جهازك)
  else {
    // **هام جداً:** تأكد من أن هذا المسار صحيح لجهازك
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

// --- معالج الطلبات الرئيسي لإنشاء PDF ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const { html } = req.body;
  if (!html) {
    return res.status(400).json({ ok: false, error: "HTML content is missing" });
  }

  let browser = null;
  try {
    const options = await getLaunchOptions();
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    // تعيين المحتوى وانتظار تحميل كل شيء
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // إنشاء PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    });

    // إرسال الملف
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Medical_Audit_Report-HQ.pdf"');
    res.send(pdfBuffer);

  } catch (err) {
    console.error("PDF Generation Error:", err);
    res.status(500).json({ ok: false, error: `PDF generation failed: ${err.message}` });
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}
