// /api/required-tests.js
// نظام كشف الفحوصات المطلوبة طبياً - من حق المريض
// Required Medical Tests Detection System - Patient Rights

// ============================================
// قواعد الفحوصات المطلوبة حسب التشخيص والتخصص
// ============================================

const DIABETIC_EYE_REQUIREMENTS = {
  conditions: ['E10', 'E11', 'E13', 'E14', 'diabetes', 'سكر', 'سكري'],
  requiredTests: [
    {
      code: 'fundoscopy',
      names: ['fundoscopy', 'fundus', 'قاع العين', 'فحص الشبكية', 'retinal exam', 'ophthalmoscopy'],
      priority: 'essential',
      reason: 'فحص قاع العين إلزامي لمرضى السكري لاكتشاف اعتلال الشبكية مبكراً',
      reference: 'American Diabetes Association Standards of Care 2024',
      frequency: 'سنوياً على الأقل، أو كل 6 أشهر إذا كان هناك اعتلال'
    },
    {
      code: 'iop',
      names: ['iop', 'intraocular pressure', 'ضغط العين', 'tonometry', 'glaucoma screening'],
      priority: 'essential',
      reason: 'قياس ضغط العين ضروري لأن مرضى السكري أكثر عرضة للجلوكوما',
      reference: 'AAO Diabetic Eye Disease Guidelines',
      frequency: 'سنوياً'
    },
    {
      code: 'oct',
      names: ['oct', 'optical coherence tomography', 'تصوير مقطعي للشبكية'],
      priority: 'recommended',
      reason: 'OCT يكشف الوذمة البقعية السكرية التي قد لا تظهر بالفحص العادي',
      reference: 'ETDRS Guidelines, AAO Retina Panel',
      frequency: 'عند الاشتباه بوذمة بقعية أو سنوياً للحالات المتقدمة'
    },
    {
      code: 'visual_acuity',
      names: ['visual acuity', 'حدة البصر', 'snellen', 'vision test'],
      priority: 'essential',
      reason: 'تقييم حدة البصر أساسي لمتابعة تأثير السكري على الرؤية',
      reference: 'Standard Ophthalmologic Examination',
      frequency: 'كل زيارة'
    }
  ]
};

const DIABETIC_GENERAL_REQUIREMENTS = {
  conditions: ['E10', 'E11', 'E13', 'E14', 'diabetes', 'سكر', 'سكري'],
  requiredTests: [
    {
      code: 'hba1c',
      names: ['hba1c', 'glycated hemoglobin', 'السكر التراكمي', 'a1c', 'hemoglobin a1c'],
      priority: 'essential',
      reason: 'السكر التراكمي HbA1c يجب قياسه كل 3-6 أشهر لمتابعة السيطرة على السكر',
      reference: 'ADA Standards of Medical Care in Diabetes 2024',
      frequency: 'كل 3 أشهر إذا غير مستقر، كل 6 أشهر إذا مستقر'
    },
    {
      code: 'kidney_function',
      names: ['creatinine', 'bun', 'egfr', 'kft', 'kidney function', 'وظائف الكلى', 'uacr', 'albumin creatinine ratio'],
      priority: 'essential',
      reason: 'فحص وظائف الكلى ضروري لاكتشاف اعتلال الكلى السكري مبكراً',
      reference: 'KDIGO Diabetes and CKD Guidelines',
      frequency: 'سنوياً على الأقل'
    },
    {
      code: 'lipid_profile',
      names: ['lipid', 'cholesterol', 'ldl', 'hdl', 'triglycerides', 'الدهون', 'كولسترول'],
      priority: 'essential',
      reason: 'مرضى السكري لديهم خطر عالي لأمراض القلب، يجب متابعة الدهون',
      reference: 'ADA Cardiovascular Disease and Risk Management',
      frequency: 'سنوياً'
    },
    {
      code: 'foot_exam',
      names: ['foot exam', 'فحص القدم', 'monofilament', 'diabetic foot'],
      priority: 'essential',
      reason: 'فحص القدم السكرية يمنع البتر والمضاعفات الخطيرة',
      reference: 'IWGDF Diabetic Foot Guidelines',
      frequency: 'كل زيارة'
    }
  ]
};

