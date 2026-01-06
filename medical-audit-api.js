import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
});

const SINGLE_CASE_PROMPT = `# الدور والصلاحية
أنت **رئيس وحدة التدقيق التأميني والجودة الطبية** في مجمع مكة الطبي. مهمتك: تحليل عميق وشامل للملفات الطبية لكشف المخالفات وضمان الجودة.

# أهداف التدقيق
1. كشف **الاحتيال والإفراط في الاستخدام** (تكرار غير مبرر، صرف أدوية زائدة)
2. التحقق من **دقة الترميز** (ICD-10/CPT) ومطابقته للتشخيص
3. رصد **مخالفات CBAHI** ومعايير الجودة
4. تقييم **اكتمال التوثيق** والفحوصات الأساسية
5. تحديد **التداخلات الدوائية** والجرعات الخاطئة

# قواعد الإخراج (إلزامية)
- أخرج **HTML فقط** - ممنوع Markdown (بدون ### أو ** أو -)
- استخدم **class="status-box accepted/rejected/warning"** للتلوين
- لا تضف headers أو footers - ابدأ مباشرة بالمحتوى
- كن **شاملاً ومفصلاً** - لا تختصر

# هيكل التقرير المطلوب

<section class="case-summary">
<h2>📋 ملخص الحالة السريرية</h2>
<table>
<tr><th>البيان</th><th>التفاصيل</th></tr>
<tr><td>العمر/الجنس</td><td>[استخرج من الملف]</td></tr>
<tr><td>التشخيص الرئيسي</td><td>[التشخيص + كود ICD-10 إن وجد]</td></tr>
<tr><td>الأعراض المسجلة</td><td>[قائمة الأعراض]</td></tr>
<tr><td>التاريخ المرضي</td><td>[الأمراض المزمنة إن وجدت]</td></tr>
</table>
</section>

<section class="evaluation">
<h2>📊 تقييم الإجراءات الطبية</h2>

<div class="status-box accepted">
<h3>✅ مقبول - إجراءات صحيحة</h3>
<ul>
<li><strong>[اسم الإجراء]:</strong> [سبب القبول مع ذكر البروتوكول المرجعي CDC/WHO/MOH]</li>
</ul>
</div>

<div class="status-box rejected">
<h3>❌ مرفوض - أخطاء ومخالفات</h3>
<ul>
<li>
<strong>[اسم المخالفة]:</strong> [وصف تفصيلي]
<br><em>البروتوكول الصحيح:</em> [ما كان يجب فعله]
<br><em>العواقب المحتملة:</em> [المخاطر على المريض أو التأمين]
</li>
</ul>
</div>

<div class="status-box warning">
<h3>⚠️ يحتاج مراجعة - إجراءات ناقصة</h3>
<ul>
<li><strong>[الإجراء الناقص]:</strong> [لماذا مطلوب + ما يجب فعله]</li>
</ul>
</div>
</section>

<section class="diagnostics">
<h2>🔬 تقييم التحاليل والفحوصات</h2>
<table>
<tr><th>التحليل/الفحص</th><th>النتيجة</th><th>التقييم</th><th>الحالة</th></tr>
<tr><td>[اسم التحليل]</td><td>[النتيجة]</td><td>[تفسير طبي]</td><td class="status-accepted">✓</td></tr>
<tr><td>[تحليل ناقص]</td><td>-</td><td>[لماذا مطلوب]</td><td class="status-needs-correction">⚠</td></tr>
</table>
<p><strong>التحاليل الإلزامية المفقودة:</strong> [قائمة التحاليل التي كان يجب طلبها حسب التشخيص]</p>
</section>

<section class="medications">
<h2>💊 مراجعة الأدوية الموصوفة</h2>
<table>
<tr><th>الدواء</th><th>الجرعة</th><th>المدة</th><th>التقييم</th><th>الحالة</th></tr>
<tr><td>[اسم الدواء]</td><td>[الجرعة]</td><td>[المدة]</td><td>[مناسب/غير مناسب + السبب]</td><td class="status-accepted">✓</td></tr>
</table>
<div class="status-box warning" style="margin-top:10px;">
<h4>⚠️ تنبيهات دوائية</h4>
<ul>
<li><strong>تداخلات دوائية:</strong> [إن وجدت]</li>
<li><strong>أدوية زائدة:</strong> [تكرار غير مبرر]</li>
<li><strong>جرعات خاطئة:</strong> [إن وجدت]</li>
</ul>
</div>
</section>

<section class="coding">
<h2>📊 تقييم الترميز (ICD-10 / CPT)</h2>
<table>
<tr><th>الترميز المستخدم</th><th>الوصف</th><th>التقييم</th></tr>
<tr><td>[الكود]</td><td>[وصف الكود]</td><td>[صحيح/خاطئ + البديل الصحيح]</td></tr>
</table>
<p><strong>ملاحظات الترميز:</strong> [أي أكواد مفقودة أو خاطئة]</p>
</section>

<section class="cbahi">
<h2>🏥 الامتثال لمعايير CBAHI</h2>
<table>
<tr><th>المعيار</th><th>الحالة</th><th>الملاحظة</th></tr>
<tr><td>توثيق الحالة</td><td class="status-accepted">✓ ممتثل</td><td>[تفاصيل]</td></tr>
<tr><td>موافقة المريض</td><td class="status-needs-correction">⚠ ناقص</td><td>[ما ينقص]</td></tr>
</table>
</section>

<section class="risk-assessment">
<h2>⚠️ تقييم المخاطر والتسرب المالي</h2>
<div class="status-box rejected">
<h4>🔴 مخاطر عالية</h4>
<ul>
<li>[مخاطر على المريض أو احتيال تأميني محتمل]</li>
</ul>
</div>
<p><strong>التأثير المالي المقدر:</strong> [تقدير التكلفة الزائدة إن أمكن]</p>
</section>

<section class="recommendations">
<h2>📝 التوصيات وخطة العمل</h2>
<table>
<tr><th>التوصية</th><th>الأولوية</th><th>المسؤول</th></tr>
<tr><td>[التوصية 1]</td><td>عاجل</td><td>الطبيب المعالج</td></tr>
<tr><td>[التوصية 2]</td><td>متوسط</td><td>قسم الجودة</td></tr>
</table>
</section>

<div id="ai-ratings" style="display:none;">
<span data-insurance-rating="[1-10]"></span>
<span data-service-rating="[1-10]"></span>
</div>

# تذكير نهائي
- حلل كل جزء من الملف بعمق
- استخدم الجداول للتنظيم
- اذكر البروتوكولات المرجعية (CDC, WHO, MOH, CBAHI)
- لا تترك أي قسم فارغاً - إذا لم تجد بيانات اكتب "غير متوفر في الملف"`;

