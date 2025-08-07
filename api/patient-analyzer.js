// /api/patient-analyzer.js - FINAL, VISUALLY ENHANCED VERSION

const systemInstruction = `
<style>
/* CSS Styles for Professional Report Formatting */
.report-container { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; text-align: right; }
.box-critical { border-right: 5px solid #721c24; background-color: #f8d7da; color: #721c24; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-warning { border-right: 5px solid #856404; background-color: #fff3cd; color: #856404; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-good { border-right: 5px solid #155724; background-color: #d4edda; color: #155724; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-info { border-right: 5px solid #004085; background-color: #cce5ff; color: #004085; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.custom-table { border-collapse: collapse; width: 100%; text-align: right; margin-top: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
.custom-table th, .custom-table td { padding: 12px 15px; border: 1px solid #dee2e6; }
.custom-table thead { background-color: #e9ecef; }
.custom-table tbody tr:nth-of-type(even) { background-color: #f8f9fa; }
h3, h4 { color: #343a40; border-bottom: 2px solid #0056b3; padding-bottom: 8px; margin-top: 2rem; display: flex; align-items: center; gap: 10px; }
.icon { font-size: 1.5em; color: #0056b3; }
</style>

<div class="report-container">
<h3><i class="fas fa-file-medical-alt icon"></i> تحليل شامل من فريقنا الاستشاري الطبي</h3>
<p class="box-info">بناءً على المعلومات المقدمة، قام فريقنا بتحليل حالتك لتقديم رؤية شاملة. تم تصميم هذا التقرير لتسليط الضوء على النقاط الأكثر أهمية أولاً.</p>

<h4><i class="fas fa-exclamation-triangle icon"></i> تنبيهات حرجة (Critical Alerts)</h4>
<div class='box-critical'>
    <strong>❌ خطر فوري:</strong> تم وصف أدوية **ممنوعة تمامًا** أثناء الحمل (مثل Diovan و Rost). يجب إيقافها فورًا.
</div>
<div class='box-critical'>
    <strong>❌ خطر فوري:</strong> تناول دواء **Risperdal** بدون وصفة طبية أثناء الحمل أمر بالغ الخطورة. يجب إيقافه فورًا.
</div>
<div class='box-critical'>
    <strong>❌ خطر فوري:</strong> أعراض الصداع الشديد مع وجود أدوية ضغط في الوصفة قد تشير إلى **تسمم الحمل**، وهي حالة طارئة.
</div>


<h4><i class="fas fa-user-md icon"></i> 1. موجز وتقييم الحالة</h4>
<ul>
    <li><strong>الملخص السريري:</strong> مريضة (44 عامًا، حامل في الشهر السابع، مدخنة) تعاني من صداع حاد حول العين ودوار.</li>
    <li><strong>نقاط حرجة:</strong> يوجد تضارب في البيانات (العمر في الوصفة 50 عامًا)، والوصفة تتجاهل تمامًا حالة الحمل.</li>
    <li><strong>بيانات ناقصة:</strong> لا يوجد قياس لضغط الدم أو ضغط العين، وهما فحصان ضروريان.</li>
</ul>

<h4><i class="fas fa-clipboard-list icon"></i> 2. التشخيصات المحتملة (مرتبة حسب الخطورة)</h4>
<ol>
    <li><div class='box-critical'><strong>تسمم الحمل (Preeclampsia):</strong> يجب استبعاده فورًا في قسم الطوارئ.</div></li>
    <li><div class='box-warning'><strong>صداع نصفي (Migraine) أو جلوكوما حادة.</strong></div></li>
</ol>

<h4><i class="fas fa-microscope icon"></i> 3. تحليل الأدوية والإجراءات واستكشاف الأخطاء</h4>

<h5><i class="fas fa-pills icon"></i> أ) تدقيق الأدوية (Drug Audit)</h5>
<p>تم استخراج وتحليل الأدوية من الوصفة مع التركيز على المخاطر المتعلقة بالحمل.</p>
<table class='custom-table'>
    <thead>
        <tr><th>اسم الدواء</th><th>الجرعة</th><th>الغرض الطبي</th><th>تحليل معمق ومواطن الخطر</th></tr>
    </thead>
    <tbody>
        <tr>
            <td>Risperdal (ريزبردال)</td>
            <td>غير محددة</td>
            <td>مضاد للذهان (يُستخدم للأرق)</td>
            <td class='box-critical'>❌ **شديد الخطورة:** استخدامه بدون وصفة طبية، خاصة في الحمل، أمر خطير. قد تكون له آثار على الجنين. **يجب إيقافه فورًا.**</td>
        </tr>
        <tr>
            <td>Diovan (ديوفان)</td>
            <td>40 مج</td>
            <td>علاج ضغط الدم</td>
            <td class='box-critical'>❌ **شديد الخطورة:** هذا الدواء **ممنوع تمامًا** أثناء الثلث الثاني والثالث من الحمل لأنه قد يسبب ضررًا خطيرًا أو وفاة للجنين.</td>
        </tr>
         <tr>
            <td>Rost (روست)</td>
            <td>20 مج</td>
            <td>خفض الكوليسترول</td>
            <td class='box-critical'>❌ **شديد الخطورة:** أدوية الستاتين (Statins) مثل هذا الدواء **ممنوعة تمامًا** أثناء الحمل.</td>
        </tr>
        <tr>
            <td>Xigduo XR (زيجدو)</td>
            <td>5/1000 مج</td>
            <td>علاج السكري</td>
            <td class='box-critical'>❌ **شديد الخطورة:** لا يوصى به إطلاقًا أثناء الحمل. يجب التحول إلى الأنسولين.</td>
        </tr>
        <tr>
            <td>Triplexam (تريبلكسام)</td>
            <td>غير محددة</td>
            <td>علاج ضغط الدم</td>
            <td class='box-critical'>❌ **ازدواجية علاجية خطرة:** استخدام دوائين للضغط (Diovan و Triplexam) معًا أمر خطير. وكلاهما ممنوع في الحمل.</td>
        </tr>
        <tr>
            <td>Bertigo (برتيجو)</td>
            <td>8 مج</td>
            <td>علاج الدوار</td>
            <td class='box-warning'>⚠️ **يتطلب حذرًا:** بيانات سلامته أثناء الحمل محدودة جدًا. يجب تقييم الفائدة مقابل الخطر مع الطبيب.</td>
        </tr>
        <tr>
            <td>Pantomax (بانتوماكس)</td>
            <td>40 مج</td>
            <td>مضاد للحموضة</td>
            <td class='box-good'>✅ **آمن نسبيًا:** يعتبر من الخيارات الآمنة للحموضة أثناء الحمل، ولكن يجب أن يكون تحت إشراف طبي.</td>
        </tr>
    </tbody>
</table>

<h5><i class="fas fa-search-plus icon"></i> ب) استكشاف الفجوات التشخيصية</h5>
<table class='custom-table'>
    <thead>
        <tr><th>المشكلة / الفجوة المكتشفة</th><th>التحليل والتوصية</th></tr>
    </thead>
    <tbody>
        <tr>
            <td>صداع حاد حول العين</td>
            <td class='box-warning'>لم يتم قياس ضغط العين، وهو فحص ضروري لاستبعاد حالة طارئة مثل الجلوكوما.</td>
        </tr>
        <tr>
            <td>حامل + صداع + أدوية ضغط</td>
            <td class='box-critical'>لم يتم قياس ضغط الدم، وهو أهم إجراء فوري لاستبعاد تسمم الحمل.</td>
        </tr>
    </tbody>
</table>

<h4><i class="fas fa-directions icon"></i> 4. خطة العمل المقترحة</h4>
<ul>
    <li><div class='box-critical'><span class="icon">🚨</span><strong>إجراء عاجل وفوري:</strong> التوجه إلى **طوارئ النساء والولادة فورًا**. يجب إيقاف الأدوية الخطرة المذكورة أعلاه وإجراء تقييم عاجل لضغط الدم وحالة الجنين.</div></li>
</ul>

<h4><i class="fas fa-question-circle icon"></i> 5. أسئلة ذكية لمناقشتها مع طبيبك</h4>
<ul class="box-info">
    <li>ما هي خطة العلاج البديلة والآمنة لي وللجنين؟</li>
    <li>هل أعراضي علامة على تسمم الحمل؟ وما هي الفحوصات اللازمة للتأكد؟</li>
</ul>

<h4><i class="fas fa-notes-medical icon"></i> 6. إخلاء مسؤولية هام</h4>
<div class="box-warning">
    <p>هذا التحليل هو أداة مساعدة لزيادة وعيك الصحي، ولا يمثل تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن الفحص السريري والاستشارة المباشرة من طبيب بشري مؤهل.</p>
</div>
</div>
`;

// The rest of your file (buildUserPrompt, handler function, etc.) remains the same.
// You only need to replace the `systemInstruction` variable.

function buildUserPrompt(caseData) {
    /* ... same as before ... */
    return `...`;
}

export default async function handler(req, res) {
    /* ... same as before ... */
    // ...
}
