import json
import pandas as pd
from datetime import datetime, timedelta
import re
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import logging
from collections import defaultdict, Counter
import warnings
warnings.filterwarnings('ignore')

@dataclass
class PatientInfo:
    name: str
    id_number: str
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    nationality: Optional[str] = None
    insurance_type: Optional[str] = None
    phone: Optional[str] = None

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
    visit_reason: Optional[str] = None
    lab_results: List[str] = None
    imaging: List[str] = None

class AdvancedMedicalAnalyzer:
    def __init__(self):
        self.setup_logging()
        self.medical_guidelines = self._load_comprehensive_guidelines()
        self.medication_database = self._load_enhanced_medication_db()
        self.diagnosis_codes = self._load_diagnosis_codes()
        self.cost_benchmarks = self._load_cost_benchmarks()
        
    def setup_logging(self):
        """إعداد نظام السجلات المتقدم"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(),
                logging.FileHandler('medical_analysis.log', encoding='utf-8')
            ]
        )
        self.logger = logging.getLogger('MedicalAnalyzer')
    
    def _load_comprehensive_guidelines(self) -> Dict:
        """تحميل الإرشادات الطبية الشاملة"""
        return {
            'respiratory_infections': {
                'codes': ['J02', 'J03', 'J06', 'J00', 'J01', 'J04'],
                'first_line_antibiotics': ['Penicillin', 'Amoxicillin', 'Erythromycin'],
                'avoid_broad_spectrum': True,
                'duration_days': 7,
                'required_assessment': ['fever', 'throat_swab', 'centor_criteria'],
                'red_flags': ['difficulty_swallowing', 'respiratory_distress', 'high_fever']
            },
            'musculoskeletal': {
                'codes': ['M54', 'M25', 'M79'],
                'avoid_routine_imaging': ['M54.5', 'M54.9'],
                'first_line_treatment': ['NSAIDs', 'physiotherapy', 'rest'],
                'imaging_indications': ['trauma', 'neurological_signs', 'red_flags'],
                'red_flags': ['bowel_bladder_dysfunction', 'progressive_weakness', 'fever']
            },
            'cardiovascular': {
                'codes': ['I10', 'I15', 'I20', 'I25'],
                'hypertension_workup': ['ABPM', 'home_BP', 'baseline_bloods'],
                'baseline_investigations': ['ECG', 'echocardiogram', 'FBC', 'U&E', 'lipids'],
                'follow_up_intervals': {'newly_diagnosed': 4, 'stable': 12}
            },
            'genitourinary': {
                'codes': ['N20', 'N21', 'N23', 'N39'],
                'renal_colic_imaging': 'CT_KUB_urgent',
                'uti_investigations': ['urinalysis', 'culture'],
                'pain_management': ['NSAIDs_first_line', 'opioids_if_severe']
            }
        }
    
    def _load_enhanced_medication_db(self) -> Dict:
        """قاعدة بيانات شاملة للأدوية"""
        return {
            'trade_to_generic': {
                'Meva': {'generic': 'Mebeverine', 'strength': '135mg', 'class': 'Antispasmodic'},
                'Rofenac': {'generic': 'Diclofenac', 'strength': '50mg', 'class': 'NSAID'},
                'Neurovit': {'generic': 'Vitamin B Complex', 'strength': 'Mixed', 'class': 'Vitamin'},
                'Diclomax': {'generic': 'Diclofenac Gel', 'strength': '1%', 'class': 'Topical NSAID'},
                'Diva-D': {'generic': 'Cholecalciferol', 'strength': '1000IU', 'class': 'Vitamin D'},
                'Augmentin': {'generic': 'Amoxicillin/Clavulanate', 'strength': '625mg', 'class': 'Antibiotic'},
                'Voltaren': {'generic': 'Diclofenac', 'strength': '50mg', 'class': 'NSAID'},
                'Panadol': {'generic': 'Paracetamol', 'strength': '500mg', 'class': 'Analgesic'}
            },
            'antibiotic_classifications': {
                'narrow_spectrum': ['Penicillin', 'Amoxicillin', 'Erythromycin', 'Cloxacillin'],
                'broad_spectrum': ['Amoxiclav', 'Ceftriaxone', 'Azithromycin', 'Ciprofloxacin'],
                'reserved': ['Vancomycin', 'Meropenem', 'Colistin']
            },
            'drug_interactions': {
                'NSAIDs': ['warfarin', 'ACE_inhibitors', 'diuretics'],
                'antibiotics': ['warfarin', 'oral_contraceptives']
            }
        }
    
    def _load_diagnosis_codes(self) -> Dict:
        """قاعدة بيانات أكواد التشخيص"""
        return {
            'J02': 'التهاب البلعوم الحاد',
            'J03': 'التهاب اللوزتين الحاد',
            'J06': 'التهاب الجهاز التنفسي العلوي الحاد',
            'M54.5': 'ألم أسفل الظهر',
            'M54.9': 'ألم الظهر غير المحدد',
            'I10': 'ارتفاع ضغط الدم الأساسي',
            'N23': 'مغص كلوي غير محدد',
            'N20': 'حصوات الكلى والحالب',
            'K59.1': 'الإسهال غير المعدي',
            'R50': 'الحمى غير المحددة',
            'Z51.1': 'جلسة علاج كيميائي للأورام'
        }
    
    def _load_cost_benchmarks(self) -> Dict:
        """معايير التكلفة المرجعية"""
        return {
            'consultation': {'GP': 150, 'specialist': 300, 'emergency': 500},
            'investigations': {'blood_test': 100, 'xray': 200, 'CT': 800, 'MRI': 1500},
            'medications': {'antibiotic_course': 50, 'NSAID_course': 30, 'vitamin': 25}
        }

    def analyze_comprehensive_medical_file(self, file_content: str) -> Dict[str, Any]:
        """التحليل الشامل والمتقدم للملف الطبي"""
        
        try:
            self.logger.info("🔍 بدء التحليل الطبي الشامل...")
            
            # المرحلة الأولى: استخراج البيانات الأساسية
            patient_info = self._extract_enhanced_patient_info(file_content)
            visits = self._extract_detailed_visits(file_content)
            
            if not visits:
                return self._create_no_data_report("لا توجد زيارات طبية قابلة للاستخراج")
            
            # المرحلة الثانية: التحليل المتقدم
            analysis_components = {
                'patient_profile': self._create_comprehensive_patient_profile(patient_info, visits),
                'temporal_analysis': self._perform_temporal_analysis(visits),
                'clinical_pathway_analysis': self._analyze_clinical_pathways(visits),
                'medication_analysis': self._perform_advanced_medication_analysis(visits),
                'cost_efficiency_analysis': self._analyze_cost_efficiency(visits),
                'quality_metrics': self._calculate_quality_metrics(visits),
                'risk_assessment': self._perform_risk_assessment(visits),
                'guideline_compliance': self._assess_guideline_compliance(visits),
                'outcome_analysis': self._analyze_outcomes(visits)
            }
            
            # المرحلة الثالثة: التوصيات الذكية
            intelligent_recommendations = self._generate_intelligent_recommendations(analysis_components)
            
            # المرحلة الرابعة: التقرير النهائي
            comprehensive_report = self._compile_final_report(
                patient_info, visits, analysis_components, intelligent_recommendations
            )
            
            self.logger.info("✅ تم إكمال التحليل الشامل بنجاح")
            return comprehensive_report
            
        except Exception as e:
            self.logger.error(f"❌ خطأ في التحليل الشامل: {str(e)}")
            return self._create_error_report(str(e), file_content[:500])

    def _extract_enhanced_patient_info(self, content: str) -> PatientInfo:
        """استخراج معلومات المريض المحسنة"""
        
        try:
            # أنماط البحث المتقدمة
            patterns = {
                'name': [
                    r'(?:اسم المريض|Patient Name|المريض)[:\s]*([^\n\r,]+)',
                    r'Name[:\s]*([^\n\r,]+)',
                    r'(?:Mr\.|Mrs\.|Ms\.)\s*([A-Za-z\s]+)'
                ],
                'id_number': [
                    r'(?:رقم الهوية|ID|الهوية|National ID)[:\s]*(\d+)',
                    r'ID[:\s#]*(\d{10,})',
                    r'(\d{10})'  # رقم مكون من 10 أرقام
                ],
                'birth_date': [
                    r'(?:تاريخ الميلاد|Birth Date|DOB)[:\s]*(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})',
                    r'Born[:\s]*(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})'
                ],
                'gender': [
                    r'(?:الجنس|Gender|Sex)[:\s]*(ذكر|أنثى|Male|Female|M|F)',
                    r'(Male|Female|ذكر|أنثى)'
                ],
                'phone': [
                    r'(?:رقم الهاتف|Phone|Tel)[:\s]*(\+?966\d{9}|\d{10})',
                    r'(\+966\d{9}|05\d{8})'
                ],
                'insurance': [
                    r'(?:التأمين|Insurance)[:\s]*([^\n\r,]+)',
                    r'Insurance[:\s]*([^\n\r,]+)'
                ]
            }
            
            extracted_data = {}
            for field, field_patterns in patterns.items():
                for pattern in field_patterns:
                    match = re.search(pattern, content, re.IGNORECASE | re.MULTILINE)
                    if match:
                        extracted_data[field] = match.group(1).strip()
                        break
            
            return PatientInfo(
                name=extracted_data.get('name', 'غير محدد'),
                id_number=extracted_data.get('id_number', 'غير محدد'),
                birth_date=extracted_data.get('birth_date'),
                gender=extracted_data.get('gender'),
                phone=extracted_data.get('phone'),
                insurance_type=extracted_data.get('insurance')
            )
            
        except Exception as e:
            self.logger.error(f"خطأ في استخراج معلومات المريض: {e}")
            return PatientInfo(name="خطأ في الاستخراج", id_number="خطأ")

    def _extract_detailed_visits(self, content: str) -> List[MedicalVisit]:
        """استخراج تفاصيل الزيارات المحسن"""
        
        visits = []
        try:
            # تقسيم المحتوى إلى أقسام بناءً على التواريخ
            date_pattern = r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})'
            
            # البحث عن جميع التواريخ ومواقعها
            date_matches = list(re.finditer(date_pattern, content))
            
            if not date_matches:
                self.logger.warning("لم يتم العثور على تواريخ في الملف")
                return []
            
            # تقسيم المحتوى حسب التواريخ
            sections = []
            for i, match in enumerate(date_matches):
                start_pos = match.start()
                end_pos = date_matches[i + 1].start() if i + 1 < len(date_matches) else len(content)
                section = content[start_pos:end_pos]
                sections.append((match.group(1), section))
            
            # تحليل كل قسم
            for date, section in sections:
                visit = self._parse_detailed_visit_section(date, section)
                if visit:
                    visits.append(visit)
            
            # ترتيب الزيارات حسب التاريخ
            visits.sort(key=lambda x: self._parse_date(x.date))
            
            self.logger.info(f"تم استخراج {len(visits)} زيارة طبية")
            return visits
            
        except Exception as e:
            self.logger.error(f"خطأ في استخراج الزيارات: {e}")
            return []

    def _parse_detailed_visit_section(self, date: str, section: str) -> Optional[MedicalVisit]:
        """تحليل قسم زيارة مفصل"""
        
        try:
            # استخراج معلومات الطبيب
            doctor_patterns = [
                r'(?:Dr\.?|د\.?|الطبيب)\s*([A-Za-z\u0600-\u06FF\s\.]+)',
                r'Physician[:\s]*([A-Za-z\s\.]+)',
                r'([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s*,?\s*M\.?D\.?)?'
            ]
            
            doctor = "غير محدد"
            for pattern in doctor_patterns:
                match = re.search(pattern, section, re.IGNORECASE)
                if match:
                    doctor = match.group(1).strip()
                    break
            
            # استخراج كود التشخيص
            diagnosis_patterns = [
                r'(?:ICD|التشخيص|Diagnosis)[:\s]*([A-Z]\d{2}\.?\d?)',
                r'\b([A-Z]\d{2}\.?\d?)\b',
                r'Code[:\s]*([A-Z]\d{2}\.?\d?)'
            ]
            
            diagnosis_code = "غير محدد"
            for pattern in diagnosis_patterns:
                match = re.search(pattern, section)
                if match:
                    diagnosis_code = match.group(1)
                    break
            
            # استخراج سبب الزيارة
            reason_patterns = [
                r'(?:سبب الزيارة|Chief Complaint|CC)[:\s]*([^\n\r]+)',
                r'Reason[:\s]*([^\n\r]+)',
                r'Complaint[:\s]*([^\n\r]+)'
            ]
            
            visit_reason = None
            for pattern in reason_patterns:
                match = re.search(pattern, section, re.IGNORECASE)
                if match:
                    visit_reason = match.group(1).strip()
                    break
            
            # استخراج الأدوية المحسن
            medications = self._extract_medications_advanced(section)
            
            # استخراج الإجراءات
            procedures = self._extract_procedures(section)
            
            # استخراج نتائج المختبر
            lab_results = self._extract_lab_results(section)
            
            # استخراج الأشعة
            imaging = self._extract_imaging(section)
            
            # استخراج التكلفة
            cost = self._extract_cost(section)
            
            # تحديد نوع الزيارة
            visit_type = self._determine_visit_type(section, procedures)
            
            return MedicalVisit(
                date=date,
                doctor=doctor,
                diagnosis_code=diagnosis_code,
                diagnosis_description=self.diagnosis_codes.get(diagnosis_code, 'تشخيص غير محدد'),
                medications=medications,
                procedures=procedures,
                cost=cost,
                visit_type=visit_type,
                visit_reason=visit_reason,
                lab_results=lab_results or [],
                imaging=imaging or []
            )
            
        except Exception as e:
            self.logger.error(f"خطأ في تحليل قسم الزيارة: {e}")
            return None

    def _extract_medications_advanced(self, section: str) -> List[str]:
        """استخراج الأدوية المتقدم"""
        
        medications = []
        try:
            # أنماط متقدمة لاستخراج الأدوية
            patterns = [
                r'(?:Medication|الأدوية|Drugs)[:\s]*([^\n\r]+