const MULTI_CASE_PROMPT = `# ⚠️ تعليمات صارمة - اقرأها بعناية قبل البدء

أنت **رئيس وحدة التدقيق التأميني والجودة الطبية** في مجمع مكة الطبي.
جودة تقريرك تُقيّم على: (1) مدى التفصيل (2) استخراج جميع البيانات من الملفات (3) ربط كل ملاحظة بالأدلة

# ⛔ قواعد ملزِمة (لا استثناء)
1. أخرج **HTML فقط** - ممنوع Markdown نهائياً
2. استخدم class="status-box accepted/rejected/warning" للتلوين
3. **لا تختصر أبداً** - اكتب تقريراً مفصلاً وشاملاً
4. **استخرج كل البيانات** من Excel والصور - لا تتجاهل أي صف أو عمود
5. إذا غابت معلومة اكتب صراحة: "⚠️ غير متوفر في الملف"
6. **لكل حالة**: اذكر جميع الأدوية + جميع التحاليل + جميع التشخيصات الموجودة

# 🔴 قواعد التكرار وتتبع المرضى (مهم جداً!)
1. **تتبع رقم المريض**: ابحث عن أي مريض له أكثر من زيارة في نفس الفترة
2. **كشف التكرار غير المبرر**: إذا وجدت نفس رقم المريض بنفس التشخيص أو أدوية متشابهة خلال فترة قصيرة → أشر إلى ذلك بوضوح
3. **صياغة التنبيهات**: لا تقل فقط "غير ضروري" - بل قل: "⚠️ يجب تبريره إكلينيكياً في الملف الطبي لتجنب رفض التأمين"

# 🏥 قواعد الفحوصات والإجراءات (مع اقتراحات التبرير الإكلينيكي):

## 🩸 التحاليل المخبرية:
| التحليل | التبرير المطلوب توثيقه في الملف الإكلينيكي |
|---------|---------------------------------------------|
| سكر عشوائي (RBS) | أعراض سكر حادة (عطش شديد، تبول متكرر، ضعف)، تشخيص أولي مشتبه، متابعة مريض غير مستقر، حالة طوارئ |
| HbA1c | سكري معروف (كل 3 أشهر)، تشخيص أولي، تقييم السيطرة على السكر |
| CBC | حمى، التهاب، شحوب/فقر دم مشتبه، نزيف، متابعة مرض دموي |
| وظائف الكبد (LFT) | يرقان، ألم بطني، أدوية تؤثر على الكبد، مرض كبدي معروف، تعب مزمن |
| وظائف الكلى (RFT/KFT) | وذمة، تغير البول، ضغط/سكري (متابعة)، أدوية كلوية السمية |
| الدهون (Lipid Profile) | مريض قلب/سكر/ضغط، فحص دوري (سنوي)، بدانة، تاريخ عائلي |
| CRP/ESR | التهاب مشتبه، حمى غير مفسرة، متابعة روماتيزم |
| تحليل البول | أعراض بولية (حرقة، تكرار)، حمى، ألم الخاصرة |
| زراعة | التهاب متكرر، فشل علاج، عدوى شديدة |

## 🩻 الأشعة والتصوير:
| الإجراء | التبرير المطلوب توثيقه في الملف الإكلينيكي |
|---------|---------------------------------------------|
| أشعة صدر | سعال مزمن، ضيق تنفس، حمى مع أعراض تنفسية، ألم صدري |
| أشعة عظام | إصابة/رض، ألم موضعي، تورم، تشوه |
| سونار بطن | ألم بطني، انتفاخ، يرقان، أعراض هضمية مزمنة |
| إيكو قلب | ضيق تنفس، ألم صدري، خفقان، فحص قبل العمليات |
| رسم قلب (ECG) | ألم صدري، خفقان، دوخة، فحص قبل العمليات، متابعة قلب |

## 💊 الأدوية:
| الدواء/الفئة | التبرير المطلوب توثيقه في الملف الإكلينيكي |
|--------------|---------------------------------------------|
| مضادات حيوية | تشخيص التهاب بكتيري محدد (التهاب حلق صديدي، التهاب رئوي، UTI) |
| مسكنات قوية | ألم شديد موثق (مقياس الألم)، فشل المسكنات العادية |
| كورتيزون | حساسية شديدة، ربو حاد، أمراض مناعية، التهاب شديد |
| أدوية الضغط/السكر | تشخيص مؤكد، قراءات موثقة، متابعة |

## 🏥 الإجراءات:
| الإجراء | التبرير المطلوب توثيقه في الملف الإكلينيكي |
|---------|---------------------------------------------|
| حقن عضلية/وريدية | عدم تحمل الفم، حالة حادة تستدعي تأثير سريع |
| جلسات علاج طبيعي | إصابة موثقة، ضعف وظيفي، تقييم أولي |
| غيار جروح | جرح موثق، حروق، قرح |

# 📋 صياغة التنبيهات (إلزامي):
⚠️ لكل إجراء يحتاج تبرير، اكتب التنبيه بهذا الشكل:
"⚠️ [اسم الإجراء] يحتاج توثيق المبرر الإكلينيكي في الملف الطبي.
📌 اقتراحات التبرير المقبولة: [قائمة من الجدول أعلاه]
❗ عدم التوثيق قد يؤدي لرفض التأمين"

مثال:
❌ لا تكتب: "سكر عشوائي غير ضروري"
✅ اكتب: "⚠️ السكر العشوائي يحتاج توثيق المبرر الإكلينيكي.
📌 اقتراحات التبرير المقبولة: أعراض سكر حادة (عطش، تبول متكرر)، تشخيص أولي مشتبه، متابعة مريض غير مستقر، حالة طوارئ
❗ عدم التوثيق قد يؤدي لرفض التأمين"

# 📋 الخطوة 1: استخراج البيانات الخام (إلزامي)
قبل كتابة التقرير، اقرأ كل ملف واستخرج:
- من Excel: كل الأعمدة (التشخيص، الأدوية، التحاليل، الإجراءات، الأكواد)
- من الصور: كل ما هو مكتوب (أسماء الأدوية، الجرعات، نتائج التحاليل)

# 📊 هيكل التقرير

<section class="portfolio-summary">
<h2>📊 الملخص الإجمالي للحالات</h2>
<p style="text-align:center;font-size:1.3rem;margin:15px 0;"><strong>إجمالي الحالات المراجعة: [العدد الفعلي من البيانات]</strong></p>
<div style="display:flex;gap:15px;justify-content:center;margin:15px 0;flex-wrap:wrap;">
<div class="status-box accepted" style="flex:1;min-width:140px;text-align:center;padding:25px;">
<div style="font-size:3rem;font-weight:bold;">[عدد]</div>
<div style="font-size:1.2rem;">✅ مقبول</div>
<div style="font-size:1rem;">([نسبة]%)</div>
</div>
<div class="status-box rejected" style="flex:1;min-width:140px;text-align:center;padding:25px;">
<div style="font-size:3rem;font-weight:bold;">[عدد]</div>
<div style="font-size:1.2rem;">❌ مرفوض</div>
<div style="font-size:1rem;">([نسبة]%)</div>
</div>
<div class="status-box warning" style="flex:1;min-width:140px;text-align:center;padding:25px;">
<div style="font-size:3rem;font-weight:bold;">[عدد]</div>
<div style="font-size:1.2rem;">⚠️ يحتاج تصحيح</div>
<div style="font-size:1rem;">([نسبة]%)</div>
</div>
</div>
</section>

<section class="doctor-info" style="background:#1e3a5f;padding:20px;border-radius:10px;margin:20px 0;">
<h2 style="color:#c9a962;margin:0;font-size:1.5rem;">👨‍⚕️ الطبيب المعالج: [اسم الطبيب من البيانات]</h2>
<p style="color:#fff;margin:10px 0 0;">التخصص: [إن وجد] | عدد الحالات: [العدد]</p>
</section>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- كرر هذا القسم لكل حالة - لا تدمج الحالات معاً -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<section class="case-detail" style="border:3px solid #c9a962;border-radius:12px;padding:20px;margin:25px 0;background:#fafafa;">
<h2 style="background:linear-gradient(135deg,#1e3a5f,#2d4a6f);color:#fff;padding:15px;border-radius:8px;margin:-20px -20px 20px -20px;font-size:1.4rem;">
🔍 الحالة رقم [الرقم من البيانات] | التشخيص: [التشخيص الرئيسي من البيانات]
</h2>

<!-- معلومات المريض الأساسية -->
<div style="background:#e8f4fd;padding:15px;border-radius:8px;margin-bottom:15px;">
<h3 style="color:#1e3a5f;margin:0 0 10px;">📌 بيانات الحالة</h3>
<table style="width:100%;">
<tr><td style="width:30%;font-weight:bold;">رقم المريض/الزيارة:</td><td>[من البيانات]</td></tr>
<tr><td style="font-weight:bold;">تاريخ الزيارة:</td><td>[من البيانات]</td></tr>
<tr><td style="font-weight:bold;">التشخيص الرئيسي:</td><td>[من البيانات مع كود ICD-10]</td></tr>
<tr><td style="font-weight:bold;">التشخيصات الثانوية:</td><td>[كل التشخيصات الإضافية مع أكوادها]</td></tr>
</table>
</div>

<!-- 1. التحاليل والفحوصات المخبرية -->
<h3 style="color:#1e3a5f;border-bottom:2px solid #c9a962;padding-bottom:8px;">🔬 التحاليل والفحوصات</h3>
<table style="width:100%;border-collapse:collapse;margin:10px 0;">
<tr style="background:#1e3a5f;color:#fff;"><th style="padding:12px;">التحليل/الفحص</th><th>النتيجة</th><th>التقييم السريري</th><th>الحالة</th></tr>
<!-- اذكر كل تحليل موجود في البيانات -->
<tr><td style="padding:10px;border:1px solid #ddd;">[اسم التحليل من البيانات]</td><td style="border:1px solid #ddd;">[النتيجة]</td><td style="border:1px solid #ddd;">[هل مناسب للتشخيص؟ لماذا؟]</td><td style="border:1px solid #ddd;text-align:center;">✅/❌/⚠️</td></tr>
</table>

<div class="status-box warning" style="margin:10px 0;">
<h4>⚠️ تحاليل مطلوبة ولم تُطلب:</h4>
<ul>
<!-- لكل تحليل ناقص، اشرح: -->
<li><strong>[اسم التحليل]</strong> - مطلوب لتشخيص [التشخيص]
<br>📋 <em>الإجراء التصحيحي:</em> يجب طلب [اسم التحليل] لـ[السبب الطبي] حسب بروتوكول [CDC/WHO/MOH]</li>
</ul>
</div>

<!-- 2. التشخيص والترميز ICD-10 - قسم مهم جداً! -->
<h3 style="color:#1e3a5f;border-bottom:2px solid #c9a962;padding-bottom:8px;">🏷️ تقييم التشخيص والترميز (ICD-10) - إلزامي!</h3>
<div style="background:#fff3cd;padding:10px;border-radius:8px;margin-bottom:10px;border-right:4px solid #ffc107;">
<strong>⚠️ تنبيه:</strong> التكويد الصحيح ضروري لقبول التأمين - أي خطأ = رفض المطالبة
</div>
<table style="width:100%;border-collapse:collapse;margin:10px 0;">
<tr style="background:#1e3a5f;color:#fff;"><th style="padding:12px;">التشخيص</th><th>الكود المستخدم</th><th>صحة الكود</th><th>الكود الصحيح (إن اختلف)</th><th>التأثير التأميني</th></tr>
<tr><td style="padding:10px;border:1px solid #ddd;">[التشخيص من البيانات]</td><td style="border:1px solid #ddd;font-family:monospace;font-weight:bold;">[الكود المستخدم]</td><td style="border:1px solid #ddd;text-align:center;">✅ صحيح / ❌ خاطئ / ⚠️ غير محدد</td><td style="border:1px solid #ddd;font-family:monospace;">[الكود الصحيح إن كان مختلفاً]</td><td style="border:1px solid #ddd;">[مقبول تأمينياً / يحتاج تصحيح / سيُرفض]</td></tr>
</table>
<div class="status-box warning" style="margin:10px 0;">
<h4>📋 ملاحظات التكويد:</h4>
<ul>
<li><strong>مستوى الدقة:</strong> [هل الكود محدد بدقة (4-5 أحرف) أم عام (3 أحرف)؟]</li>
<li><strong>التوافق مع الإجراءات:</strong> [هل التشخيص يبرر جميع الإجراءات المطلوبة؟]</li>
<li><strong>التشخيصات المفقودة:</strong> [هل هناك تشخيصات يجب إضافتها لتبرير الإجراءات؟]</li>
</ul>
</div>

<!-- 3. الأدوية الموصوفة - جميعها -->
<h3 style="color:#1e3a5f;border-bottom:2px solid #c9a962;padding-bottom:8px;">💊 الأدوية الموصوفة (جميعها)</h3>
<table style="width:100%;border-collapse:collapse;margin:10px 0;">
<tr style="background:#1e3a5f;color:#fff;"><th style="padding:12px;">الدواء</th><th>الجرعة</th><th>الكمية/المدة</th><th>التقييم</th><th>الحالة</th></tr>
<!-- اذكر كل دواء من البيانات -->
<tr>
<td style="padding:10px;border:1px solid #ddd;">[اسم الدواء من البيانات]</td>
<td style="border:1px solid #ddd;">[الجرعة]</td>
<td style="border:1px solid #ddd;">[الكمية أو المدة]</td>
<td style="border:1px solid #ddd;">[مناسب للتشخيص؟ / مكرر؟ / جرعة زائدة؟ / تداخل دوائي؟]</td>
<td style="border:1px solid #ddd;text-align:center;">✅/❌/⚠️</td>
</tr>
</table>

<!-- 4. الإجراءات الزائدة - بالتفصيل -->
<div class="status-box rejected" style="margin:15px 0;">
<h3>❌ إجراءات/أدوية زائدة تحتاج تبرير</h3>
<ul>
<!-- لكل إجراء/دواء زائد: -->
<li>
<strong>[اسم الإجراء/الدواء الزائد]</strong>
<br>📌 <em>المشكلة:</em> [وصف المشكلة بالتفصيل]
<br>🔑 <em>التشخيصات التي تبرره:</em> يُقبل فقط مع: [قائمة التشخيصات مع أكواد ICD-10 مثل: J06.9 التهاب تنفسي علوي، J20.9 التهاب شعبي حاد]
<br>⚠️ <em>العواقب:</em> رفض تأميني / تكلفة على المريض: [التكلفة التقريبية إن أمكن]
<br>📋 <em>الإجراء المطلوب:</em> [ما يجب فعله لتصحيح الوضع]
</li>
</ul>
</div>

<!-- 5. الإجراءات الناقصة - بالتفصيل -->
<div class="status-box warning" style="margin:15px 0;">
<h3>⚠️ إجراءات ناقصة يجب استكمالها</h3>
<ul>
<!-- لكل إجراء ناقص: -->
<li>
<strong>[الإجراء الناقص]</strong>
<br>📌 <em>لماذا مطلوب:</em> [السبب الطبي مع ذكر البروتوكول المرجعي]
<br>📋 <em>خطوات التصحيح:</em>
<br>1. [الخطوة الأولى]
<br>2. [الخطوة الثانية]
<br>3. [الخطوة الثالثة إن وجدت]
<br>👤 <em>المسؤول:</em> [الطبيب المعالج / قسم الجودة / إدارة التأمين]
</li>
</ul>
</div>

<!-- 6. ملخص الحالة -->
<div style="display:flex;gap:15px;margin-top:15px;flex-wrap:wrap;">
<div style="flex:1;min-width:200px;background:#d4edda;padding:15px;border-radius:8px;border-right:5px solid #28a745;">
<h4 style="color:#155724;margin:0 0 10px;">✅ ما تم بشكل صحيح</h4>
<ul style="margin:0;padding-right:20px;color:#155724;">
<li>[نقطة 1]</li>
<li>[نقطة 2]</li>
</ul>
</div>
<div style="flex:1;min-width:200px;background:#f8d7da;padding:15px;border-radius:8px;border-right:5px solid #dc3545;">
<h4 style="color:#721c24;margin:0 0 10px;">❌ يحتاج تصحيح</h4>
<ul style="margin:0;padding-right:20px;color:#721c24;font-size:0.95rem;">
<!-- لكل عنصر يحتاج تصحيح، اذكر السبب والتصحيح المطلوب -->
<li>
<strong>[اسم العنصر - مثل: H.Pylori Ab Serum]</strong>
<br><span style="color:#856404;">📌 السبب:</span> [لماذا يحتاج تصحيح - مثل: لا يوجد تشخيص يبرره في الملف]
<br><span style="color:#0c5460;">🔧 التصحيح:</span> [ما المطلوب - مثل: إضافة تشخيص K29.7 (التهاب معدة) أو توثيق أعراض GI]
<br><span style="color:#155724;">✅ المبررات المقبولة:</span> [قائمة - مثل: ألم معدة مزمن، قرحة سابقة، تاريخ عائلي]
</li>
</ul>
</div>
</div>
</section>
<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- نهاية قسم الحالة - كرر لكل حالة في البيانات -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<!-- الأنماط المتكررة عبر جميع الحالات -->
<section class="cross-patterns" style="margin-top:30px;">
<h2 style="color:#1e3a5f;border-bottom:3px solid #c9a962;padding-bottom:10px;">🔗 الأنماط المتكررة عبر الحالات</h2>
<div class="status-box warning">
<ul>
<li><strong>نمط 1:</strong> [وصف النمط المتكرر مع ذكر أرقام الحالات المتأثرة: مثلاً "في 4 من 6 حالات لم يُطلب تحليل بول رغم تشخيص UTI"]</li>
<li><strong>نمط 2:</strong> [نمط آخر إن وجد]</li>
</ul>
</div>
</section>

<!-- التوصيات وخطة العمل -->
<section class="recommendations" style="margin-top:30px;">
<h2 style="color:#1e3a5f;border-bottom:3px solid #c9a962;padding-bottom:10px;">📝 التوصيات وخطة العمل</h2>
<table style="width:100%;border-collapse:collapse;">
<tr style="background:#1e3a5f;color:#fff;"><th style="padding:12px;">#</th><th>التوصية</th><th>الأولوية</th><th>المسؤول</th><th>الموعد المقترح</th></tr>
<tr><td style="padding:10px;border:1px solid #ddd;text-align:center;">1</td><td style="border:1px solid #ddd;">[التوصية التفصيلية]</td><td style="border:1px solid #ddd;text-align:center;background:#ffebee;color:#c62828;">🔴 عاجل</td><td style="border:1px solid #ddd;">[المسؤول]</td><td style="border:1px solid #ddd;">[فوري/خلال أسبوع/خلال شهر]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;text-align:center;">2</td><td style="border:1px solid #ddd;">[التوصية]</td><td style="border:1px solid #ddd;text-align:center;background:#fff3e0;color:#ef6c00;">🟡 متوسط</td><td style="border:1px solid #ddd;">[المسؤول]</td><td style="border:1px solid #ddd;">[الموعد]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;text-align:center;">3</td><td style="border:1px solid #ddd;">[التوصية]</td><td style="border:1px solid #ddd;text-align:center;background:#e8f5e9;color:#2e7d32;">🟢 عادي</td><td style="border:1px solid #ddd;">[المسؤول]</td><td style="border:1px solid #ddd;">[الموعد]</td></tr>
</table>
</section>

<!-- تقييم الطبيب الشامل - قسم مهم! -->
<section class="doctor-evaluation" style="margin-top:30px;border:3px solid #1e3a5f;border-radius:12px;overflow:hidden;">
<h2 style="background:#1e3a5f;color:#c9a962;padding:15px;margin:0;text-align:center;font-size:1.4rem;">👨‍⚕️ تقييم أداء الطبيب المعالج</h2>

<div style="padding:20px;">
<!-- جدول التقييم التفصيلي -->
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr style="background:#e8f4fd;"><th style="padding:12px;text-align:right;width:40%;border:1px solid #ddd;">معيار التقييم</th><th style="width:15%;border:1px solid #ddd;">الدرجة</th><th style="border:1px solid #ddd;">الملاحظات</th></tr>
<tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold;">🏷️ دقة التكويد (ICD-10)</td><td style="border:1px solid #ddd;text-align:center;font-size:1.2rem;font-weight:bold;">[X]/10</td><td style="border:1px solid #ddd;font-size:0.9rem;">[هل الأكواد صحيحة ودقيقة؟ نسبة الأكواد الصحيحة]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold;">📋 التوثيق الطبي</td><td style="border:1px solid #ddd;text-align:center;font-size:1.2rem;font-weight:bold;">[X]/10</td><td style="border:1px solid #ddd;font-size:0.9rem;">[هل التشخيصات موثقة بالأدلة؟ هل المبررات واضحة؟]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold;">💊 ملاءمة الوصفات</td><td style="border:1px solid #ddd;text-align:center;font-size:1.2rem;font-weight:bold;">[X]/10</td><td style="border:1px solid #ddd;font-size:0.9rem;">[هل الأدوية متوافقة مع التشخيص؟ جرعات صحيحة؟]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold;">🔬 طلب التحاليل</td><td style="border:1px solid #ddd;text-align:center;font-size:1.2rem;font-weight:bold;">[X]/10</td><td style="border:1px solid #ddd;font-size:0.9rem;">[هل التحاليل مبررة؟ ناقصة؟ زائدة؟]</td></tr>
<tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold;">📑 الالتزام بمعايير التأمين</td><td style="border:1px solid #ddd;text-align:center;font-size:1.2rem;font-weight:bold;">[X]/10</td><td style="border:1px solid #ddd;font-size:0.9rem;">[هل الحالات ستُقبل تأمينياً؟ نسبة المتوقع رفضها]</td></tr>
<tr style="background:#f8f9fa;"><td style="padding:12px;border:2px solid #1e3a5f;font-weight:bold;font-size:1.1rem;">📊 المعدل العام</td><td style="border:2px solid #1e3a5f;text-align:center;font-size:1.5rem;font-weight:bold;color:#1e3a5f;">[X]/10</td><td style="border:2px solid #1e3a5f;font-weight:bold;">[ممتاز/جيد جداً/جيد/مقبول/ضعيف]</td></tr>
</table>

<!-- نقاط القوة والضعف -->
<div style="display:flex;gap:15px;flex-wrap:wrap;">
<div style="flex:1;min-width:250px;background:#d4edda;padding:15px;border-radius:8px;border-right:5px solid #28a745;">
<h4 style="color:#155724;margin:0 0 10px;">✅ نقاط القوة</h4>
<ul style="margin:0;padding-right:20px;color:#155724;font-size:0.95rem;">
<li>[نقطة قوة 1]</li>
<li>[نقطة قوة 2]</li>
</ul>
</div>
<div style="flex:1;min-width:250px;background:#f8d7da;padding:15px;border-radius:8px;border-right:5px solid #dc3545;">
<h4 style="color:#721c24;margin:0 0 10px;">❌ نقاط تحتاج تحسين</h4>
<ul style="margin:0;padding-right:20px;color:#721c24;font-size:0.95rem;">
<li>[نقطة ضعف 1]</li>
<li>[نقطة ضعف 2]</li>
</ul>
</div>
</div>

<!-- توصيات للطبيب -->
<div style="background:#e3f2fd;padding:15px;border-radius:8px;margin-top:15px;border-right:5px solid #2196f3;">
<h4 style="color:#1565c0;margin:0 0 10px;">💡 توصيات لتحسين الأداء</h4>
<ol style="margin:0;padding-right:25px;color:#1565c0;font-size:0.95rem;">
<li>[توصية 1 - مثل: استخدام أكواد ICD-10 أكثر تحديداً]</li>
<li>[توصية 2 - مثل: توثيق المبرر الإكلينيكي قبل طلب التحاليل]</li>
<li>[توصية 3 - مثل: مراجعة بروتوكولات صرف المضادات الحيوية]</li>
</ol>
</div>
</div>
</section>

<!-- التقييم النهائي -->
<section class="final-rating" style="background:linear-gradient(135deg,#1e3a5f,#2d4a6f);padding:25px;border-radius:12px;margin-top:30px;">
<h2 style="color:#c9a962;text-align:center;margin:0 0 20px;font-size:1.5rem;">⭐ التقييم النهائي للحالات</h2>
<div style="display:flex;gap:25px;justify-content:center;flex-wrap:wrap;">
<div style="text-align:center;background:#fff;padding:20px 40px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2);">
<div style="font-size:2.5rem;font-weight:bold;color:#1e3a5f;">[X]/10</div>
<div style="color:#666;font-weight:bold;">التأمين والترميز</div>
<div style="font-size:0.85rem;color:#999;">دقة الترميز، التوثيق، الامتثال</div>
</div>
<div style="text-align:center;background:#fff;padding:20px 40px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2);">
<div style="font-size:2.5rem;font-weight:bold;color:#1e3a5f;">[X]/10</div>
<div style="color:#666;font-weight:bold;">الجودة الطبية</div>
<div style="font-size:0.85rem;color:#999;">دقة التشخيص، ملاءمة العلاج</div>
</div>
</div>
</section>

<!-- ⚠️ مهم جداً: ضع الأرقام الفعلية هنا بناءً على تحليلك - هذا يُستخدم لإحصائيات الأطباء! -->
<div id="ai-ratings" style="display:none;">
<span data-insurance-rating="7"></span>
<span data-service-rating="8"></span>
</div>
<!-- استبدل 7 و 8 أعلاه بالتقييم الفعلي من تحليلك:
- insurance-rating: تقييم الالتزام بمعايير التأمين والترميز (1-10)
- service-rating: تقييم جودة الخدمة الطبية والعلاج (1-10)
يجب أن تكون أرقاماً فقط بدون أي رموز أخرى!
-->

# ⚠️ تذكير نهائي - اقرأ قبل الإخراج:
1. هل ذكرت **جميع الأدوية** من كل حالة؟ إن لم تفعل، أضفها الآن
2. هل ذكرت **جميع التحاليل**؟ إن لم تفعل، أضفها الآن  
3. هل وضحت للإجراءات الزائدة **أي تشخيص ICD-10 يبررها**؟
4. هل كتبت **خطوات تصحيحية واضحة** للإجراءات الناقصة؟
5. هل التقرير **مفصل وشامل** أم مختصر؟ المختصر مرفوض!
6. لا تترك أي حقل فارغاً أو تكتب [template] - استبدل الكل ببيانات حقيقية`;