const PREGNANCY_REQUIREMENTS = {
  conditions: ['Z34', 'O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O9A', 'pregnancy', 'pregnant', 'حمل', 'حامل', 'prenatal', 'antenatal', 'obstetric', 'gravida', 'gestation'],
  requiredTests: [
    {
      code: 'ultrasound',
      names: ['ultrasound', 'u/s', 'سونار', 'sono', 'obstetric ultrasound'],
      priority: 'essential',
      reason: 'السونار ضروري لتحديد عمر الحمل ومتابعة نمو الجنين',
      reference: 'ACOG Ultrasound Guidelines',
      frequency: 'الأسبوع 11-14، 18-22، والثلث الثالث'
    },
    {
      code: 'cbc',
      names: ['cbc', 'complete blood count', 'صورة دم', 'hemoglobin'],
      priority: 'essential',
      reason: 'فحص الدم لاكتشاف فقر الدم الشائع في الحمل',
      reference: 'WHO Antenatal Care Guidelines',
      frequency: 'أول زيارة وكل ثلث'
    },
    {
      code: 'blood_group',
      names: ['blood group', 'rh', 'فصيلة الدم', 'blood type', 'abo'],
      priority: 'essential',
      reason: 'تحديد فصيلة الدم وRh لمنع مشاكل عدم التوافق',
      reference: 'ACOG Rh Immunization Guidelines',
      frequency: 'أول زيارة'
    },
    {
      code: 'gct_gtt',
      names: ['glucose challenge', 'gct', 'gtt', 'ogtt', 'سكر الحمل', 'gestational diabetes'],
      priority: 'essential',
      reason: 'فحص سكر الحمل إلزامي لاكتشاف سكري الحمل',
      reference: 'IADPSG/ADA Gestational Diabetes Guidelines',
      frequency: 'الأسبوع 24-28'
    },
    {
      code: 'urine_analysis',
      names: ['urine', 'urinalysis', 'بول', 'urine analysis'],
      priority: 'essential',
      reason: 'فحص البول لاكتشاف التهابات المسالك والبروتين',
      reference: 'NICE Antenatal Care Guidelines',
      frequency: 'كل زيارة'
    },
    {
      code: 'iron_ferritin',
      names: ['iron', 'ferritin', 'حديد', 'serum iron', 'tibc'],
      priority: 'recommended',
      reason: 'فحص الحديد لعلاج فقر الدم بالحديد',
      reference: 'WHO Iron Supplementation Guidelines',
      frequency: 'أول زيارة وعند انخفاض الهيموجلوبين'
    }
  ]
};

const ORTHOPEDIC_REQUIREMENTS = {
  conditions: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'T0', 'T1', 'T2', 'M0', 'M1', 'M2', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'fracture', 'كسر', 'كسور', 'trauma', 'dislocation', 'خلع', 'sprain', 'التواء'],
  requiredTests: [
    {
      code: 'xray',
      names: ['x-ray', 'xray', 'أشعة', 'radiograph', 'plain film'],
      priority: 'essential',
      reason: 'الأشعة ضرورية لتشخيص الكسور وأمراض العظام',
      reference: 'ACR Appropriateness Criteria',
      frequency: 'عند الإصابة ومتابعة الالتئام'
    },
    {
      code: 'neuro_exam',
      names: ['neurological exam', 'فحص عصبي', 'sensation', 'motor', 'reflex'],
      priority: 'essential',
      reason: 'الفحص العصبي ضروري لاستبعاد إصابة الأعصاب',
      reference: 'AAOS Trauma Guidelines',
      frequency: 'عند كل إصابة'
    },
    {
      code: 'mri',
      names: ['mri', 'magnetic resonance', 'رنين مغناطيسي'],
      priority: 'conditional',
      reason: 'MRI عند الاشتباه بإصابة الأربطة أو الغضاريف',
      reference: 'ACR MRI Appropriateness Criteria',
      frequency: 'حسب الحاجة السريرية'
    }
  ]
};

