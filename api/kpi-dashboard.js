/**
 * لوحة مؤشرات الأداء المبسطة (KPI Dashboard)
 * 3 مقاييس معيارية ثابتة وواضحة:
 * 1. جودة التوثيق التأميني (Documentation Quality)
 * 2. جودة الخدمات الطبية (Medical Service Quality)
 * 3. نسبة استحقاق المرضى (Patient Eligibility)
 */

/**
 * حساب مؤشرات الأداء المبسطة - 3 مقاييس معيارية فقط
 * @param {Object} reportStats - إحصائيات التقرير
 * @returns {Object} مؤشرات الأداء الثلاثة
 */
export function calculateKPIs(reportStats) {
  const totalCases = reportStats.totalCases || 1;
  const totalProcedures = reportStats.totalProcedures || 
    ((reportStats.approvedCount || 0) + (reportStats.rejectedCount || 0) + (reportStats.needsDocCount || 0)) || 1;

  // ========== المقياس 1: جودة التوثيق التأميني ==========
  // أخطاء التوثيق: IV بدون مبرر، تشخيص غير محدد، نقص تحاليل، ICD ناقص
  const documentationErrors = reportStats.documentationErrors || 
    ((reportStats.needsDocCount || 0) + (reportStats.diagnosisNonSpecific || 0));
  
  const documentationQualityPct = totalProcedures > 0 
    ? Math.round(((totalProcedures - documentationErrors) / totalProcedures) * 100)
    : null;

  // ========== المقياس 2: جودة الخدمات الطبية ==========
  // أخطاء طبية: أدوية غير مناسبة، جرعات خاطئة، IV غير مبرر طبياً
  const medicalErrors = reportStats.medicalErrors || 
    ((reportStats.rejectedCount || 0) + (reportStats.ivWithoutJustification || 0));
  
  const medicalServiceQualityPct = totalProcedures > 0 
    ? Math.round(((totalProcedures - medicalErrors) / totalProcedures) * 100)
    : null;

  // ========== المقياس 3: نسبة استحقاق المرضى ==========
  // المرضى الذين لديهم خلل في الاستحقاق (تأمين منتهي، خدمة غير مغطاة)
  const patientsWithEligibilityGaps = reportStats.patientsWithEligibilityGaps || 0;
  
  const patientEligibilityPct = totalCases > 0 
    ? Math.round(((totalCases - patientsWithEligibilityGaps) / totalCases) * 100)
    : null;

  // ========== النتيجة الإجمالية (متوسط المقاييس الثلاثة) ==========
  const validMetrics = [documentationQualityPct, medicalServiceQualityPct, patientEligibilityPct].filter(v => v !== null);
  const overallPct = validMetrics.length > 0 
    ? Math.round(validMetrics.reduce((a, b) => a + b, 0) / validMetrics.length)
    : null;

  return {
    // المقاييس الثلاثة الرئيسية (نسب مئوية)
    documentationQuality: {
      percentage: documentationQualityPct,
      errors: documentationErrors,
      total: totalProcedures,
      label: 'جودة التوثيق التأميني',
      description: 'نقص تحاليل، IV بدون تشخيص سابق، تشخيص غير محدد'
    },
    medicalServiceQuality: {
      percentage: medicalServiceQualityPct,
      errors: medicalErrors,
      total: totalProcedures,
      label: 'جودة الخدمات الطبية',
      description: 'أدوية خاطئة، جرعات زائدة، وصفات غير مناسبة'
    },
    patientEligibility: {
      percentage: patientEligibilityPct,
      gaps: patientsWithEligibilityGaps,
      total: totalCases,
      label: 'نسبة استحقاق المرضى',
      description: 'مرضى بدون تغطية تأمينية أو خدمات غير مشمولة'
    },
    // الملخص
    overall: {
      percentage: overallPct,
      label: 'النتيجة الإجمالية'
    },
    // بيانات خام للرسوم البيانية
    rawStats: {
      totalCases,
      totalProcedures,
      documentationErrors,
      medicalErrors,
      patientsWithEligibilityGaps,
      approvedCount: reportStats.approvedCount || 0,
      rejectedCount: reportStats.rejectedCount || 0,
      needsDocCount: reportStats.needsDocCount || 0
    }
  };
}