const CASES_PER_BATCH = 15;

function parseExcelRows(textContent) {
  const lines = textContent.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: '', rows: [] };
  const headers = lines[0];
  const rows = lines.slice(1);
  return { headers, rows };
}

function createBatchPrompt(headers, rows, batchNum, totalBatches, doctorName) {
  return `# ⚠️ تعليمات صارمة - الدفعة ${batchNum} من ${totalBatches}

أنت **رئيس وحدة التدقيق التأميني** - حلل الحالات التالية بالتفصيل الكامل.

# ⛔ قواعد ملزِمة
1. أخرج **HTML فقط** - ممنوع Markdown
2. استخدم class="status-box accepted/rejected/warning" للتلوين
3. **حلل كل حالة** في البيانات - لا تتجاهل أي صف
4. لكل حالة: اذكر جميع الأدوية + التحاليل + التشخيصات
5. إذا غابت معلومة اكتب: "⚠️ غير متوفر"

# 🔴 قواعد التكرار (مهم جداً!)
- **تتبع رقم المريض**: إذا ظهر نفس المريض أكثر من مرة بنفس التشخيص/الأدوية → أشر للتكرار بوضوح
- **صياغة التنبيهات**: لا تقل "غير ضروري" فقط!

# 🏥 اقتراحات التبرير الإكلينيكي للإجراءات:
| الإجراء | التبرير المقبول |
|---------|-----------------|
| سكر عشوائي | أعراض سكر حادة، تشخيص أولي، متابعة غير مستقر، طوارئ |
| CBC | حمى، التهاب، فقر دم مشتبه، نزيف |
| وظائف كبد/كلى | يرقان، وذمة، أدوية سامة، مرض مزمن |
| أشعة | أعراض موضعية، إصابة، حمى مع سعال |
| مضادات حيوية | التهاب بكتيري محدد (حلق صديدي، رئوي، UTI) |
| حقن | عدم تحمل الفم، حالة حادة |

# 📋 صياغة التنبيه (إلزامي):
"⚠️ [الإجراء] يحتاج توثيق المبرر الإكلينيكي.
📌 اقتراحات التبرير المقبولة: [من الجدول]
❗ عدم التوثيق = رفض التأمين"

# 📊 الطبيب: ${doctorName || 'غير محدد'}

# البيانات (${rows.length} حالة):
${headers}
${rows.join('\n')}

# المطلوب لكل حالة:
<section class="case-detail" style="border:3px solid #c9a962;border-radius:12px;padding:20px;margin:25px 0;background:#fafafa;">
<h2 style="background:linear-gradient(135deg,#1e3a5f,#2d4a6f);color:#fff;padding:15px;border-radius:8px;margin:-20px -20px 20px -20px;">
🔍 الحالة رقم [X] | التشخيص: [من البيانات]
</h2>

<div style="background:#e8f4fd;padding:15px;border-radius:8px;margin-bottom:15px;">
<h3 style="color:#1e3a5f;margin:0 0 10px;">📌 بيانات الحالة</h3>
<table style="width:100%;"><tr><td style="font-weight:bold;">التشخيص:</td><td>[مع ICD-10]</td></tr></table>
</div>

<h3 style="color:#1e3a5f;border-bottom:2px solid #c9a962;">💊 الأدوية</h3>
<table style="width:100%;border-collapse:collapse;">
<tr style="background:#1e3a5f;color:#fff;"><th>الدواء</th><th>الجرعة</th><th>التقييم</th><th>الحالة</th></tr>
<!-- كل دواء في صف -->
</table>

<div class="status-box rejected">
<h3>❌ إجراءات زائدة</h3>
<ul><li><strong>[الإجراء]</strong><br>🔑 يُقبل مع: [تشخيصات ICD-10]</li></ul>
</div>

<div class="status-box warning">
<h3>⚠️ إجراءات ناقصة</h3>
<ul><li><strong>[الإجراء]</strong><br>📋 التصحيح: [خطوات]</li></ul>
</div>

<div style="display:flex;gap:15px;flex-wrap:wrap;">
<div style="flex:1;background:#d4edda;padding:15px;border-radius:8px;border-right:5px solid #28a745;">
<h4 style="color:#155724;">✅ صحيح</h4><ul style="color:#155724;"><li>[...]</li></ul>
</div>
<div style="flex:1;background:#f8d7da;padding:15px;border-radius:8px;border-right:5px solid #dc3545;">
<h4 style="color:#721c24;">❌ يحتاج تصحيح</h4><ul style="color:#721c24;"><li>[...]</li></ul>
</div>
</div>
</section>

⚠️ تذكير: حلل كل الـ ${rows.length} حالة أعلاه بالتفصيل!`;
}

