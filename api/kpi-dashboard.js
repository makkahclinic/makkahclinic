/**
 * لوحة مؤشرات الأداء الشهرية (KPI Dashboard)
 * نظام تقييم ثنائي المسار: عدالة الطبيب + دفاع تأميني
 */

/**
 * تصنيف الأخطاء وأوزانها
 */
const ERROR_WEIGHTS = {
  // ❌ أخطاء طبية فعلية (خطورة عالية)
  medical_error: {
    label: 'خطأ طبي',
    weight: -2.0,
    color: '#dc2626',
    examples: ['IV بدون مبرر طبي', 'دواء غير مناسب للتشخيص', 'جرعة خاطئة']
  },
  // ⚠️ نقص توثيق (قابل للإصلاح)
  documentation_gap: {
    label: 'نقص توثيق',
    weight: -0.5,
    color: '#f59e0b',
    examples: ['تشخيص غير محدد', 'علامات حيوية ناقصة', 'ICD ينتهي بـ .9']
  },
  // ✅ مقبول
  compliant: {
    label: 'مقبول',
    weight: 0,
    color: '#22c55e',
    examples: ['إجراء مبرر', 'توثيق كامل']
  }
};

/**
 * حساب مؤشرات الأداء من نتائج التقرير
 * @param {Object} reportStats - إحصائيات التقرير
 * @returns {Object} مؤشرات الأداء
 */
