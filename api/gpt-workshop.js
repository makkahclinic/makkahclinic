import json
import pandas as pd
from datetime import datetime
import re
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import logging

@dataclass
class PatientInfo:
    name: str
    id_number: str
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    nationality: Optional[str] = None

@dataclass 
class MedicalVisit:
    date: str
    doctor: str
    diagnosis_code: str
    diagnosis_description: str
    medications: List[str]
    procedures: List[str]
    cost: float
    visit_type: str

class MedicalFileAnalyzer:
    def __init__(self):
        self.setup_logging()
        self.medical_guidelines = self._load_medical_guidelines()
        self.medication_database = self._load_medication_database()
        
    def setup_logging(self):
        """إعداد نظام السجلات لتتبع الأخطاء"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)
    
    def _load_medical_guidelines(self) -> Dict:
        """تحميل الإرشادات الطبية المحدثة"""
        return {
            'throat_infections': {
                'codes': ['J02', 'J03', 'J06'],
                'first_line_treatment': 'Penicillin/Amoxicillin',
                'avoid': ['IV_antibiotics_outpatient', 'broad_spectrum_unnecessary'],
                'required_assessment': ['FeverPAIN_score', 'Centor_criteria']
            },
            'back_pain': {
                'codes': ['M54.5', 'M54.9'],
                'avoid_routine_imaging': True,
                'red_flags': ['neurological_deficit', 'fever', 'trauma', 'bladder_dysfunction'],
                'first_line': ['NSAIDs', 'physiotherapy', 'patient_education']
            },
            'hypertension': {
                'codes': ['I10', 'I15'],
                'required_workup': ['ABPM', 'HBPM', 'baseline_investigations'],
                'baseline_tests': ['FBC', 'U&E', 'LFTs', 'ECG', 'urinalysis']
            },
            'renal_colic': {
                'codes': ['N23', 'N20'],
                'imaging_required': 'CT_KUB_within_24h',
                'first_line_analgesia': 'NSAIDs',
                'required_tests': ['urinalysis', 'FBC', 'U&E']
            }
        }
    
    def _load_medication_database(self) -> Dict:
        """قاعدة بيانات الأدوية والأكواد الصحيحة"""
        return {
            'incorrect_codes': {
                'Meva': {'correct': 'Mebeverine 135mg', 'code': 'A03AA04'},
                'Rofenac': {'correct': 'Diclofenac 50mg', 'code': 'M01AB05'},
                'Neurovit': {'correct': 'Vitamin B Complex', 'code': 'A11EA'},
                'Diclomax': {'correct': 'Diclofenac Gel 1%', 'code': 'M02AA15'},
                'Diva-D': {'correct': 'Vitamin D3', 'code': 'A11CC05'}
            },
            'antibiotic_classes': {
                'broad_spectrum': ['Azithromycin', 'Ceftriaxone', 'Amoxiclav', 'Cefixime'],
                'narrow_spectrum': ['Penicillin', 'Amoxicillin', 'Erythromycin']
            }
        }
    
    def analyze_medical_file(self, file_content: str) -> Dict[str, Any]:
        """التحليل الرئيسي للملف الطبي مع معالجة الأخطاء"""
        
        try:
            self.logger.info("بدء تحليل الملف الطبي...")
            
            # استخراج البيانات الأساسية
            patient_info = self._extract_patient_info(file_content)
            visits = self._extract_visits(file_content)
            
            # التحليل المتقدم
            analysis_results = {
                'patient_summary': self._create_patient_summary(patient_info),
                'visits_analysis': self._analyze_visits(visits),
                'clinical_issues': self._identify_clinical_issues(visits),
                'medication_analysis': self._analyze_medications(visits),
                'financial_impact': self._calculate_financial_impact(visits),
                'quality_indicators': self._assess_quality_indicators(visits),
                'recommendations': self._generate_recommendations(visits)
            }
            
            # تنسيق التقرير النهائي
            final_report = self._format_comprehensive_report(analysis_results)
            
            self.logger.info("تم إكمال التحليل بنجاح")
            return final_report
            
        except Exception as e:
            self.logger.error(f"خطأ في التحليل: {str(e)}")
            return self._create_error_report(str(e))
    
    def _extract_patient_info(self, content: str) -> PatientInfo:
        """استخراج معلومات المريض الأساسية"""
        
        try:
            # البحث عن اسم المريض
            name_patterns = [
                r'اسم المريض[:\s]+([^\n]+)',
                r'المريض[:\s]+([^\n]+)',
                r'Patient[:\s]+([^\n]+)'
            ]
            
            name = "غير محدد"
            for pattern in name_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    name = match.group(1).strip()
                    break
            
            # البحث عن رقم الهوية
            id_patterns = [
                r'رقم الهوية[:\s]+(\d+)',
                r'ID[:\s]+(\d+)',
                r'الهوية[:\s]+(\d+)'
            ]
            
            id_number = "غير محدد"
            for pattern in id_patterns:
                match = re.search(pattern, content)
                if match:
                    id_number = match.group(1)
                    break
            
            return PatientInfo(
                name=name,
                id_number=id_number
            )
            
        except Exception as e:
            self.logger.error(f"خطأ في استخراج معلومات المريض: {e}")
            return PatientInfo(name="خطأ في الاستخراج", id_number="خطأ")
    
    def _extract_visits(self, content: str) -> List[MedicalVisit]:
        """استخراج تفاصيل الزيارات الطبية"""
        
        visits = []
        try:
            # تقسيم المحتوى حسب التواريخ
            date_pattern = r'(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})'
            date_matches = re.finditer(date_pattern, content)
            
            sections = []
            last_pos = 0
            
            for match in date_matches:
                if last_pos > 0:
                    sections.append(content[last_pos:match.start()])
                last_pos = match.start()
            
            if last_pos < len(content):
                sections.append(content[last_pos:])
            
            # تحليل كل قسم
            for i, section in enumerate(sections):
                visit = self._parse_visit_section(section)
                if visit:
                    visits.append(visit)
            
            return visits
            
        except Exception as e:
            self.logger.error(f"خطأ في استخراج الزيارات: {e}")
            return []
    
    def _parse_visit_section(self, section: str) -> Optional[MedicalVisit]:
        """تحليل قسم زيارة واحدة"""
        
        try:
            # استخراج التاريخ
            date_match = re.search(r'(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})', section)
            visit_date = date_match.group(1) if date_match else "غير محدد"
            
            # استخراج اسم الطبيب
            doctor_patterns = [
                r'Dr\.?\s+([A-Za-z\s]+)',
                r'الطبيب[:\s]+([^\n]+)'
            ]
            doctor = "غير محدد"
            for pattern in doctor_patterns:
                match = re.search(pattern, section)
                if match:
                    doctor = match.group(1).strip()
                    break
            
            # استخراج كود التشخيص
            diagnosis_match = re.search(r'([A-Z]\d{2}\.?\d?)', section)
            diagnosis_code = diagnosis_match.group(1) if diagnosis_match else "غير محدد"
            
            # استخراج الأدوية
            medication_patterns = [
                r'([A-Za-z]+(?:\s*-?\s*[A-Za-z0-9]+)*)\s*(?:\+|$)',
                r'([A-Z][a-z]+(?:[A-Z][a-z]*)*)'
            ]
            medications = []
            for pattern in medication_patterns:
                meds = re.findall(pattern, section)
                medications.extend([med.strip() for med in meds if len(med.strip()) > 2])
            
            # استخراج التكلفة
            cost_match = re.search(r'(\d+\.?\d*)\s*ريال', section)
            cost = float(cost_match.group(1)) if cost_match else 0.0
            
            return MedicalVisit(
                date=visit_date,
                doctor=doctor,
                diagnosis_code=diagnosis_code,
                diagnosis_description=self._get_diagnosis_description(diagnosis_code),
                medications=list(set(medications)),  # إزالة التكرارات
                procedures=[],
                cost=cost,
                visit_type="عيادة خارجية"
            )
            
        except Exception as e:
            self.logger.error(f"خطأ في تحليل قسم الزيارة: {e}")
            return None
    
    def _identify_clinical_issues(self, visits: List[MedicalVisit]) -> Dict[str, Any]:
        """تحديد المشاكل السريرية"""
        
        issues = {
            'antibiotic_overuse': [],
            'inappropriate_prescriptions': [],
            'missing_documentation': [],
            'guideline_violations': []
        }
        
        try:
            # تحليل استخدام المضادات الحيوية
            same_day_visits = self._group_visits_by_date(visits)
            
            for date, day_visits in same_day_visits.items():
                if len(day_visits) > 1:
                    antibiotics_count = 0
                    antibiotics_used = []
                    
                    for visit in day_visits:
                        for med in visit.medications:
                            if self._is_antibiotic(med):
                                antibiotics_count += 1
                                antibiotics_used.append(med)
                    
                    if antibiotics_count > 1:
                        issues['antibiotic_overuse'].append({
                            'date': date,
                            'count': antibiotics_count,
                            'antibiotics': antibiotics_used,
                            'severity': 'critical' if antibiotics_count > 3 else 'high'
                        })
            
            # تحديد الأدوية ذات الأكواد الخاطئة
            for visit in visits:
                for med in visit.medications:
                    if med in self.medication_database['incorrect_codes']:
                        issues['inappropriate_prescriptions'].append({
                            'date': visit.date,
                            'wrong_medication': med,
                            'correct_medication': self.medication_database['incorrect_codes'][med]['correct'],
                            'impact': 'financial_rejection'
                        })
            
            return issues
            
        except Exception as e:
            self.logger.error(f"خطأ في تحديد المشاكل السريرية: {e}")
            return issues
    
    def _calculate_financial_impact(self, visits: List[MedicalVisit]) -> Dict[str, float]:
        """حساب التأثير المالي"""
        
        try:
            total_cost = sum(visit.cost for visit in visits)
            rejected_amount = 0
            potential_additional = 0
            
            # حساب المبالغ المرفوضة بسبب الأخطاء
            for visit in visits:
                for med in visit.medications:
                    if med in self.medication_database['incorrect_codes']:
                        rejected_amount += visit.cost * 0.3  # افتراض رفض 30% من التكلفة
            
            # حساب الإيرادات الإضافية المحتملة
            missing_procedures = self._identify_missing_procedures(visits)
            potential_additional = len(missing_procedures) * 150  # متوسط تكلفة الإجراء
            
            return {
                'total_revenue': total_cost,
                'rejected_amount': rejected_amount,
                'loss_percentage': (rejected_amount / total_cost * 100) if total_cost > 0 else 0,
                'potential_additional': potential_additional,
                'net_impact': total_cost - rejected_amount + potential_additional
            }
            
        except Exception as e:
            self.logger.error(f"خطأ في حساب التأثير المالي: {e}")
            return {'error': str(e)}
    
    def _format_comprehensive_report(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """تنسيق التقرير الشامل"""
        
        try:
            report = {
                'status': 'success',
                'timestamp': datetime.now().isoformat(),
                'patient_info': analysis.get('patient_summary', {}),
                'summary_statistics': {
                    'total_visits': len(analysis.get('visits_analysis', [])),
                    'total_medications': sum(len(visit.get('medications', [])) for visit in analysis.get('visits_analysis', [])),
                    'financial_impact': analysis.get('financial_impact', {}),
                    'critical_issues': len(analysis.get('clinical_issues', {}).get('antibiotic_overuse', []))
                },
                'detailed_analysis': analysis,
                'recommendations': analysis.get('recommendations', []),
                'risk_score': self._calculate_risk_score(analysis)
            }
            
            return report
            
        except Exception as e:
            self.logger.error(f"خطأ في تنسيق التقرير: {e}")
            return self._create_error_report(str(e))
    
    def _create_error_report(self, error_message: str) -> Dict[str, Any]:
        """إنشاء تقرير خطأ"""
        return {
            'status': 'error',
            'timestamp': datetime.now().isoformat(),
            'error_message': error_message,
            'recommendations': [
                'تحقق من صحة البيانات المدخلة',
                'تأكد من تنسيق الملف',
                'راجع سجل الأخطاء للمزيد من التفاصيل'
            ]
        }
    
    # دوال مساعدة
    def _group_visits_by_date(self, visits: List[MedicalVisit]) -> Dict[str, List[MedicalVisit]]:
        grouped = {}
        for visit in visits:
            if visit.date not in grouped:
                grouped[visit.date] = []
            grouped[visit.date].append(visit)
        return grouped
    
    def _is_antibiotic(self, medication: str) -> bool:
        antibiotic_keywords = ['mycin', 'cillin', 'cef', 'clav', 'dox', 'floxacin']
        return any(keyword in medication.lower() for keyword in antibiotic_keywords)
    
    def _get_diagnosis_description(self, code: str) -> str:
        descriptions = {
            'J02': 'التهاب البلعوم الحاد',
            'J03': 'التهاب اللوزتين الحاد', 
            'M54.5': 'ألم أسفل الظهر',
            'I10': 'ارتفاع ضغط الدم الأساسي',
            'N23': 'مغص كلوي غير محدد'
        }
        return descriptions.get(code, 'تشخيص غير محدد')
    
    def _identify_missing_procedures(self, visits: List[MedicalVisit]) -> List[str]:
        # تحديد الإجراءات المفقودة بناءً على التشخيص
        missing = []
        for visit in visits:
            if visit.diagnosis_code == 'I10' and not any('ECG' in str(visit.procedures) for visit in visits):
                missing.append('ECG')
            if visit.diagnosis_code == 'N23' and not any('CT' in str(visit.procedures) for visit in visits):
                missing.append('CT KUB')
        return missing
    
    def _calculate_risk_score(self, analysis: Dict) -> int:
        score = 0
        clinical_issues = analysis.get('clinical_issues', {})
        score += len(clinical_issues.get('antibiotic_overuse', [])) * 20
        score += len(clinical_issues.get('inappropriate_prescriptions', [])) * 10
        return min(score, 100)

# استخدام الكود المحسن
def analyze_medical_case(file_content: str) -> Dict[str, Any]:
    """دالة رئيسية لتحليل الحالة الطبية"""
    
    try:
        analyzer = MedicalFileAnalyzer()
        result = analyzer.analyze_medical_file(file_content)
        return result
        
    except Exception as e:
        return {
            'status': 'error',
            'error': f'فشل في
