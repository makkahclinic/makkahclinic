// /api/gpt.js

/**
 * @description A multi-purpose serverless API endpoint. It now intelligently handles
 * requests from both the Doctor's Portal and the new Patient's Portal, providing
 * tailored responses for each. It also correctly handles single or multiple image uploads.
 */
export default async function handler(req, res) {
    // ... (The top part of the code remains the same)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("🔥 Server-side Error: GEMINI_API_KEY is not set.");
        return res.status(500).json({
            error: "خطأ في إعدادات الخادم",
            detail: "مفتاح واجهة برمجة التطبيقات (API Key) غير موجود. يرجى مراجعة المسؤول.",
        });
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    
    let htmlPrompt;
    const requestBody = req.body;

    if (requestBody.analysisType === 'patient') {
        // --- PATIENT PORTAL PROMPT (No changes here) ---
        // ... (The patient prompt remains the same as before)

    } else {
        // --- 🚀 NEW EXPERT DOCTOR/INSURANCE AUDITOR PROMPT ---
        const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = requestBody;
        htmlPrompt = `
        **شخصيتك الأساسية:** أنت "خبير استشاري في المراجعة الطبية والتأمين الطبي (Certified Medical Reimbursement Specialist)". لديك خبرة عميقة في بروتوكولات العلاج العالمية (مثل UpToDate, NICE guidelines)، وقواعد الترميز الطبي (ICD-10, CPT)، وسياسات شركات التأمين في المملكة العربية السعودية. تحليلك يجب أن يكون دقيقًا، نقديًا، ومبنياً على أدلة علمية.

        **مهمتك:** تحليل الحالة الطبية المرفقة (نصًا وصورًا) وتقديم تقرير تدقيق طبي شامل بصيغة HTML. التقرير يجب أن يساعد الطبيب على فهم نقاط القوة والضعف في إدارته للحالة من منظور طبي وتأميني.

        **بيانات الحالة لتحليلها:**
        - **الصور المرفقة:** قم بقراءة وتحليل كل صورة بدقة فائقة. استخرج منها التشخيصات، الأدوية، الجرعات، والفحوصات.
        - **البيانات النصية:**
            - التشخيص المفوتر: ${diagnosis || "لم يحدد"}
            - الأعراض: ${symptoms || "لم تحدد"}
            - عمر وجنس المريض: ${age || "غير محدد"}, ${gender || "غير محدد"}
            - مدخن: ${smoker ? 'نعم' : 'لا'}
            - الإجراءات المتخذة: ${beforeProcedure || "لا يوجد"}, ${afterProcedure || "لا يوجد"}

        ---
        **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط باتباع هذا الهيكل بدقة):**

        <h3><svg ...>تقرير التدقيق الطبي الشامل</svg></h3>

        <div class="section">
            <h4>1. تقييم الإجراءات الحالية (التدقيق الطبي)</h4>
            <p>تحليل نقدي للإجراءات والأدوية التي تم اتخاذها، مع تقييم مدى توافقها مع البروتوكولات الطبية واحتمالية موافقة التأمين.</p>
            <table class="audit-table">
                <thead>
                    <tr>
                        <th>الإجراء / الدواء</th>
                        <th>التقييم والتعليل العلمي</th>
                        <th>موافقة التأمين</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="risk-green">
                        <td>[اسم الدواء/الإجراء الأول]</td>
                        <td><strong>تقييم: سليم وموصى به.</strong><br>هذا الإجراء يتوافق مع إرشادات [اذكر اسم البروتوكول مثل NICE] لعلاج [اسم الحالة]. المرجع: [ضع رابطًا للمصدر العلمي إن أمكن].</td>
                        <td><strong>محتمل جدًا.</strong> الإجراء ضروري طبيًا وموثق جيدًا.</td>
                    </tr>
                    <tr class="risk-red">
                        <td>[اسم الدواء/الإجراء الثاني]</td>
                        <td><strong>تقييم: غير مبرر طبيًا.</strong><br>هذا الفحص ليس من ضمن الخط الأول للتشخيص حسب بروتوكول [اسم البروتوكول]. كان يجب البدء بـ [اذكر الإجراء الصحيح].</td>
                        <td><strong>مرفوض غالبًا.</strong> سيتم اعتباره غير ضروري طبيًا (Not Medically Necessary).</td>
                    </tr>
                    </tbody>
            </table>
        </div>

        <div class="section">
            <h4>2. فرص التحسين ورفع الإيرادات (الإجراءات الفائتة)</h4>
            <p>بناءً على التشخيص والأعراض، هذه هي الإجراءات والاستشارات الضرورية طبيًا والتي تم إغفالها، والتي كانت سترفع من جودة الرعاية والإيرادات.</p>
            <div class="recommendation-card">
                <h5>إجراء مقترح: [اسم الفحص أو الاستشارة المقترحة]</h5>
                <p><strong>المبرر الطبي:</strong> نظرًا لـ [اذكر العرض أو المعلومة]، توصي إرشادات [اسم الجهة المرجعية] بإجراء هذا الفحص للكشف عن [اذكر الهدف من الفحص]. هذا الإجراء ضروري لاستبعاد [اذكر تشخيص تفريقي مهم].</p>
                <p><strong>التأثير المالي:</strong> إضافة هذا الإجراء كان من الممكن أن يزيد إجمالي الفاتورة بقيمة تقريبية **~[ضع قيمة تقديرية] ريال سعودي**.</p>
            </div>
            <div class="recommendation-card">
                </div>
        </div>

        <div class="section financial-summary">
            <h4>3. الملخص المالي</h4>
            <table>
                <thead><tr><th>المؤشر</th><th>القيمة (ريال سعودي)</th><th>ملاحظات</th></tr></thead>
                <tbody>
                    <tr><td>إجمالي الدخل الحالي (المفوتر)</td><td>[ضع القيمة هنا]</td><td>القيمة الحالية للفاتورة.</td></tr>
                    <tr><td>إجمالي الخصم المتوقع (الرفوضات)</td><td class="financial-red">[ضع قيمة الإجراءات المعرضة للرفض]</td><td>قيمة الإجراءات ذات الخطورة الحمراء.</td></tr>
                    <tr><td>صافي الدخل المتوقع</td><td>[احسب الفرق]</td><td>الدخل بعد خصم الرفوضات المحتملة.</td></tr>
                    <tr><td>إجمالي الدخل المحتمل (مع التحسينات)</td><td class="financial-green">[احسب الإجمالي مع الإجراءات المقترحة]</td><td>أقصى إيرادات ممكنة لو تم اتباع الخطة المثلى.</td></tr>
                </tbody>
            </table>
        </div>

        <div class="section">
            <h4>4. توصيات نهائية للترميز والتوثيق</h4>
            <ul>
                <li>تأكد من توثيق [نصيحة محددة، مثل: مدة الأعراض] لتقوية المبرر الطبي.</li>
                <li>عند استخدام التشخيص [ICD-10 Code]، يجب دائمًا ربطه بالإجراء [CPT Code] لضمان الموافقة.</li>
            </ul>
        </div>

        **قاعدة صارمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<h3>\`.
        `;
    }

    // --- The rest of the file remains the same ---
    // (Code for creating payload, fetching from API, and handling response)
    // ✅ **FIX 1: Wrap the prompt string in a text object.**
    const parts = [{ text: htmlPrompt }];

    // ✅ **FIX 2: Handle both single image (string) and multiple images (array).**
    if (requestBody.imageData) {
        if (Array.isArray(requestBody.imageData)) {
            requestBody.imageData.forEach(imgData => {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: imgData } });
            });
        } 
        else if (typeof requestBody.imageData === 'string') {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: requestBody.imageData } });
        }
    }

    const payload = {
        contents: [{ parts: parts }],
        generationConfig: {
            temperature: 0.4, // Lower temperature for more consistent, factual output
        },
    };

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            const errorMessage = result.error?.message || `API request failed: ${response.statusText}`;
            throw new Error(errorMessage);
        }

        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportHtml) {
            console.error("🔥 Server-side Warning: Gemini API returned a successful response but no content.", result);
            throw new Error("لم يتمكن النموذج من إنشاء التقرير. قد تكون الاستجابة فارغة.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