export function calculateKPIs(reportStats) {
  const kpis = {
    insuranceCompliance: { score: 0, max: 10, details: [] },
    medicalQuality: { score: 0, max: 10, details: [] },
    documentationQuality: { score: 0, max: 10, details: [] },
    overallScore: { score: 0, max: 10 },
    // ========== النظام الجديد: ثنائي المسار ==========
    clinicianFairness: { score: 0, max: 10, details: [] },   // درجة عدالة الطبيب
    insuranceDefense: { score: 0, max: 10, details: [] },    // درجة الدفاع التأميني
    deductionLedger: []  // جدول الخصومات الشفاف
  };

  const totalCases = reportStats.totalCases || 1;

  // حساب نسبة قبول الإجراءات - المقام الموحد: مقبول + مرفوض + يحتاج توثيق
  const totalProcedures = (reportStats.approvedCount || 0) + (reportStats.rejectedCount || 0) + (reportStats.needsDocCount || 0);
  const procedureApprovalRate = totalProcedures > 0 
    ? (reportStats.approvedCount || 0) / totalProcedures 
    : null; // null يعني "غير متوفر" بدلاً من 0
  
  // نسبة البنود التي تحتاج توثيق - نفس المقام (totalProcedures) للاتساق
  // ملاحظة: هذا يجعل approved% + rejected% + needsDoc% = 100%
  const needsDocRate = totalProcedures > 0 
    ? (reportStats.needsDocCount || 0) / totalProcedures 
    : 0;
  
  // نسبة الرفض (للعرض الإضافي)
  const rejectionRate = totalProcedures > 0 
    ? (reportStats.rejectedCount || 0) / totalProcedures 
    : 0;
  // استخدام نسبة التكرار المحسوبة من extractStatsFromCases (عدد الحالات بتكرار ÷ إجمالي الحالات)
  const duplicateRate = reportStats.duplicateRate || ((reportStats.duplicateCases || 0) / totalCases);
  const ivWithoutJustificationRate = (reportStats.ivWithoutJustification || 0) / totalCases;

  // استخدام متوسط تقييمات الذكاء الاصطناعي إن وجدت
  if (reportStats.avgInsuranceScore && reportStats.avgInsuranceScore > 0) {
    kpis.insuranceCompliance.score = parseFloat(reportStats.avgInsuranceScore.toFixed(1));
  } else {
    // حساب بديل إذا لم تتوفر التقييمات
    let insuranceScore = 10;
    if (procedureApprovalRate !== null) {
      insuranceScore -= (1 - procedureApprovalRate) * 4;
    }
    insuranceScore -= needsDocRate * 3;
    insuranceScore -= duplicateRate * 2;
    insuranceScore -= ivWithoutJustificationRate * 1;
    kpis.insuranceCompliance.score = Math.max(0, Math.min(10, parseFloat(insuranceScore.toFixed(1))));
  }
  
  // === المؤشرات المتسقة ===
  // الآن: قبول% + رفض% + يحتاج توثيق% = 100%
  kpis.insuranceCompliance.details = [
    { label: 'قبول الإجراءات', value: procedureApprovalRate !== null ? `${(procedureApprovalRate * 100).toFixed(0)}%` : 'غير متوفر', target: '≥70%', status: procedureApprovalRate !== null && procedureApprovalRate >= 0.7 ? 'good' : 'na' },
    { label: 'رفض الإجراءات', value: `${(rejectionRate * 100).toFixed(0)}%`, target: '<10%', status: rejectionRate < 0.1 ? 'good' : 'bad' },
    { label: 'يحتاج توثيق (بنود)', value: `${(needsDocRate * 100).toFixed(0)}%`, target: '<20%', status: needsDocRate < 0.2 ? 'good' : 'bad' },
    { label: 'نسبة التكرار', value: `${(duplicateRate * 100).toFixed(0)}%`, target: '<5%', status: duplicateRate < 0.05 ? 'good' : 'bad' },
    { label: 'IV بدون مبرر', value: `${(ivWithoutJustificationRate * 100).toFixed(0)}%`, target: '<10%', status: ivWithoutJustificationRate < 0.1 ? 'good' : 'bad' }
  ];

  // 2. Medical Quality Score /10
  // Based on: antibiotic appropriateness, vital signs documentation, test ordering
  // إلغاء القيم الافتراضية الوهمية - null يعني "غير متوفر"
  const antibioticAppropriateRate = (reportStats.antibioticTotal && reportStats.antibioticTotal > 0)
    ? (reportStats.antibioticAppropriate || 0) / reportStats.antibioticTotal 
    : null; // لا توجد مضادات = غير قابل للحساب
  const vitalsDocRate = reportStats.vitalsDocumented !== undefined
    ? (reportStats.vitalsDocumented / totalCases) 
    : null;
  const requiredTestsOrderedRate = (reportStats.requiredTestsTotal && reportStats.requiredTestsTotal > 0)
    ? (reportStats.requiredTestsOrdered || 0) / reportStats.requiredTestsTotal 
    : null; // لا توجد فحوصات مطلوبة = غير قابل للحساب

  // استخدام متوسط تقييمات الذكاء الاصطناعي إن وجدت
  if (reportStats.avgMedicalScore && reportStats.avgMedicalScore > 0) {
    kpis.medicalQuality.score = parseFloat(reportStats.avgMedicalScore.toFixed(1));
  } else {
    let medicalScore = 10;
    let penaltyCount = 0;
    // خصم فقط للمؤشرات المتوفرة
    if (antibioticAppropriateRate !== null) {
      medicalScore -= (1 - antibioticAppropriateRate) * 4;
      penaltyCount++;
    }
    if (vitalsDocRate !== null) {
      medicalScore -= (1 - vitalsDocRate) * 3;
      penaltyCount++;
    }
    if (requiredTestsOrderedRate !== null) {
      medicalScore -= (1 - requiredTestsOrderedRate) * 3;
      penaltyCount++;
    }
    // إذا لا توجد بيانات كافية، نُظهر تحذير
    if (penaltyCount === 0) {
      kpis.medicalQuality.score = null; // غير قابل للحساب
    } else {
      kpis.medicalQuality.score = Math.max(0, Math.min(10, parseFloat(medicalScore.toFixed(1))));
    }
  }

  kpis.medicalQuality.details = [
    { label: 'المضادات المناسبة', value: antibioticAppropriateRate !== null ? `${(antibioticAppropriateRate * 100).toFixed(0)}%` : 'غير متوفر', target: '≥90%', status: antibioticAppropriateRate !== null && antibioticAppropriateRate >= 0.9 ? 'good' : 'na' },
    { label: 'توثيق العلامات الحيوية', value: vitalsDocRate !== null ? `${(vitalsDocRate * 100).toFixed(0)}%` : 'غير متوفر', target: '≥95%', status: vitalsDocRate !== null && vitalsDocRate >= 0.95 ? 'good' : 'na' },
    { label: 'الفحوصات المطلوبة', value: requiredTestsOrderedRate !== null ? `${(requiredTestsOrderedRate * 100).toFixed(0)}%` : 'غير متوفر', target: '≥85%', status: requiredTestsOrderedRate !== null && requiredTestsOrderedRate >= 0.85 ? 'good' : 'na' }
  ];

  // 3. Documentation Quality Score /10
  const diagnosisSpecificityRate = reportStats.diagnosisSpecific ?
    (reportStats.diagnosisSpecific / totalCases) : 0.5;
  const icdCodeRate = reportStats.icdCodesPresent ?
    (reportStats.icdCodesPresent / totalCases) : 0.5;

  let docScore = 10;
  docScore -= (1 - diagnosisSpecificityRate) * 5; // -5 max for vague diagnoses
  docScore -= (1 - icdCodeRate) * 5; // -5 max for missing ICD codes
  kpis.documentationQuality.score = Math.max(0, Math.min(10, parseFloat(docScore.toFixed(1))));

  kpis.documentationQuality.details = [
    { label: 'التشخيص المحدد', value: `${(diagnosisSpecificityRate * 100).toFixed(0)}%`, target: '≥90%', status: diagnosisSpecificityRate >= 0.9 ? 'good' : 'bad' },
    { label: 'أكواد ICD موجودة', value: `${(icdCodeRate * 100).toFixed(0)}%`, target: '≥95%', status: icdCodeRate >= 0.95 ? 'good' : 'bad' }
  ];

  // Overall Score (weighted average) - التعامل مع القيم null
  let totalWeight = 0;
  let weightedSum = 0;
  
  if (kpis.insuranceCompliance.score !== null) {
    weightedSum += kpis.insuranceCompliance.score * 0.4;
    totalWeight += 0.4;
  }
  if (kpis.medicalQuality.score !== null) {
    weightedSum += kpis.medicalQuality.score * 0.35;
    totalWeight += 0.35;
  }
  if (kpis.documentationQuality.score !== null) {
    weightedSum += kpis.documentationQuality.score * 0.25;
    totalWeight += 0.25;
  }
  
  // إذا كان هناك قسم واحد على الأقل متوفر، نحسب المتوسط المرجح المتناسب
  if (totalWeight > 0) {
    // نحسب المتوسط مع إعادة توزيع الأوزان على الأقسام المتوفرة فقط
    kpis.overallScore.score = parseFloat((weightedSum / totalWeight).toFixed(1));
  } else {
    kpis.overallScore.score = null; // جميع الأقسام غير متوفرة
  }
  
  // تتبع الأقسام غير المتوفرة
  kpis.overallScore.missingPillars = [];
  if (kpis.insuranceCompliance.score === null) kpis.overallScore.missingPillars.push('الامتثال التأميني');
  if (kpis.medicalQuality.score === null) kpis.overallScore.missingPillars.push('الجودة الطبية');
  if (kpis.documentationQuality.score === null) kpis.overallScore.missingPillars.push('جودة التوثيق');

  // ========== النظام الجديد: ثنائي المسار ==========
  // تصنيف الأخطاء: medical_error (أخطاء طبية) vs documentation_gap (نقص توثيق)
  
  const totalProceduresForDual = (reportStats.approvedCount || 0) + (reportStats.rejectedCount || 0) + (reportStats.needsDocCount || 0);
  
  // افتراض: البنود المرفوضة = أخطاء طبية، البنود التي تحتاج توثيق = نقص توثيق
  const medicalErrors = reportStats.rejectedCount || 0;
  const docGaps = reportStats.needsDocCount || 0;
  const compliantItems = reportStats.approvedCount || 0;
  
  // معدلات الأخطاء
  const medicalErrorRate = totalProceduresForDual > 0 ? medicalErrors / totalProceduresForDual : 0;
  const docGapRate = totalProceduresForDual > 0 ? docGaps / totalProceduresForDual : 0;
  
  // IV بدون مبرر (خطأ طبي إضافي)
  const ivWithoutJustCount = reportStats.ivWithoutJustification || 0;
  const ivRate = totalCases > 0 ? ivWithoutJustCount / totalCases : 0;
  
  // تشخيص غير محدد (نقص توثيق)
  const nonSpecificDiagRate = 1 - diagnosisSpecificityRate;
  
  // ========== جدول الخصومات الشفاف ==========
  const deductions = [];
  
  // خصومات الأخطاء الطبية (وزن عالي)
  if (medicalErrorRate > 0) {
    deductions.push({
      type: 'medical_error',
      label: '❌ إجراءات مرفوضة طبياً',
      rate: `${(medicalErrorRate * 100).toFixed(0)}%`,
      deduction: parseFloat((medicalErrorRate * 3).toFixed(1)),
      color: '#dc2626'
    });
  }
  
  if (ivRate > 0) {
    deductions.push({
      type: 'medical_error',
      label: '❌ IV بدون مبرر طبي',
      rate: `${(ivRate * 100).toFixed(0)}%`,
      deduction: parseFloat((ivRate * 2).toFixed(1)),
      color: '#dc2626'
    });
  }
  
  // خصومات نقص التوثيق (وزن منخفض)
  if (docGapRate > 0) {
    deductions.push({
      type: 'documentation_gap',
      label: '⚠️ بنود تحتاج توثيق',
      rate: `${(docGapRate * 100).toFixed(0)}%`,
      deduction: parseFloat((docGapRate * 1).toFixed(1)),
      color: '#f59e0b'
    });
  }
  
  if (nonSpecificDiagRate > 0.1) {
    deductions.push({
      type: 'documentation_gap',
      label: '⚠️ تشخيص غير محدد',
      rate: `${(nonSpecificDiagRate * 100).toFixed(0)}%`,
      deduction: parseFloat((nonSpecificDiagRate * 1.5).toFixed(1)),
      color: '#f59e0b'
    });
  }
  
  kpis.deductionLedger = deductions;
  
  // ========== 1. درجة عدالة الطبيب (Clinician Fairness) ==========
  // لا يُعاقب بشدة على نقص التوثيق
  let fairnessScore = 10;
  
  // خصم الأخطاء الطبية بالكامل
  fairnessScore -= medicalErrorRate * 3;
  fairnessScore -= ivRate * 2;
  
  // خصم نقص التوثيق بشكل مخفف (50% من الوزن)
  fairnessScore -= docGapRate * 0.5;
  fairnessScore -= Math.min(nonSpecificDiagRate * 0.5, 1); // حد أقصى -1
  
  kpis.clinicianFairness.score = Math.max(0, Math.min(10, parseFloat(fairnessScore.toFixed(1))));
  kpis.clinicianFairness.details = [
    { label: 'أخطاء طبية', value: `${medicalErrors}`, impact: 'عالي', status: medicalErrors === 0 ? 'good' : 'bad' },
    { label: 'نقص توثيق', value: `${docGaps}`, impact: 'منخفض', status: docGaps <= 1 ? 'good' : 'warning' },
    { label: 'IV بدون مبرر', value: `${ivWithoutJustCount}`, impact: 'عالي', status: ivWithoutJustCount === 0 ? 'good' : 'bad' }
  ];
  
  // ========== 2. درجة الدفاع التأميني (Insurance Defense) ==========
  // تبرير قوي أمام شركات التأمين
  let defenseScore = 10;
  
  // خصم الأخطاء الطبية بشكل كامل (شركات التأمين صارمة)
  defenseScore -= medicalErrorRate * 4;
  defenseScore -= ivRate * 3;
  
  // خصم نقص التوثيق (يؤثر على المطالبات)
  defenseScore -= docGapRate * 2;
  defenseScore -= nonSpecificDiagRate * 2;
  
  kpis.insuranceDefense.score = Math.max(0, Math.min(10, parseFloat(defenseScore.toFixed(1))));
  kpis.insuranceDefense.details = [
    { label: 'قبول الإجراءات', value: `${(procedureApprovalRate !== null ? procedureApprovalRate * 100 : 0).toFixed(0)}%`, target: '≥70%', status: procedureApprovalRate !== null && procedureApprovalRate >= 0.7 ? 'good' : 'bad' },
    { label: 'توثيق كامل', value: `${((1 - docGapRate) * 100).toFixed(0)}%`, target: '≥90%', status: docGapRate < 0.1 ? 'good' : 'bad' },
    { label: 'تشخيص محدد', value: `${(diagnosisSpecificityRate * 100).toFixed(0)}%`, target: '≥80%', status: diagnosisSpecificityRate >= 0.8 ? 'good' : 'bad' }
  ];
  
  // ========== الدرجة الرسمية المجمعة ==========
  // 60% دفاع تأميني + 40% عدالة الطبيب
  const officialScore = (kpis.insuranceDefense.score * 0.6) + (kpis.clinicianFairness.score * 0.4);
  kpis.overallScore.score = parseFloat(officialScore.toFixed(1));
  kpis.overallScore.formula = '60% دفاع تأميني + 40% عدالة الطبيب';

  return kpis;
}