const HYPERTENSION_REQUIREMENTS = {
  conditions: ['I10', 'I11', 'I12', 'I13', 'hypertension', 'ضغط', 'ارتفاع ضغط'],
  requiredTests: [
    {
      code: 'kidney_function',
      names: ['creatinine', 'bun', 'egfr', 'kft', 'kidney function', 'وظائف الكلى'],
      priority: 'essential',
      reason: 'فحص وظائف الكلى لاكتشاف تأثير الضغط على الكلى',
      reference: 'JNC 8 Hypertension Guidelines',
      frequency: 'سنوياً'
    },
    {
      code: 'ecg',
      names: ['ecg', 'ekg', 'electrocardiogram', 'تخطيط قلب', 'رسم قلب'],
      priority: 'essential',
      reason: 'تخطيط القلب لاكتشاف تضخم البطين الأيسر',
      reference: 'ESC Hypertension Guidelines',
      frequency: 'سنوياً'
    },
    {
      code: 'lipid_profile',
      names: ['lipid', 'cholesterol', 'ldl', 'hdl', 'الدهون', 'كولسترول'],
      priority: 'essential',
      reason: 'فحص الدهون لتقييم خطر أمراض القلب',
      reference: 'ACC/AHA Cardiovascular Risk Guidelines',
      frequency: 'سنوياً'
    }
  ]
};

// جميع القواعد
const ALL_REQUIREMENTS = [
  { id: 'diabetic_eye', name: 'مريض سكري عند طبيب العيون', ...DIABETIC_EYE_REQUIREMENTS },
  { id: 'diabetic_general', name: 'مريض سكري - فحوصات عامة', ...DIABETIC_GENERAL_REQUIREMENTS },
  { id: 'pregnancy', name: 'متابعة الحمل', ...PREGNANCY_REQUIREMENTS },
  { id: 'orthopedic', name: 'إصابات العظام', ...ORTHOPEDIC_REQUIREMENTS },
  { id: 'hypertension', name: 'ارتفاع ضغط الدم', ...HYPERTENSION_REQUIREMENTS }
];

/**
 * ينظف ويوحد النص للمطابقة (عربي + إنجليزي)
 */
function normalizeTextForMatching(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\u0600-\u06FF]/g, match => match) // Keep Arabic as-is
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * يتحقق إذا كان التشخيص يطابق شرط معين
 * يدعم: ICD codes (E10, E11), English keywords, Arabic keywords
 */
