/**
 * لوحة مؤشرات الأداء الشهرية (KPI Dashboard)
 * تحويل تقييمات التقارير إلى مؤشرات قابلة للقياس
 */

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
    overallScore: { score: 0, max: 10 }
  };

  const totalCases = reportStats.totalCases || 1;

  // 1. Insurance Compliance Score /10
  // Based on: approval rate, documentation completeness, duplicate rate
  const approvalRate = (reportStats.approvedCount || 0) / totalCases;
  const needsDocRate = (reportStats.needsDocCount || 0) / totalCases;
  const duplicateRate = (reportStats.duplicateCount || 0) / totalCases;
  const ivWithoutJustificationRate = (reportStats.ivWithoutJustification || 0) / totalCases;

  // Score calculation
  let insuranceScore = 10;
  insuranceScore -= (1 - approvalRate) * 3; // -3 max for rejections
  insuranceScore -= needsDocRate * 2; // -2 max for missing docs
  insuranceScore -= duplicateRate * 2; // -2 max for duplicates
  insuranceScore -= ivWithoutJustificationRate * 3; // -3 max for unjustified IV
  kpis.insuranceCompliance.score = Math.max(0, Math.min(10, parseFloat(insuranceScore.toFixed(1))));
  
  kpis.insuranceCompliance.details = [
    { label: 'معدل القبول', value: `${(approvalRate * 100).toFixed(0)}%`, target: '≥80%', status: approvalRate >= 0.8 ? 'good' : 'bad' },
    { label: 'نسبة يحتاج توثيق', value: `${(needsDocRate * 100).toFixed(0)}%`, target: '<15%', status: needsDocRate < 0.15 ? 'good' : 'bad' },
    { label: 'نسبة التكرار', value: `${(duplicateRate * 100).toFixed(0)}%`, target: '<5%', status: duplicateRate < 0.05 ? 'good' : 'bad' },
    { label: 'IV بدون مبرر', value: `${(ivWithoutJustificationRate * 100).toFixed(0)}%`, target: '<10%', status: ivWithoutJustificationRate < 0.1 ? 'good' : 'bad' }
  ];

  // 2. Medical Quality Score /10
  // Based on: antibiotic appropriateness, vital signs documentation, test ordering
  const antibioticAppropriateRate = reportStats.antibioticAppropriate ? 
    (reportStats.antibioticAppropriate / (reportStats.antibioticTotal || 1)) : 1;
  const vitalsDocRate = reportStats.vitalsDocumented ? 
    (reportStats.vitalsDocumented / totalCases) : 0.5;
  const requiredTestsOrderedRate = reportStats.requiredTestsOrdered ?
    (reportStats.requiredTestsOrdered / (reportStats.requiredTestsTotal || 1)) : 1;

  let medicalScore = 10;
  medicalScore -= (1 - antibioticAppropriateRate) * 4; // -4 max for inappropriate antibiotics
  medicalScore -= (1 - vitalsDocRate) * 3; // -3 max for missing vitals
  medicalScore -= (1 - requiredTestsOrderedRate) * 3; // -3 max for missing required tests
  kpis.medicalQuality.score = Math.max(0, Math.min(10, parseFloat(medicalScore.toFixed(1))));

  kpis.medicalQuality.details = [
    { label: 'المضادات المناسبة', value: `${(antibioticAppropriateRate * 100).toFixed(0)}%`, target: '≥90%', status: antibioticAppropriateRate >= 0.9 ? 'good' : 'bad' },
    { label: 'توثيق العلامات الحيوية', value: `${(vitalsDocRate * 100).toFixed(0)}%`, target: '≥95%', status: vitalsDocRate >= 0.95 ? 'good' : 'bad' },
    { label: 'الفحوصات المطلوبة', value: `${(requiredTestsOrderedRate * 100).toFixed(0)}%`, target: '≥85%', status: requiredTestsOrderedRate >= 0.85 ? 'good' : 'bad' }
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

  // Overall Score (weighted average)
  kpis.overallScore.score = parseFloat((
    (kpis.insuranceCompliance.score * 0.4) +
    (kpis.medicalQuality.score * 0.35) +
    (kpis.documentationQuality.score * 0.25)
  ).toFixed(1));

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
    if (score >= 8) return '#22c55e'; // green
    if (score >= 6) return '#eab308'; // yellow
    if (score >= 4) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const getScoreEmoji = (score) => {
    if (score >= 8) return '🟢';
    if (score >= 6) return '🟡';
    if (score >= 4) return '🟠';
    return '🔴';
  };

  const getStatusBadge = (status) => {
    return status === 'good' 
      ? '<span style="background:#22c55e;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">✓ جيد</span>'
      : '<span style="background:#ef4444;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">✗ يحتاج تحسين</span>';
  };

  // حساب الهدف الديناميكي - دائماً للأعلى
  const currentScore = parseFloat(kpis.overallScore.score) || 0;
  const targetScore = currentScore >= 9 ? 10.0 : currentScore >= 8 ? 9.0 : 8.0;

  return `
<div class="kpi-dashboard" style="background:linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%); border-radius:16px; padding:24px; margin:20px 0; direction:rtl;">
  
  <div style="text-align:center; margin-bottom:24px;">
    <h2 style="color:#c9a962; margin:0 0 8px 0; font-size:24px;">
      📊 لوحة مؤشرات الأداء
    </h2>
    <p style="color:#94a3b8; margin:0; font-size:14px;">التقييم ${period} - يمكن استهداف الرفع من ${kpis.overallScore.score} إلى ${targetScore}+ خلال 3 أشهر</p>
  </div>

  <!-- Overall Score Circle -->
  <div style="text-align:center; margin-bottom:24px;">
    <div style="display:inline-block; width:120px; height:120px; border-radius:50%; background:linear-gradient(135deg, ${getScoreColor(kpis.overallScore.score)}22, ${getScoreColor(kpis.overallScore.score)}44); border:4px solid ${getScoreColor(kpis.overallScore.score)}; position:relative;">
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center;">
        <div style="font-size:32px; font-weight:bold; color:${getScoreColor(kpis.overallScore.score)};">${kpis.overallScore.score}</div>
        <div style="font-size:12px; color:#94a3b8;">/10</div>
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
          ${kpis.insuranceCompliance.score}/${kpis.insuranceCompliance.max}
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
          ${kpis.medicalQuality.score}/${kpis.medicalQuality.max}
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
          ${kpis.documentationQuality.score}/${kpis.documentationQuality.max}
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
  <div style="margin-top:16px; padding:12px; background:rgba(34,197,94,0.1); border-radius:8px; text-align:center;">
    <span style="color:#22c55e; font-size:14px;">
      🎯 الهدف: رفع التقييم الإجمالي من <strong>${kpis.overallScore.score}</strong> إلى <strong>${targetScore}</strong> خلال 3 أشهر
    </span>
  </div>

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

  for (const c of cases) {
    // Vitals documented
    if (c.vitals && (c.vitals.temperature || c.vitals.bloodPressure || c.vitals.pulse)) {
      stats.vitalsDocumented++;
    }

    // ICD codes present
    if (c.icdCode && c.icdCode.length > 0) {
      stats.icdCodesPresent++;
    }

    // Specific diagnosis (not vague)
    if (c.diagnosis && c.diagnosis.length > 10 && 
        !c.diagnosis.toLowerCase().includes('unspecified') &&
        !c.diagnosis.includes('غير محدد')) {
      stats.diagnosisSpecific++;
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

  // Estimate approval rate based on documentation quality
  const docQuality = (stats.vitalsDocumented + stats.icdCodesPresent + stats.diagnosisSpecific) / (stats.totalCases * 3);
  stats.approvedCount = Math.round(stats.totalCases * Math.min(0.9, docQuality + 0.3));
  stats.needsDocCount = Math.round(stats.totalCases * (1 - docQuality) * 0.5);
  stats.rejectedCount = stats.totalCases - stats.approvedCount - stats.needsDocCount;

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

  // Count cases from HTML
  const caseMatches = htmlReport.match(/الحالة\s*#?\d+|Case\s*#?\d+/gi);
  stats.totalCases = caseMatches ? caseMatches.length : 1;

  // For single-case reports, use reasonable defaults
  stats.vitalsDocumented = 1;
  stats.diagnosisSpecific = 1;
  stats.approvedCount = 1;

  return stats;
}

export default { calculateKPIs, generateKPIDashboardHTML, extractStatsFromReport };