/**
 * توليد HTML للوحة المؤشرات
 * @param {Object} kpis - مؤشرات الأداء
 * @param {string} period - الفترة (شهري/أسبوعي)
 * @returns {string} HTML
 */
export function generateKPIDashboardHTML(kpis, period = 'شهري') {
  const getScoreColor = (score) => {
    if (score === null || score === undefined) return '#6b7280'; // gray for N/A
    if (score >= 8) return '#22c55e'; // green
    if (score >= 6) return '#eab308'; // yellow
    if (score >= 4) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const getScoreEmoji = (score) => {
    if (score === null || score === undefined) return '⚪';
    if (score >= 8) return '🟢';
    if (score >= 6) return '🟡';
    if (score >= 4) return '🟠';
    return '🔴';
  };
  
  // دالة مساعدة لعرض النتيجة
  const formatScore = (score, max) => {
    if (score === null || score === undefined) return 'غير متوفر';
    return `${score}/${max}`;
  };

  const getStatusBadge = (status) => {
    if (status === 'good') {
      return '<span style="background:#22c55e;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">✓ جيد</span>';
    } else if (status === 'na') {
      return '<span style="background:#6b7280;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">- غير متوفر</span>';
    } else {
      return '<span style="background:#ef4444;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">✗ يحتاج تحسين</span>';
    }
  };

  // حساب الهدف الديناميكي - دائماً للأعلى
  const currentScore = kpis.overallScore.score !== null ? parseFloat(kpis.overallScore.score) : null;
  const targetScore = currentScore !== null ? (currentScore >= 9 ? 10.0 : currentScore >= 8 ? 9.0 : 8.0) : null;
  
  // نص الهدف
  const targetText = currentScore !== null 
    ? `التقييم ${period} - يمكن استهداف الرفع من ${currentScore} إلى ${targetScore}+ خلال 3 أشهر`
    : `التقييم ${period} - البيانات غير كافية لحساب التقييم`;
  
  // عرض التقييم الإجمالي
  const overallScoreDisplay = currentScore !== null ? currentScore : '—';
  const overallScoreSubtext = currentScore !== null ? '/10' : 'غير متوفر';

  return `
<div class="kpi-dashboard" style="background:linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%); border-radius:16px; padding:24px; margin:20px 0; direction:rtl;">
  
  <div style="text-align:center; margin-bottom:24px;">
    <h2 style="color:#c9a962; margin:0 0 8px 0; font-size:24px;">
      📊 لوحة مؤشرات الأداء
    </h2>
    <p style="color:#94a3b8; margin:0; font-size:14px;">${targetText}</p>
  </div>

  <!-- Overall Score Circle -->
  <div style="text-align:center; margin-bottom:24px;">
    <div style="display:inline-block; width:120px; height:120px; border-radius:50%; background:linear-gradient(135deg, ${getScoreColor(kpis.overallScore.score)}22, ${getScoreColor(kpis.overallScore.score)}44); border:4px solid ${getScoreColor(kpis.overallScore.score)}; position:relative;">
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center;">
        <div style="font-size:32px; font-weight:bold; color:${getScoreColor(kpis.overallScore.score)};">${overallScoreDisplay}</div>
        <div style="font-size:12px; color:#94a3b8;">${overallScoreSubtext}</div>
      </div>
    </div>
    <div style="margin-top:8px; color:#e2e8f0; font-size:14px;">التقييم الإجمالي</div>
  </div>

  <!-- Three KPI Cards -->
  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:24px;">
    
    <!-- Insurance Compliance -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:16px; border-right:4px solid ${getScoreColor(kpis.insuranceCompliance.score)};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="color:#e2e8f0; margin:0; font-size:16px;">🏥 الامتثال التأميني</h3>
        <div style="font-size:24px; font-weight:bold; color:${getScoreColor(kpis.insuranceCompliance.score)};">
          ${formatScore(kpis.insuranceCompliance.score, kpis.insuranceCompliance.max)}
        </div>
      </div>
      <div style="font-size:13px;">
        ${kpis.insuranceCompliance.details.map(d => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#94a3b8;">${d.label}</span>
            <span style="color:#e2e8f0;">${d.value} ${getStatusBadge(d.status)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Medical Quality -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:16px; border-right:4px solid ${getScoreColor(kpis.medicalQuality.score)};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="color:#e2e8f0; margin:0; font-size:16px;">⚕️ الجودة الطبية</h3>
        <div style="font-size:24px; font-weight:bold; color:${getScoreColor(kpis.medicalQuality.score)};">
          ${formatScore(kpis.medicalQuality.score, kpis.medicalQuality.max)}
        </div>
      </div>
      <div style="font-size:13px;">
        ${kpis.medicalQuality.details.map(d => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#94a3b8;">${d.label}</span>
            <span style="color:#e2e8f0;">${d.value} ${getStatusBadge(d.status)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Documentation Quality -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:16px; border-right:4px solid ${getScoreColor(kpis.documentationQuality.score)};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="color:#e2e8f0; margin:0; font-size:16px;">📝 جودة التوثيق</h3>
        <div style="font-size:24px; font-weight:bold; color:${getScoreColor(kpis.documentationQuality.score)};">
          ${formatScore(kpis.documentationQuality.score, kpis.documentationQuality.max)}
        </div>
      </div>
      <div style="font-size:13px;">
        ${kpis.documentationQuality.details.map(d => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="color:#94a3b8;">${d.label}</span>
            <span style="color:#e2e8f0;">${d.value} ${getStatusBadge(d.status)}</span>
          </div>
        `).join('')}
      </div>
    </div>

  </div>

  <!-- Improvement Recommendations -->
  <div style="background:rgba(201,169,98,0.1); border-radius:12px; padding:16px; border:1px solid rgba(201,169,98,0.3);">
    <h4 style="color:#c9a962; margin:0 0 12px 0; font-size:15px;">📈 خطة التحسين المقترحة</h4>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; font-size:13px; color:#e2e8f0;">
      ${generateImprovementPlan(kpis)}
    </div>
  </div>

  <!-- Target Setting -->
  ${currentScore !== null ? `
  <div style="margin-top:16px; padding:12px; background:rgba(34,197,94,0.1); border-radius:8px; text-align:center;">
    <span style="color:#22c55e; font-size:14px;">
      🎯 الهدف: رفع التقييم الإجمالي من <strong>${currentScore}</strong> إلى <strong>${targetScore}</strong> خلال 3 أشهر
    </span>
  </div>
  ` : `
  <div style="margin-top:16px; padding:12px; background:rgba(107,114,128,0.1); border-radius:8px; text-align:center;">
    <span style="color:#9ca3af; font-size:14px;">
      ⚠️ البيانات غير كافية لتحديد هدف رقمي - يرجى توفير بيانات كاملة
    </span>
  </div>
  `}