function matchesCondition(icdCode, diagnosis, conditions) {
  const icdNormalized = normalizeTextForMatching(icdCode);
  const diagNormalized = normalizeTextForMatching(diagnosis);
  const combinedText = `${icdNormalized} ${diagNormalized}`;
  
  for (const condition of conditions) {
    if (typeof condition === 'string') {
      const condLower = condition.toLowerCase();
      
      // تحقق من كود ICD (E10, E11, etc.)
      if (icdNormalized.includes(condLower)) {
        return true;
      }
      
      // تحقق من نص التشخيص (English and Arabic)
      if (diagNormalized.includes(condLower)) {
        return true;
      }
      
      // تحقق من النص المجمع
      if (combinedText.includes(condLower)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * يتحقق إذا كان الفحص موجود في قائمة الإجراءات
 */
function hasTest(procedures, testNames) {
  if (!procedures || !Array.isArray(procedures)) return false;
  
  const procNames = procedures.map(p => {
    const name = typeof p === 'string' ? p : (p.name || p.code || '');
    return name.toLowerCase();
  });
  
  for (const testName of testNames) {
    for (const procName of procNames) {
      if (procName.includes(testName.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * يكتشف الفحوصات المطلوبة الناقصة لحالة معينة
 */
export function detectMissingRequiredTests(caseData) {
  const missingTests = [];
  const icdCode = caseData.icdCode || '';
  const diagnosis = caseData.diagnosis || '';
  const procedures = caseData.procedures || [];
  
  for (const requirement of ALL_REQUIREMENTS) {
    // تحقق إذا كانت الحالة تنطبق عليها هذه القاعدة
    if (!matchesCondition(icdCode, diagnosis, requirement.conditions)) {
      continue;
    }
    
    // تحقق من كل فحص مطلوب
    for (const test of requirement.requiredTests) {
      if (!hasTest(procedures, test.names)) {
        missingTests.push({
          category: requirement.name,
          testCode: test.code,
          testName: test.names[0],
          priority: test.priority,
          reason: test.reason,
          reference: test.reference,
          frequency: test.frequency,
          message: formatMissingTestMessage(test, requirement.name)
        });
      }
    }
  }
  
  return missingTests;
}

/**
 * يُنسق رسالة الفحص الناقص
 */
function formatMissingTestMessage(test, categoryName) {
  const priorityIcon = test.priority === 'essential' ? '🔴' : test.priority === 'recommended' ? '🟡' : '🔵';
  const priorityText = test.priority === 'essential' ? 'إلزامي' : test.priority === 'recommended' ? 'موصى به' : 'حسب الحالة';
  
  return `${priorityIcon} من حق المريض: ${test.names[0].toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━
📋 السبب الطبي: ${test.reason}
⏰ التكرار المطلوب: ${test.frequency}
📚 المرجع: ${test.reference}
🏷️ الأهمية: ${priorityText}`;
}

/**
 * يُنشئ قسم الفحوصات الناقصة للتقرير
 */
export function generateMissingTestsSection(missingTests, lang = 'ar') {
  if (!missingTests || missingTests.length === 0) {
    return null;
  }
  
  const essential = missingTests.filter(t => t.priority === 'essential');
  const recommended = missingTests.filter(t => t.priority === 'recommended');
  const conditional = missingTests.filter(t => t.priority === 'conditional');
  
  let section = '';
  
  if (lang === 'ar') {
    section += '\n\n📋 فحوصات من حق المريض (ناقصة)\n';
    section += '═══════════════════════════════════════\n';
    
    if (essential.length > 0) {
      section += '\n🔴 فحوصات إلزامية:\n';
      essential.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
        section += `  ⏰ ${test.frequency}\n`;
        section += `  📚 ${test.reference}\n`;
      });
    }
    
    if (recommended.length > 0) {
      section += '\n🟡 فحوصات موصى بها:\n';
      recommended.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
      });
    }
    
    if (conditional.length > 0) {
      section += '\n🔵 فحوصات مشروطة (حسب الحالة):\n';
      conditional.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
        section += `  ⚕️ يُطلب حسب شدة الحالة أو مؤشرات سريرية\n`;
      });
    }
  } else {
    section += '\n\n📋 Patient Rights: Missing Required Tests\n';
    section += '═══════════════════════════════════════\n';
    
    if (essential.length > 0) {
      section += '\n🔴 Essential Tests:\n';
      essential.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
        section += `  📚 ${test.reference}\n`;
      });
    }
    
    if (recommended.length > 0) {
      section += '\n🟡 Recommended Tests:\n';
      recommended.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
      });
    }
    
    if (conditional.length > 0) {
      section += '\n🔵 Conditional Tests (Case Dependent):\n';
      conditional.forEach(test => {
        section += `\n• ${test.testName.toUpperCase()}\n`;
        section += `  📋 ${test.reason}\n`;
        section += `  ⚕️ Required based on clinical severity or indicators\n`;
      });
    }
  }
  
  return section;
}

