/**
 * Rules Engine for Drug-Diagnosis Validation
 * This engine applies deterministic rules BEFORE Gemini AI analysis
 * to ensure consistent and accurate medication validation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rulesData = null;

function loadRules() {
  if (rulesData) return rulesData;
  
  try {
    const rulesPath = path.join(__dirname, 'drug-rules.json');
    const rawData = fs.readFileSync(rulesPath, 'utf8');
    rulesData = JSON.parse(rawData);
    console.log(`[Rules Engine] Loaded ${rulesData.rules.length} rules (v${rulesData.version})`);
    return rulesData;
  } catch (error) {
    console.error('[Rules Engine] Failed to load rules:', error.message);
    return { rules: [], drugClasses: {} };
  }
}

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
}

function drugMatchesAlias(drugName, aliases) {
  const normalizedDrug = normalizeString(drugName);
  return aliases.some(alias => {
    const normalizedAlias = normalizeString(alias);
    return normalizedDrug.includes(normalizedAlias) || normalizedAlias.includes(normalizedDrug);
  });
}

function diagnosisMatchesPrefix(diagnoses, prefixes) {
  if (!diagnoses || !prefixes || prefixes.length === 0) return true;
  
  return diagnoses.some(diag => {
    const code = (diag.code || diag || '').toUpperCase().trim();
    return prefixes.some(prefix => code.startsWith(prefix.toUpperCase()));
  });
}

function diagnosisContainsForbidden(diagnoses, forbiddenCodes, forbiddenDescriptions = []) {
  if (!diagnoses) return { found: false };
  
  for (const diag of diagnoses) {
    const code = (diag.code || diag || '').toUpperCase().trim();
    const desc = (diag.description || '').toLowerCase();
    
    for (const forbidden of forbiddenCodes) {
      if (code === forbidden.toUpperCase() || code.startsWith(forbidden.toUpperCase())) {
        return { found: true, code: forbidden, description: desc };
      }
    }
    
    for (const forbiddenDesc of forbiddenDescriptions) {
      if (desc.includes(forbiddenDesc.toLowerCase())) {
        return { found: true, code: code, description: forbiddenDesc };
      }
    }
  }
  
  return { found: false };
}

function checkServiceExists(services, requiredServices) {
  if (!services || !requiredServices || requiredServices.length === 0) return true;
  
  return requiredServices.some(required => {
    const normalizedRequired = normalizeString(required);
    return services.some(service => {
      const normalizedService = normalizeString(service.name || service);
      return normalizedService.includes(normalizedRequired) || normalizedRequired.includes(normalizedService);
    });
  });
}

function countDrugsInClass(medications, drugClass, drugClasses, excludeDrug) {
  const classMembers = drugClasses[drugClass] || [];
  let count = 0;
  
  for (const med of medications) {
    const medName = med.name || med;
    if (normalizeString(medName) === normalizeString(excludeDrug)) continue;
    
    if (drugMatchesAlias(medName, classMembers)) {
      count++;
    }
  }
  
  return count;
}

export function evaluateDrug(drugName, caseData) {
  const rules = loadRules();
  const diagnoses = caseData.diagnoses || [];
  const services = caseData.services || caseData.procedures || [];
  const medications = caseData.medications || [];
  const temperature = parseFloat(caseData.temperature) || null;
  
  const results = {
    drugName: drugName,
    ruleApplied: null,
    decision: null,
    decisionSource: 'AI',
    reason: null,
    reasonEn: null,
    requiresManualReview: false
  };
  
  for (const rule of rules.rules) {
    if (!drugMatchesAlias(drugName, rule.drugAliases || [])) {
      continue;
    }
    
    if (rule.category === 'diagnosis_restricted') {
      continue;
    }
    
    if (rule.forbidIcdCodes && rule.forbidIcdCodes.length > 0) {
      const forbidden = diagnosisContainsForbidden(
        diagnoses, 
        rule.forbidIcdCodes, 
        rule.forbidIcdDescriptions || []
      );
      
      if (forbidden.found) {
        results.ruleApplied = rule.id;
        results.decision = 'REJECTED';
        results.decisionSource = 'RULE';
        results.reason = rule.rejectReason;
        results.reasonEn = rule.rejectReasonEn;
        return results;
      }
    }
    
    if (rule.rejectIfOtherDrugClass) {
      const otherCount = countDrugsInClass(
        medications, 
        rule.rejectIfOtherDrugClass, 
        rules.drugClasses, 
        drugName
      );
      
      if (otherCount > 0) {
        results.ruleApplied = rule.id;
        results.decision = 'REJECTED';
        results.decisionSource = 'RULE';
        results.reason = rule.rejectReason;
        results.reasonEn = rule.rejectReasonEn;
        return results;
      }
    }
    
    if (rule.requireServices && rule.requireServices.length > 0) {
      const hasService = checkServiceExists(services, rule.requireServices);
      
      if (!hasService) {
        results.ruleApplied = rule.id;
        results.decision = 'REJECTED';
        results.decisionSource = 'RULE';
        results.reason = rule.rejectReason;
        results.reasonEn = rule.rejectReasonEn;
        return results;
      }
      
      if (rule.manualReviewIfServicePresent && hasService) {
        results.ruleApplied = rule.id;
        results.decision = 'MANUAL_REVIEW';
        results.decisionSource = 'RULE';
        results.reason = 'يحتاج مراجعة يدوية للتحقق من نتيجة الفحص';
        results.reasonEn = 'Requires Manual Review: Check lab result';
        results.requiresManualReview = true;
        return results;
      }
    }
    
    if (rule.requireIcdPrefixes && rule.requireIcdPrefixes.length > 0) {
      const hasRequiredDiagnosis = diagnosisMatchesPrefix(diagnoses, rule.requireIcdPrefixes);
      
      if (!hasRequiredDiagnosis) {
        results.ruleApplied = rule.id;
        results.decision = 'REJECTED';
        results.decisionSource = 'RULE';
        results.reason = rule.rejectReason;
        results.reasonEn = rule.rejectReasonEn;
        return results;
      } else {
        results.ruleApplied = rule.id;
        results.decision = 'APPROVED';
        results.decisionSource = 'RULE';
        results.reason = rule.approveReason;
        return results;
      }
    }
  }
  
  for (const rule of rules.rules) {
    if (rule.category !== 'diagnosis_restricted') continue;
    
    const diagCode = rule.diagnosisCode;
    const hasDiagnosis = diagnoses.some(d => {
      const code = (d.code || d || '').toUpperCase();
      return code === diagCode || code.startsWith(diagCode);
    });
    
    if (hasDiagnosis) {
      const isAllowed = drugMatchesAlias(drugName, rule.allowedDrugs || []);
      
      if (!isAllowed) {
        results.ruleApplied = rule.id;
        results.decision = 'REJECTED';
        results.decisionSource = 'RULE';
        results.reason = rule.rejectReason;
        results.reasonEn = rule.rejectReasonEn;
        return results;
      }
    }
  }
  
  return results;
}

export function evaluateCase(caseData) {
  const medications = caseData.medications || [];
  const results = {
    caseId: caseData.claimNo || caseData.id,
    patientId: caseData.patientId,
    medicationResults: [],
    hasRuleBasedDecisions: false,
    hasManualReviewItems: false,
    summary: {
      approved: 0,
      rejected: 0,
      manualReview: 0,
      aiPending: 0
    }
  };
  
  for (const med of medications) {
    const drugName = med.name || med;
    const evaluation = evaluateDrug(drugName, caseData);
    
    results.medicationResults.push({
      ...evaluation,
      originalMed: med
    });
    
    if (evaluation.decisionSource === 'RULE') {
      results.hasRuleBasedDecisions = true;
    }
    
    if (evaluation.decision === 'APPROVED') {
      results.summary.approved++;
    } else if (evaluation.decision === 'REJECTED') {
      results.summary.rejected++;
    } else if (evaluation.decision === 'MANUAL_REVIEW') {
      results.summary.manualReview++;
      results.hasManualReviewItems = true;
    } else {
      results.summary.aiPending++;
    }
  }
  
  return results;
}

export function getDrugClass(drugName) {
  const rules = loadRules();
  
  for (const [className, members] of Object.entries(rules.drugClasses)) {
    if (drugMatchesAlias(drugName, members)) {
      return className;
    }
  }
  
  return null;
}

export function getRulesVersion() {
  const rules = loadRules();
  return {
    version: rules.version,
    lastUpdated: rules.lastUpdated,
    totalRules: rules.rules.length
  };
}

export default {
  evaluateDrug,
  evaluateCase,
  getDrugClass,
  getRulesVersion,
  loadRules
};
