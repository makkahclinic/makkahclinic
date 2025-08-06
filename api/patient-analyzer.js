// /api/patient-analyzer.js - ANALYTICAL, HUMAN-CENTERED VERSION FOR PATIENTS

const systemInstruction = `
أنت طبيب استشاري متخصص في الطب الباطني والرعاية الشاملة. مهمتك هي مساعدة المريض على فهم حالته بناءً على ما أدخله من أعراض، أدوية، وتشخيصات.

**أسلوبك يجب أن يكون:**
- إنساني، توعوي، مهني.
- لا تستخدم لغة نقد تأميني، بل لغة داعمة.
- استكشف الخلفيات المحتملة للمشاكل (مثلاً: التهاب مسالك ➝ كلى).
- اقترح فحوص ناقصة، وتخصصات لمراجعتها.
- خاطب المريض بـ "أنت"، وبيّن التحذيرات بلغة محترمة.

**هيكل التقرير الإلزامي:**
1. <h3>تحليل حالتك الصحية</h3>
2. **ملخص البيانات المدخلة** (العمر، الجنس، الأعراض، الأدوية، تحاليل، إلخ).
3. **تحليل سريري شامل**:
   - العلاقات بين الأعراض والتاريخ الطبي.
   - تحذيرات تخص الأدوية أو الأعراض.
4. **اقتراحات الرعاية الصحية**:
   - فحوص ضرورية.
   - تخصصات يُنصح بمراجعتها.
   - أسئلة تقترحها على طبيبك.
5. **توضيحات طبية مبسطة** عند الحاجة.
6. **الخاتمة:** "هذا التقرير مبدئي ولا يغني عن مراجعة الطبيب المختص."

**المصادر الموصى بها:**
UpToDate, Mayo Clinic, Medscape, WHO, FDA
`;

function buildUserPrompt(caseData) {
    return `
**بيانات المريض:**

- العمر: ${caseData.age || "غير محدد"}
- الجنس: ${caseData.sex || "غير محدد"}
- الأعراض: ${caseData.symptoms || "لا يوجد"}
- التاريخ الصحي: ${caseData.history || "لا يوجد"}
- التحاليل: ${caseData.labs || "لا يوجد"}
- الأدوية: ${caseData.medications || "لا يوجد"}
- حامل: ${caseData.isPregnant ? "نعم" : "لا"}
- مدخن: ${caseData.isSmoker ? "نعم" : "لا"}
    `;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body);
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        const payload = {
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0.4, topP: 0.9, topK: 40 },
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error("فشل النموذج في إنشاء التقرير.");
        }

        const reportHtml = result.candidates[0].content.parts[0].text;
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server Error in /api/patient-analyzer:", err);
        return res.status(500).json({
            error: "حدث خطأ أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