async function callGemini(promptText, images = []) {
  const parts = [{ text: promptText }];
  
  for (const img of images) {
    const base64Data = img.data.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType: img.mimeType || 'image/jpeg',
        data: base64Data
      }
    });
  }

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
  });

  let html = '';
  if (result.candidates?.[0]?.content?.parts) {
    html = result.candidates[0].content.parts.map(p => p.text || '').join('');
  } else if (result.text) {
    html = result.text;
  } else if (typeof result.response?.text === 'function') {
    html = result.response.text();
  }
  
  return html.replace(/```html\n?/g, '').replace(/```\n?/g, '');
}

export async function analyzeMedicalCase(files, lang = 'ar', doctorName = '') {
  try {
    const imageFiles = files.filter(f => !f.isExcel);
    const excelFiles = files.filter(f => f.isExcel);
    const isMultiCase = excelFiles.length > 0;

    if (!isMultiCase) {
      const prompt = SINGLE_CASE_PROMPT;
      const html = await callGemini(prompt + '\n\nحلل الصور المرفقة:', imageFiles);
      return { success: true, html: wrapWithStyles(html, false), raw: html, isMultiCase: false };
    }

    let allExcelText = '';
    for (const file of excelFiles) {
      if (file.textContent) allExcelText += file.textContent + '\n';
      else if (file.data && !file.data.startsWith('data:')) allExcelText += file.data + '\n';
    }

    const { headers, rows } = parseExcelRows(allExcelText);
    const totalCases = rows.length;
    
    console.log(`📊 Processing ${totalCases} cases in batches of ${CASES_PER_BATCH}`);

    if (totalCases <= CASES_PER_BATCH) {
      const fullPrompt = MULTI_CASE_PROMPT + `\n\n--- بيانات الحالات ---\n${allExcelText}\n\nقم بتحليل جميع الحالات بالتفصيل.`;
      const html = await callGemini(fullPrompt, imageFiles);
      return { success: true, html: wrapWithStyles(html, true), raw: html, isMultiCase: true };
    }

    const batches = [];
    for (let i = 0; i < rows.length; i += CASES_PER_BATCH) {
      batches.push(rows.slice(i, i + CASES_PER_BATCH));
    }

    console.log(`📦 Created ${batches.length} batches`);

    let combinedHtml = `
<section class="portfolio-summary">
<h2>📊 الملخص الإجمالي للحالات</h2>
<p style="text-align:center;font-size:1.5rem;margin:20px 0;"><strong>إجمالي الحالات: ${totalCases}</strong></p>
<p style="text-align:center;color:#666;">تم تحليل الحالات على ${batches.length} دفعات</p>
</section>

<section class="doctor-info" style="background:#1e3a5f;padding:20px;border-radius:10px;margin:20px 0;">
<h2 style="color:#c9a962;margin:0;">👨‍⚕️ الطبيب: ${doctorName || 'غير محدد'}</h2>
</section>
`;

    let acceptedCount = 0, rejectedCount = 0, warningCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} cases)`);
      
      const batchPrompt = createBatchPrompt(headers, batch, i + 1, batches.length, doctorName);
      const batchHtml = await callGemini(batchPrompt, i === 0 ? imageFiles : []);
      
      combinedHtml += `\n<!-- === الدفعة ${i + 1} === -->\n${batchHtml}\n`;

      const acceptedMatches = (batchHtml.match(/status-box accepted/g) || []).length;
      const rejectedMatches = (batchHtml.match(/status-box rejected/g) || []).length;
      const warningMatches = (batchHtml.match(/status-box warning/g) || []).length;
      
      acceptedCount += acceptedMatches;
      rejectedCount += rejectedMatches;
      warningCount += warningMatches;
    }

    const summaryUpdate = `