/**
 * يُنشئ HTML للفحوصات الناقصة
 * ملاحظة: لا نستخدم emojis مثل ✅ ❌ ⚠️ لتجنب تأثيرها على إحصائيات التقرير
 */
export function generateMissingTestsHTML(missingTests, lang = 'ar') {
  if (!missingTests || missingTests.length === 0) {
    return '';
  }
  
  const essential = missingTests.filter(t => t.priority === 'essential');
  const recommended = missingTests.filter(t => t.priority === 'recommended');
  const conditional = missingTests.filter(t => t.priority === 'conditional');
  
  let html = `
    <div class="missing-tests-section" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 16px; margin-top: 16px; border-right: 5px solid #f59e0b;">
      <h4 style="color: #92400e; margin: 0 0 12px 0; font-size: 16px;">
        <span style="font-size:18px;">📋</span> ${lang === 'ar' ? 'فحوصات من حق المريض (ناقصة)' : 'Patient Rights: Missing Required Tests'}
      </h4>
  `;
  
  if (essential.length > 0) {
    html += `<div style="margin-bottom: 12px;">
      <h5 style="color: #dc2626; margin: 0 0 8px 0;"><span style="color:#dc2626;font-size:14px;">●</span> ${lang === 'ar' ? 'فحوصات إلزامية' : 'Essential Tests'}</h5>`;
    
    essential.forEach(test => {
      html += `
        <div style="background: #fef2f2; border-radius: 8px; padding: 12px; margin-bottom: 8px; border-right: 3px solid #dc2626;">
          <div style="font-weight: bold; color: #991b1b; margin-bottom: 4px;">${test.testName.toUpperCase()}</div>
          <div style="font-size: 13px; color: #7f1d1d; margin-bottom: 4px;">السبب: ${test.reason}</div>
          <div style="font-size: 12px; color: #991b1b;">التكرار: ${test.frequency}</div>
          <div style="font-size: 11px; color: #b91c1c; font-style: italic;">المرجع: ${test.reference}</div>
        </div>
      `;
    });
    html += '</div>';
  }
  
  if (recommended.length > 0) {
    html += `<div>
      <h5 style="color: #d97706; margin: 0 0 8px 0;"><span style="color:#d97706;font-size:14px;">●</span> ${lang === 'ar' ? 'فحوصات موصى بها' : 'Recommended Tests'}</h5>`;
    
    recommended.forEach(test => {
      html += `
        <div style="background: #fffbeb; border-radius: 8px; padding: 10px; margin-bottom: 6px; border-right: 3px solid #f59e0b;">
          <div style="font-weight: bold; color: #92400e;">${test.testName.toUpperCase()}</div>
          <div style="font-size: 12px; color: #78350f;">السبب: ${test.reason}</div>
        </div>
      `;
    });
    html += '</div>';
  }
  
  if (conditional.length > 0) {
    html += `<div style="margin-top: 12px;">
      <h5 style="color: #6366f1; margin: 0 0 8px 0;"><span style="color:#6366f1;font-size:14px;">●</span> ${lang === 'ar' ? 'فحوصات مشروطة (حسب الحالة)' : 'Conditional Tests (Case Dependent)'}</h5>`;
    
    conditional.forEach(test => {
      html += `
        <div style="background: #eef2ff; border-radius: 8px; padding: 10px; margin-bottom: 6px; border-right: 3px solid #6366f1;">
          <div style="font-weight: bold; color: #4338ca;">${test.testName.toUpperCase()}</div>
          <div style="font-size: 12px; color: #3730a3;">السبب: ${test.reason}</div>
          <div style="font-size: 11px; color: #4f46e5; font-style: italic;">ملاحظة: يُطلب حسب شدة الحالة أو مؤشرات سريرية</div>
        </div>
      `;
    });
    html += '</div>';
  }
  
  html += '</div>';
  return html;
}

export { ALL_REQUIREMENTS };