/**
 * الحصول على لون النسبة المئوية
 */
function getPercentageColor(pct) {
  if (pct === null || pct === undefined) return '#6b7280';
  if (pct >= 90) return '#22c55e';
  if (pct >= 75) return '#eab308';
  if (pct >= 60) return '#f97316';
  return '#ef4444';
}

/**
 * توليد شريط تقدم بصري
 */
function generateProgressBar(pct, color) {
  const width = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
  return `
    <div style="background:rgba(255,255,255,0.1); border-radius:8px; height:12px; overflow:hidden; margin-top:8px;">
      <div style="background:${color}; height:100%; width:${width}%; transition:width 0.3s ease;"></div>
    </div>`;
}

/**
 * توليد HTML للوحة المؤشرات المبسطة - 3 مقاييس فقط
 * @param {Object} kpis - مؤشرات الأداء
 * @param {string} period - الفترة (شهري/أسبوعي)
 * @returns {string} HTML
 */
export function generateKPIDashboardHTML(kpis, period = 'شهري') {
  const docQuality = kpis.documentationQuality || {};
  const medQuality = kpis.medicalServiceQuality || {};
  const eligibility = kpis.patientEligibility || {};
  const overall = kpis.overall || {};
  
  const docPct = docQuality.percentage;
  const medPct = medQuality.percentage;
  const eligPct = eligibility.percentage;
  const overallPct = overall.percentage;

  const formatPct = (pct) => pct !== null && pct !== undefined ? `${pct}%` : 'غير متوفر';
  
  return `
<div class="kpi-dashboard" style="background:linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%); border-radius:16px; padding:24px; margin:20px 0; direction:rtl; font-family:'Tajawal',sans-serif;">
  
  <div style="text-align:center; margin-bottom:24px;">
    <h2 style="color:#c9a962; margin:0 0 8px 0; font-size:24px;">
      📊 لوحة المؤشرات المعيارية
    </h2>
    <p style="color:#94a3b8; margin:0; font-size:14px;">التقييم ${period} - 3 مقاييس ثابتة وواضحة</p>
  </div>

  <!-- النتيجة الإجمالية -->
  <div style="text-align:center; margin-bottom:28px;">
    <div style="display:inline-block; width:140px; height:140px; border-radius:50%; background:linear-gradient(135deg, ${getPercentageColor(overallPct)}22, ${getPercentageColor(overallPct)}44); border:5px solid ${getPercentageColor(overallPct)}; position:relative;">
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center;">
        <div style="font-size:36px; font-weight:bold; color:${getPercentageColor(overallPct)};">${formatPct(overallPct)}</div>
        <div style="font-size:11px; color:#94a3b8;">النتيجة الإجمالية</div>
      </div>
    </div>
  </div>

  <!-- المقاييس الثلاثة -->
  <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:24px;">
    
    <!-- 1. جودة التوثيق التأميني -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:20px; border-top:4px solid ${getPercentageColor(docPct)}; text-align:center;">
      <div style="font-size:14px; color:#94a3b8; margin-bottom:8px;">📋 جودة التوثيق التأميني</div>
      <div style="font-size:42px; font-weight:bold; color:${getPercentageColor(docPct)}; margin-bottom:4px;">${formatPct(docPct)}</div>
      ${generateProgressBar(docPct, getPercentageColor(docPct))}
      <div style="font-size:11px; color:#64748b; margin-top:12px;">
        ${docQuality.description || 'نقص تحاليل، IV بدون تشخيص سابق'}
      </div>
      ${docQuality.errors ? `<div style="font-size:10px; color:#f59e0b; margin-top:4px;">⚠️ ${docQuality.errors} خلل من ${docQuality.total}</div>` : ''}
    </div>

    <!-- 2. جودة الخدمات الطبية -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:20px; border-top:4px solid ${getPercentageColor(medPct)}; text-align:center;">
      <div style="font-size:14px; color:#94a3b8; margin-bottom:8px;">⚕️ جودة الخدمات الطبية</div>
      <div style="font-size:42px; font-weight:bold; color:${getPercentageColor(medPct)}; margin-bottom:4px;">${formatPct(medPct)}</div>
      ${generateProgressBar(medPct, getPercentageColor(medPct))}
      <div style="font-size:11px; color:#64748b; margin-top:12px;">
        ${medQuality.description || 'أدوية خاطئة، جرعات زائدة'}
      </div>
      ${medQuality.errors ? `<div style="font-size:10px; color:#ef4444; margin-top:4px;">❌ ${medQuality.errors} خطأ من ${medQuality.total}</div>` : ''}
    </div>

    <!-- 3. نسبة استحقاق المرضى -->
    <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:20px; border-top:4px solid ${getPercentageColor(eligPct)}; text-align:center;">
      <div style="font-size:14px; color:#94a3b8; margin-bottom:8px;">👤 استحقاق المرضى</div>
      <div style="font-size:42px; font-weight:bold; color:${getPercentageColor(eligPct)}; margin-bottom:4px;">${formatPct(eligPct)}</div>
      ${generateProgressBar(eligPct, getPercentageColor(eligPct))}
      <div style="font-size:11px; color:#64748b; margin-top:12px;">
        ${eligibility.description || 'مرضى بتغطية تأمينية صالحة'}
      </div>
      ${eligibility.gaps ? `<div style="font-size:10px; color:#f59e0b; margin-top:4px;">⚠️ ${eligibility.gaps} مريض بدون تغطية من ${eligibility.total}</div>` : ''}
    </div>

  </div>

  <!-- ملخص المعادلات -->
  <div style="background:rgba(201,169,98,0.1); border-radius:12px; padding:16px; border:1px solid rgba(201,169,98,0.3);">
    <h4 style="color:#c9a962; margin:0 0 12px 0; font-size:15px;">📐 المعادلات المستخدمة</h4>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px; font-size:12px; color:#e2e8f0;">
      <div style="padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">
        <strong style="color:#3b82f6;">جودة التوثيق</strong> = (الإجراءات - أخطاء التوثيق) ÷ الإجراءات × 100
      </div>
      <div style="padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">
        <strong style="color:#22c55e;">جودة الخدمات</strong> = (الإجراءات - الأخطاء الطبية) ÷ الإجراءات × 100
      </div>
      <div style="padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">
        <strong style="color:#f59e0b;">الاستحقاق</strong> = (المرضى - ناقصي الاستحقاق) ÷ المرضى × 100
      </div>
    </div>
  </div>

  <!-- مؤشر الهدف -->
  ${overallPct !== null ? `
  <div style="margin-top:16px; padding:12px; background:${overallPct >= 90 ? 'rgba(34,197,94,0.15)' : overallPct >= 75 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)'}; border-radius:8px; text-align:center;">
    <span style="color:${getPercentageColor(overallPct)}; font-size:14px;">
      ${overallPct >= 90 ? '🎉 أداء ممتاز! استمر في هذا المستوى' : 
        overallPct >= 75 ? '📈 أداء جيد - يمكن تحسينه للوصول إلى 90%+' : 
        '⚠️ يحتاج تحسين عاجل - راجع الأخطاء المذكورة'}
    </span>
  </div>
  ` : ''}

</div>`;
}