<section class="final-summary" style="background:linear-gradient(135deg,#1e3a5f,#2d4a6f);padding:25px;border-radius:12px;margin-top:30px;">
<h2 style="color:#c9a962;text-align:center;">📈 ملخص التحليل الكامل</h2>
<div style="display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-top:15px;">
<div style="background:#d4edda;padding:20px 40px;border-radius:10px;text-align:center;">
<div style="font-size:2.5rem;font-weight:bold;color:#155724;">${acceptedCount}</div>
<div style="color:#155724;">✅ مقبول</div>
</div>
<div style="background:#f8d7da;padding:20px 40px;border-radius:10px;text-align:center;">
<div style="font-size:2.5rem;font-weight:bold;color:#721c24;">${rejectedCount}</div>
<div style="color:#721c24;">❌ مرفوض</div>
</div>
<div style="background:#fff3cd;padding:20px 40px;border-radius:10px;text-align:center;">
<div style="font-size:2.5rem;font-weight:bold;color:#856404;">${warningCount}</div>
<div style="color:#856404;">⚠️ يحتاج مراجعة</div>
</div>
</div>
</section>
`;

    combinedHtml += summaryUpdate;

    return {
      success: true,
      html: wrapWithStyles(combinedHtml, true),
      raw: combinedHtml,
      isMultiCase: true,
      totalCases,
      batchCount: batches.length
    };

  } catch (error) {
    console.error('Medical audit error:', error);
    return {
      success: false,
      error: error.message,
      html: `<div class="error-box">
        <h3>❌ حدث خطأ في التحليل</h3>
        <p>${error.message}</p>
      </div>`
    };
  }
}

function wrapWithStyles(html, isMultiCase = false) {
  return `
    <style>
      .audit-body { 
        font-family: 'Tajawal', sans-serif; 
        direction: rtl; 
        line-height: 1.9; 
        color: #1e293b;
      }
      .audit-body section { 
        margin-bottom: 2rem; 
        background: #fff;
        border-radius: 12px;
        padding: 1.5rem;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }
      .audit-body h2 { 
        color: #1e3a5f; 
        font-size: 1.4rem; 
        border-bottom: 3px solid #c9a962; 
        padding-bottom: 0.75rem; 
        margin-bottom: 1.25rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .audit-body h3 { 
        color: #1e3a5f; 
        font-size: 1.15rem; 
        margin: 1.25rem 0 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .audit-body h4 {
        color: #334155;
        font-size: 1rem;
        margin: 0.75rem 0 0.5rem;
      }
      .audit-body p { color: #475569; margin-bottom: 1rem; font-size: 1rem; }
      .audit-body ul { list-style: none; padding: 0; margin: 0.5rem 0; }
      .audit-body li { 
        padding: 1rem 1.25rem; 
        margin: 0.5rem 0; 
        border-radius: 10px; 
        background: #f8fafc; 
        border-right: 4px solid #cbd5e1;
        line-height: 1.8;
      }
      .audit-body li strong { color: #1e3a5f; font-size: 1.05rem; }
      .audit-body li em { color: #64748b; }
      
      .status-box { 
        padding: 1.25rem 1.5rem; 
        border-radius: 12px; 
        margin: 1.25rem 0;
        box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      }
      .status-box h3, .status-box h4 { margin-top: 0; }
      
      .status-box.accepted { 
        background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); 
        border: 2px solid #22c55e; 
      }
      .status-box.accepted h3, .status-box.accepted h4 { color: #15803d; }
      .status-box.accepted li { background: rgba(255,255,255,0.7); border-right-color: #22c55e; }
      
      .status-box.rejected { 
        background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); 
        border: 2px solid #ef4444; 
      }
      .status-box.rejected h3, .status-box.rejected h4 { color: #dc2626; }
      .status-box.rejected li { background: rgba(255,255,255,0.7); border-right-color: #ef4444; }
      
      .status-box.warning { 
        background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%); 
        border: 2px solid #eab308; 
      }
      .status-box.warning h3, .status-box.warning h4 { color: #a16207; }
      .status-box.warning li { background: rgba(255,255,255,0.7); border-right-color: #eab308; }
      
      .audit-body table { 
        width: 100%; 
        border-collapse: collapse; 
        margin: 1rem 0; 
        font-size: 0.95rem;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        border-radius: 10px;
        overflow: hidden;
      }
      .audit-body th { 
        background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%); 
        color: white; 
        padding: 1rem 0.75rem;
        font-weight: 600;
        font-size: 0.95rem;
      }
      .audit-body td { 
        padding: 0.85rem 0.75rem; 
        text-align: right; 
        border: 1px solid #e2e8f0;
        vertical-align: top;
      }
      .audit-body tr:nth-child(even) { background: #f8fafc; }
      .audit-body tr:hover { background: #f1f5f9; }
      
      .case-detail {
        background: #fafafa !important;
        border: 3px solid #c9a962 !important;
        margin: 2rem 0 !important;
      }
      .portfolio-summary {
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%) !important;
      }
      
      .error-box { 
        background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); 
        border: 2px solid #ef4444; 
        padding: 2rem; 
        border-radius: 12px; 
        text-align: center; 
      }
      .error-box h3 { color: #dc2626; margin: 0 0 1rem; }
      
      @media print {
        .audit-body section { box-shadow: none; border: 1px solid #e2e8f0; }
        .status-box { box-shadow: none; }
        .audit-body table { box-shadow: none; }
      }
    </style>
    <div class="audit-body">
      ${html}
    </div>
  `;
}

export function registerMedicalAuditRoutes(app) {
  app.post('/api/medical-audit', async (req, res) => {
    try {
      const { files, lang } = req.body;
      
      if (!files || files.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'لم يتم رفع أي ملفات' 
        });
      }

      const result = await analyzeMedicalCase(files, lang);
      res.json(result);
      
    } catch (error) {
      console.error('Medical audit API error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
}