</div>`;
}

/**
 * توليد خطة التحسين بناءً على أدنى المؤشرات
 */
function generateImprovementPlan(kpis) {
  const improvements = [];
  
  // Insurance improvements
  kpis.insuranceCompliance.details.forEach(d => {
    if (d.status === 'bad') {
      switch(d.label) {
        case 'معدل القبول':
          improvements.push('<div>✓ مراجعة أسباب الرفض وتوثيقها مسبقاً</div>');
          break;
        case 'نسبة يحتاج توثيق':
          improvements.push('<div>✓ إكمال التوثيق قبل الصرف (VAS, علامات حيوية)</div>');
          break;
        case 'نسبة التكرار':
          improvements.push('<div>✓ مراجعة سجل المريض قبل الصرف</div>');
          break;
        case 'IV بدون مبرر':
          improvements.push('<div>✓ توثيق سبب عدم تحمل الفم أو VAS</div>');
          break;
      }
    }
  });

  // Medical improvements
  kpis.medicalQuality.details.forEach(d => {
    if (d.status === 'bad') {
      switch(d.label) {
        case 'المضادات المناسبة':
          improvements.push('<div>✓ طلب RADT/زرع قبل وصف المضاد</div>');
          break;
        case 'توثيق العلامات الحيوية':
          improvements.push('<div>✓ قياس وتسجيل الحرارة والضغط لكل حالة</div>');
          break;
        case 'الفحوصات المطلوبة':
          improvements.push('<div>✓ طلب الفحوصات المطلوبة حسب التشخيص</div>');
          break;
      }
    }
  });

  // Documentation improvements
  kpis.documentationQuality.details.forEach(d => {
    if (d.status === 'bad') {
      switch(d.label) {
        case 'التشخيص المحدد':
          improvements.push('<div>✓ كتابة تشخيص محدد وليس عام (مثال: التهاب لوزتين صديدي)</div>');
          break;
        case 'أكواد ICD موجودة':
          improvements.push('<div>✓ إضافة كود ICD-10 لكل تشخيص</div>');
          break;
      }
    }
  });

  if (improvements.length === 0) {
    improvements.push('<div style="color:#22c55e;">🎉 جميع المؤشرات ضمن الهدف - استمر!</div>');
  }

  return improvements.join('');
}

/**
 * استخراج الإحصائيات من بيانات الحالات المهيكلة
 * @param {Array} cases - مصفوفة الحالات المهيكلة
 * @returns {Object} إحصائيات
 */
export function extractStatsFromCases(cases) {
  const stats = {
    totalCases: cases.length,
    totalServiceItems: 0, // إجمالي بنود الخدمة من الإكسل
    approvedCount: 0,
    rejectedCount: 0,
    needsDocCount: 0,
    duplicateCount: 0,
    duplicateCases: 0, // عدد الحالات التي فيها تكرار
    ivWithoutJustification: 0,
    antibioticTotal: 0,
    antibioticAppropriate: 0,
    vitalsDocumented: 0,
    requiredTestsTotal: 0,
    requiredTestsOrdered: 0,
    diagnosisSpecific: 0,
    diagnosisNonSpecific: 0, // للتوضيح
    icdCodesPresent: 0
  };

  // تتبع التكرارات على مستوى الخدمة
  const serviceOccurrences = new Map(); // claimId+serviceCode -> count

  for (const c of cases) {
    // حساب إجمالي بنود الخدمة الفعلية
    const serviceCount = c.services?.length || 0;
    stats.totalServiceItems += serviceCount;
    
    // تحديد حالة الحالة
    const hasVitals = c.vitals && (c.vitals.temperature || c.vitals.bloodPressure || c.vitals.pulse);
    const hasIcd = c.icdCode && c.icdCode.length > 0;
    
    // ========== أولاً: تتبع التكرارات داخل نفس المطالبة ==========
    const claimServices = new Map();
    for (const svc of (c.services || [])) {
      const key = `${svc.code || svc.name}`;
      claimServices.set(key, (claimServices.get(key) || 0) + 1);
    }
    
    // تحديد الخدمات المكررة
    const duplicatedKeys = new Set();
    let hasDuplicate = false;
    for (const [key, count] of claimServices) {
      if (count > 1) {
        stats.duplicateCount += (count - 1);
        hasDuplicate = true;
        duplicatedKeys.add(key);
      }
    }
    if (hasDuplicate) {
      stats.duplicateCases++;
    }
    
    // ========== ثانياً: تقييم كل خدمة (حالة واحدة فقط: مقبول/مرفوض/تحتاج توثيق) ==========
    const seenServices = new Map(); // لتتبع أي خدمة تم عدها
    
    for (const svc of (c.services || [])) {
      const svcKey = svc.code || svc.name;
      const svcName = (svc.name || svc.code || '').toUpperCase();
      
      // تحديد حالة الخدمة
      let status = 'approved'; // افتراضي: مقبول
      
      // التكرار: الخدمة الأولى من نوعها = تقييم عادي، المكررة = needsDoc
      const seenCount = seenServices.get(svcKey) || 0;
      if (seenCount > 0 && duplicatedKeys.has(svcKey)) {
        status = 'needsDoc'; // مكررة
      } else {
        // معايير الرفض:
        const isIV = svcName.includes('IV') || svcName.includes('INFUSION') || svcName.includes('SALINE');
        if (isIV) {
          const hasJustification = c.diagnosis?.toLowerCase().includes('vomit') ||
                                   c.diagnosis?.toLowerCase().includes('dehydrat') ||
                                   c.diagnosis?.toLowerCase().includes('قيء') ||
                                   (c.vitals?.temperature && parseFloat(c.vitals.temperature) >= 39);
          if (!hasJustification) {
            status = 'rejected';
          }
        }
        
        // معايير "تحتاج توثيق":
        if (status === 'approved') {
          if (!hasVitals && (svcName.includes('CONSULTATION') || svcName.includes('INJECTION'))) {
            status = 'needsDoc';
          } else if (!hasIcd) {
            status = 'needsDoc';
          }
        }
      }
      
      seenServices.set(svcKey, seenCount + 1);
      
      // تحديث العدادات (حالة واحدة فقط لكل خدمة)
      if (status === 'approved') stats.approvedCount++;
      else if (status === 'rejected') stats.rejectedCount++;
      else stats.needsDocCount++;
    }
    
    // Vitals documented
    if (hasVitals) {
      stats.vitalsDocumented++;
    }

    // ICD codes present
    if (c.icdCode && c.icdCode.length > 0) {
      stats.icdCodesPresent++;
    }

    // Specific diagnosis - تعريف واضح
    // التشخيص غير محدد إذا: يحتوي على UNSPECIFIED أو ينتهي بـ .9 أو يحتوي على "site not specified"
    const diagLower = (c.diagnosis || '').toLowerCase();
    const icdCode = c.icdCode || '';
    const isNonSpecific = diagLower.includes('unspecified') ||
                          diagLower.includes('site not specified') ||
                          diagLower.includes('غير محدد') ||
                          icdCode.endsWith('.9');
    
    if (c.diagnosis && c.diagnosis.length > 5 && !isNonSpecific) {
      stats.diagnosisSpecific++;
    } else if (c.diagnosis) {
      stats.diagnosisNonSpecific++;
    }

    // Count IV medications without clear justification
    const hasIV = c.medications?.some(m => 
      m.name?.toUpperCase().includes('IV') || 
      m.name?.toUpperCase().includes('INFUSION') ||
      m.name?.includes('وريدي')
    );
    
    if (hasIV) {
      // Check for justification indicators
      const hasJustification = c.diagnosis?.toLowerCase().includes('vomit') ||
                               c.diagnosis?.toLowerCase().includes('قيء') ||
                               c.diagnosis?.toLowerCase().includes('dehydration') ||
                               c.diagnosis?.toLowerCase().includes('جفاف') ||
                               (c.vitals?.temperature && parseFloat(c.vitals.temperature) >= 39);
      if (!hasJustification) {
        stats.ivWithoutJustification++;
      }
    }

    // Count antibiotics
    const hasAntibiotic = c.medications?.some(m => 
      m.name?.toUpperCase().includes('AMOXICILLIN') ||
      m.name?.toUpperCase().includes('AZITHROMYCIN') ||
      m.name?.toUpperCase().includes('AUGMENTIN') ||
      m.name?.toUpperCase().includes('CEFUROXIME') ||
      m.name?.toUpperCase().includes('CIPROFLOXACIN')
    );
    
    if (hasAntibiotic) {
      stats.antibioticTotal++;
      // Check if has bacterial indication
      const hasBacterialIndication = c.diagnosis?.toLowerCase().includes('bacterial') ||
                                     c.diagnosis?.toLowerCase().includes('بكتيري') ||
                                     c.diagnosis?.toLowerCase().includes('tonsillitis') ||
                                     c.diagnosis?.toLowerCase().includes('pneumonia') ||
                                     c.diagnosis?.toLowerCase().includes('uti');
      if (hasBacterialIndication) {
        stats.antibioticAppropriate++;
      }
    }
  }

  // نسبة التكرار: عدد الحالات التي فيها تكرار ÷ إجمالي الحالات
  stats.duplicateRate = stats.totalCases > 0 ? (stats.duplicateCases / stats.totalCases) : 0;

  return stats;
}

/**
 * استخراج الإحصائيات من تقرير HTML (fallback)
 * @param {string} htmlReport - تقرير HTML
 * @returns {Object} إحصائيات
 */
export function extractStatsFromReport(htmlReport) {
  const stats = {
    totalCases: 0,
    approvedCount: 0,
    rejectedCount: 0,
    needsDocCount: 0,
    duplicateCount: 0,
    ivWithoutJustification: 0,
    antibioticTotal: 0,
    antibioticAppropriate: 0,
    vitalsDocumented: 0,
    requiredTestsTotal: 0,
    requiredTestsOrdered: 0,
    diagnosisSpecific: 0,
    icdCodesPresent: 0
  };

  if (!htmlReport || typeof htmlReport !== 'string') {
    return stats;
  }

  // Count cases from HTML
  const caseMatches = htmlReport.match(/الحالة\s*(?:رقم\s*)?#?\d+|Case\s*#?\d+/gi);
  stats.totalCases = caseMatches ? caseMatches.length : 1;

  // ========== استخراج الإحصائيات الفعلية من التقرير ==========
  // ✅ نعد فقط خلايا الجدول (td) لتجنب العد المزدوج من صناديق التفاصيل
  
  // عد البنود المقبولة - فقط في خلايا الجدول
  // نبحث عن: ✅ مقبول أو <td>مقبول</td> أو خلية بها class approved
  const approvedPattern = /<td[^>]*>(?:[^<]*)?✅\s*مقبول|<td[^>]*>\s*مقبول\s*<\/td>/gi;
  const approvedMatches = htmlReport.match(approvedPattern);
  stats.approvedCount = approvedMatches ? approvedMatches.length : 0;

  // عد البنود المرفوضة - فقط في خلايا الجدول
  // نبحث عن: 🚫 مرفوض في خلية
  const rejectedPattern = /<td[^>]*>(?:[^<]*)?(?:🚫|❌|⛔)\s*مرفوض|<td[^>]*>\s*مرفوض\s*<\/td>/gi;
  const rejectedMatches = htmlReport.match(rejectedPattern);
  stats.rejectedCount = rejectedMatches ? rejectedMatches.length : 0;

  // عد البنود التي تحتاج توثيق - فقط في خلايا الجدول
  // نبحث عن: ⚠️ يحتاج توثيق في خلية
  const needsDocPattern = /<td[^>]*>(?:[^<]*)?⚠️?\s*يحتاج\s*توثيق|<td[^>]*>\s*يحتاج\s*توثيق\s*<\/td>/gi;
  const needsDocMatches = htmlReport.match(needsDocPattern);
  stats.needsDocCount = needsDocMatches ? needsDocMatches.length : 0;
  
  // Fallback: إذا لم نجد أي شيء بالطريقة الدقيقة، نستخدم الطريقة العامة
  if (stats.approvedCount === 0 && stats.rejectedCount === 0 && stats.needsDocCount === 0) {
    // عد عام كـ fallback
    const generalApproved = htmlReport.match(/✅\s*مقبول/gi);
    const generalRejected = htmlReport.match(/🚫\s*مرفوض/gi);
    const generalNeedsDoc = htmlReport.match(/⚠️\s*يحتاج\s*توثيق/gi);
    
    stats.approvedCount = generalApproved ? generalApproved.length : 0;
    stats.rejectedCount = generalRejected ? generalRejected.length : 0;
    stats.needsDocCount = generalNeedsDoc ? generalNeedsDoc.length : 0;
  }

  // عد حالات التكرار
  const duplicateMatches = htmlReport.match(/تكرار|مكرر|duplicate/gi);
  stats.duplicateCount = duplicateMatches ? duplicateMatches.length : 0;

  // عد IV بدون مبرر
  const ivNoJustMatches = htmlReport.match(/IV\s*بدون\s*مبرر|وريدي\s*غير\s*مبرر|IV\s*without\s*justification/gi);
  stats.ivWithoutJustification = ivNoJustMatches ? ivNoJustMatches.length : 0;

  // عد العلامات الحيوية الموثقة
  const vitalsMatches = htmlReport.match(/درجة\s*الحرارة:\s*\d|Temperature:\s*\d|ضغط\s*الدم:\s*\d|BP:\s*\d/gi);
  stats.vitalsDocumented = vitalsMatches ? Math.min(vitalsMatches.length, stats.totalCases) : 0;

  // عد أكواد ICD الموجودة
  const icdMatches = htmlReport.match(/[A-Z]\d{2}(?:\.\d{1,2})?/g);
  stats.icdCodesPresent = icdMatches ? Math.min(new Set(icdMatches).size, stats.totalCases) : 0;

  // عد التشخيصات المحددة (غير المنتهية بـ unspecified)
  const diagMatches = htmlReport.match(/التشخيص:\s*[^<\n]+/gi);
  if (diagMatches) {
    const specificCount = diagMatches.filter(d => 
      !d.toLowerCase().includes('unspecified') && 
      !d.includes('غير محدد') &&
      !d.match(/\.\d*9\s*-/)
    ).length;
    stats.diagnosisSpecific = specificCount;
  }

  return stats;
}

export default { calculateKPIs, generateKPIDashboardHTML, extractStatsFromReport };
