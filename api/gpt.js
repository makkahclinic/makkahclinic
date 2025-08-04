<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>المساعد الصحي الذكي - بوابة المريض</title>
  <!-- Styles are unchanged -->
  <!-- ... CSS styles from your original code ... -->
</head>
<body>
  <div class="container">
    <a href="portal.html" class="back-link">العودة إلى البوابة الرئيسية</a>
    <div class="header">
      <h2>المساعد الصحي الذكي</h2>
      <p>أدخل معلوماتك للحصول على تحليل أولي لحالتك الصحية</p>
    </div>
    <div class="form-grid">
      <div class="full-width">
        <label for="symptoms">صف أعراضك بالتفصيل (مطلوب):</label>
        <textarea id="symptoms" placeholder="مثال: أشعر بصداع شديد في مقدمة الرأس، مع غثيان..."></textarea>
      </div>
      <div>
        <label for="age">العمر (مطلوب):</label>
        <input type="number" id="age" placeholder="مثال: 35" />
      </div>
      <div>
        <label for="gender">الجنس (مطلوب):</label>
        <select id="gender">
          <option value="" disabled selected>اختر...</option>
          <option value="male">ذكر</option>
          <option value="female">أنثى</option>
        </select>
      </div>
      <div id="pregnancy-section" class="conditional-field full-width">
        <label for="isPregnant">هل أنتِ حامل؟</label>
        <select id="isPregnant">
          <option value="no" selected>لا</option>
          <option value="yes">نعم</option>
        </select>
      </div>
      <div id="pregnancy-month-section" class="conditional-field full-width">
        <label for="pregnancyMonth">في أي شهر من الحمل؟</label>
        <select id="pregnancyMonth">
          <option value="1">الشهر الأول</option>
          <option value="2">الشهر الثاني</option>
          <option value="3">الشهر الثالث</option>
          <option value="4">الشهر الرابع</option>
          <option value="5">الشهر الخامس</option>
          <option value="6">الشهر السادس</option>
          <option value="7">الشهر السابع</option>
          <option value="8">الشهر الثامن</option>
          <option value="9">الشهر التاسع</option>
        </select>
      </div>
      <div>
        <label for="weight">الوزن (كجم) (اختياري):</label>
        <input type="number" id="weight" placeholder="مثال: 70">
      </div>
      <div>
        <label for="height">الطول (سم) (اختياري):</label>
        <input type="number" id="height" placeholder="مثال: 175">
      </div>
      <div>
        <label for="smoker">هل أنت مدخن؟ (مطلوب)</label>
        <select id="smoker">
          <option value="" disabled selected>اختر...</option>
          <option value="yes">نعم</option>
          <option value="no">لا</option>
        </select>
      </div>
      <div>
        <label for="vitals">الحرارة والضغط (اختياري):</label>
        <input type="text" id="vitals" placeholder="مثال: الحرارة 38.5">
      </div>
      <div class="full-width">
        <label for="currentMedications">الأدوية الحالية (اختياري):</label>
        <textarea id="currentMedications" placeholder="اذكر أي أدوية تتناولها حالياً"></textarea>
      </div>
      <div class="full-width">
        <label for="labs">نتائج تحاليل حالية (اختياري):</label>
        <textarea id="labs" placeholder="إذا كان لديك أي نتائج تحاليل حديثة"></textarea>
      </div>
      <div class="full-width">
        <label for="diagnosis">أي تشخيص سابق (اختياري):</label>
        <textarea id="diagnosis" placeholder="إذا كان لديك أي تشخيص سابق من طبيب"></textarea>
      </div>
    </div>
    <button onclick="analyzeSymptoms()" class="btn-primary">تحليل الأعراض</button>
    <div id="notification-area"></div>
    <div id="response-container"></div>
    <p class="disclaimer">
      <strong>إخلاء مسؤولية:</strong> هذه الأداة تقدم نصائح أولية للمعلومات فقط ولا تعتبر بديلاً عن الاستشارة الطبية المتخصصة.
    </p>
  </div>
</body>
</html>