/**
 * استخراج الإحصائيات من بيانات الحالات المهيكلة
 * @param {Array} cases - مصفوفة الحالات المهيكلة
 * @returns {Object} إحصائيات
 */
export function extractStatsFromCases(cases) {
  const stats = {
    totalCases: cases.length,
    totalServiceItems: 0,
    approvedCount: 0,
    rejectedCount: 0,
    needsDocCount: 0,
    duplicateCount: 0,
    duplicateCases: 0,
    ivWithoutJustification: 0,
    antibioticTotal: 0,
    antibioticAppropriate: 0,
    vitalsDocumented: 0,
    requiredTestsTotal: 0,
    requiredTestsOrdered: 0,
    diagnosisSpecific: 0,
    diagnosisNonSpecific: 0,
    icdCodesPresent: 0,
    // للمقاييس الثلاثة المبسطة
    casesWithDocIssues: 0,    // حالات بها مشاكل توثيق
    casesWithMedicalErrors: 0  // حالات بها أخطاء طبية
  };

  for (const c of cases) {
    const serviceCount = c.services?.length || 0;
    stats.totalServiceItems += serviceCount;
    
    const hasVitals = c.vitals && (c.vitals.temperature || c.vitals.bloodPressure || c.vitals.pulse);
    const hasIcd = c.icdCode && c.icdCode.length > 0;
    
    // متغيرات لتتبع حالة هذا المريض
    let caseHasDocIssue = false;
    let caseHasMedicalError = false;
    
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
    // ========== USE RULES ENGINE DECISIONS AS SINGLE SOURCE OF TRUTH ==========
    const medicationDecisions = c._medicationDecisions || [];
    const medicationDecisionMap = new Map();
    for (const md of medicationDecisions) {
      medicationDecisionMap.set((md.name || '').toUpperCase(), md);
    }
    
    const seenServices = new Map(); // لتتبع أي خدمة تم عدها
    
    for (const svc of (c.services || [])) {
      const svcKey = svc.code || svc.name;
      const svcName = (svc.name || svc.code || '').toUpperCase();
      
      // تحديد حالة الخدمة - أولاً: ابحث في قرارات محرك القواعد
      let status = 'approved'; // افتراضي: مقبول
      let decisionFromRules = false;
      
      // Check Rules Engine decision first (Single Source of Truth)
      const ruleDecision = medicationDecisionMap.get(svcName);
      if (ruleDecision && ruleDecision.decisionSource === 'RULE') {
        decisionFromRules = true;
        if (ruleDecision.decision === 'APPROVED') {
          status = 'approved';
        } else if (ruleDecision.decision === 'REJECTED') {
          status = 'rejected';
        } else {
          status = 'needsDoc';
        }
      } else {
        // Fallback: التكرار: الخدمة الأولى من نوعها = تقييم عادي، المكررة = needsDoc
        const seenCountFallback = seenServices.get(svcKey) || 0;
        if (seenCountFallback > 0 && duplicatedKeys.has(svcKey)) {
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
      }
      
      const currentCount = seenServices.get(svcKey) || 0;
      seenServices.set(svcKey, currentCount + 1);
      
      // تحديث العدادات (حالة واحدة فقط لكل خدمة)
      if (status === 'approved') {
        stats.approvedCount++;
      } else if (status === 'rejected') {
        stats.rejectedCount++;
        caseHasMedicalError = true; // هذه الحالة بها خطأ طبي
      } else {
        stats.needsDocCount++;
        caseHasDocIssue = true; // هذه الحالة بها مشكلة توثيق
      }
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
      const hasBacterialIndication = c.diagnosis?.toLowerCase().includes('bacterial') ||
                                     c.diagnosis?.toLowerCase().includes('بكتيري') ||
                                     c.diagnosis?.toLowerCase().includes('tonsillitis') ||
                                     c.diagnosis?.toLowerCase().includes('pneumonia') ||
                                     c.diagnosis?.toLowerCase().includes('uti');
      if (hasBacterialIndication) {
        stats.antibioticAppropriate++;
      }
    }
    
    // تحديث عدادات مستوى الحالة (للمقياس الثالث: استحقاق المرضى)
    if (caseHasDocIssue) stats.casesWithDocIssues++;
    if (caseHasMedicalError) stats.casesWithMedicalErrors++;
  }

  // نسبة التكرار
  stats.duplicateRate = stats.totalCases > 0 ? (stats.duplicateCases / stats.totalCases) : 0;

  // ========== المقاييس الثلاثة المبسطة ==========
  stats.totalProcedures = stats.approvedCount + stats.rejectedCount + stats.needsDocCount;
  
  // 1. أخطاء التوثيق (على مستوى الإجراء)
  stats.documentationErrors = stats.needsDocCount;
  
  // 2. الأخطاء الطبية (على مستوى الإجراء)
  stats.medicalErrors = stats.rejectedCount;
  
  // 3. استحقاق المرضى: عدد الحالات التي بها مشاكل (أخطاء طبية أو توثيق)
  // المريض "غير مستحق" = لديه خدمة مرفوضة أو تحتاج توثيق
  stats.patientsWithEligibilityGaps = stats.casesWithMedicalErrors + stats.casesWithDocIssues;
  // نتأكد من عدم تجاوز العدد الكلي (قد يكون مريض واحد لديه مشكلتين)
  stats.patientsWithEligibilityGaps = Math.min(stats.patientsWithEligibilityGaps, stats.totalCases);

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
