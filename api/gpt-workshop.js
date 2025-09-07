import json
import pandas as pd
from datetime import datetime, timedelta
import re
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import logging
from collections import defaultdict, Counter
import warnings
import traceback
warnings.filterwarnings('ignore')

# إعداد الترميز للعربية
import locale
try:
    locale.setlocale(locale.LC_ALL, 'ar_SA.UTF-8')
except:
    pass

@dataclass
class PatientInfo:
    name: str
    id_number: str
    birth_date: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    nationality: Optional[str] = None
    insurance_type: Optional[str] = None
    phone: Optional[str] = None
    medical_record_number: Optional[str] = None

@dataclass
class MedicalVisit:
    date: str
    doctor_name: str
    doctor_specialty: Optional[str]
    department: Optional[str]
    visit_type: str
    chief_complaint: Optional[str]
    diagnosis_primary: str
    diagnosis_secondary: List[str]
    icd_codes: List[str]
    medications_prescribed: List[Dict]
    procedures_performed: List[str]
    lab_tests_ordered: List[str]
    imaging_ordered: List[str]
    follow_up_required: bool
    follow_up_period: Optional[str]
    total_cost: float
    visit_duration: Optional[str]
    vital_signs: Dict
    clinical_notes: str

class ComprehensiveMedicalAnalyzer:
    def __init__(self):
        self.setup_logging()
        self.medical_knowledge = self._initialize_medical_knowledge()
        self.cost_database = self._initialize_cost_database()
        self.quality_indicators = self._initialize_quality_indicators()
        
    def setup_logging(self):
        """إعداد نظام السجلات"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(),
                logging.FileHandler('medical_analysis.log', encoding='utf-8')
            ]
        )
        self.logger = logging.getLogger('MedicalAnalyzer')

    def _initialize_medical_knowledge(self):
        """تهيئة قاعدة المعرفة الطبية"""
        return {
            'specialties': {
                'internal_medicine': ['باطنية', 'Internal Medicine', 'Internal Med'],
                'cardiology': ['قلبية', 'Cardiology', 'Heart'],
                'orthopedics': ['عظام', 'Orthopedics', 'Ortho'],
                'emergency': ['طوارئ', 'Emergency', 'ER'],
                'family_medicine': ['طب أسرة', 'Family Medicine', 'GP'],
                'dermatology': ['جلدية', 'Dermatology', 'Skin'],
                'neurology': ['أعصاب', 'Neurology', 'Neuro']
            },
            'medications': {
                'antibiotics': ['Augmentin', 'Amoxicillin', 'Azithromycin', 'Ceftriaxone'],
                'analgesics': ['Paracetamol', 'Ibuprofen', 'Diclofenac', 'Tramadol'],
                'antihypertensives': ['Amlodipine', 'Lisinopril', 'Metoprolol'],
                'diabetes': ['Metformin', 'Insulin', 'Glibenclamide'],
                'vitamins': ['Vitamin D', 'Vitamin B12', 'Folic Acid', 'Iron']
            },
            'procedures': {
                'diagnostic': ['X-Ray', 'CT Scan', 'MRI', 'Ultrasound', 'ECG', 'Echo'],
                'therapeutic': ['Injection', 'Dressing', 'Suturing', 'Physiotherapy'],
                'laboratory': ['CBC', 'CRP', 'ESR', 'Glucose', 'HbA1c', 'Lipid Profile']
            }
        }

    def _initialize_cost_database(self):
        """تهيئة قاعدة بيانات التكاليف"""
        return {
            'consultations': {
                'emergency': 500,
                'specialist': 350,
                'gp': 200,
                'follow_up': 150
            },
            'procedures': {
                'x_ray': 150,
                'ct_scan': 800,
                'mri': 1500,
                'ultrasound': 300,
                'ecg': 100,
                'blood_test': 80
            },
            'medications': {
                'antibiotic_course': 60,
                'pain_killer': 25,
                'chronic_medication': 100
            }
        }

    def _initialize_quality_indicators(self):
        """تهيئة مؤشرات الجودة"""
        return {
            'appropriate_antibiotic_use': {
                'viral_conditions': ['J06', 'B34'],
                'avoid_antibiotics': True
            },
            'follow_up_compliance': {
                'chronic_conditions': ['I10', 'E11', 'J44'],
                'required_interval_weeks': 4
            },
            'cost_effectiveness': {
                'routine_imaging_back_pain': False,
                'max_acceptable_cost_per_visit': 1000
            }
        }

    def analyze_medical_case(self, file_content: str) -> Dict[str, Any]:
        """التحليل الشامل للحالة الطبية"""
        
        try:
            self.logger.info("🔍 بدء التحليل الطبي المتقدم...")
            
            # 1. استخراج المعلومات الأساسية
            patient_info = self._extract_patient_information(file_content)
            visits = self._extract_all_visits(file_content)
            
            if not visits:
                return self._generate_no_data_report()
            
            # 2. التحليل المتعمق
            analysis_results = {
                'patient_summary': self._create_patient_summary(patient_info, visits),
                'chronological_analysis': self._analyze_visit_timeline(visits),
                'clinical_pattern_analysis': self._analyze_clinical_patterns(visits),
                'medication_review': self._comprehensive_medication_review(visits),
                'cost_analysis': self._detailed_cost_analysis(visits),
                'quality_assessment': self._assess_care_quality(visits),
                'red_flags': self._identify_medical_red_flags(visits),
                'efficiency_metrics': self._calculate_efficiency_metrics(visits),
                'recommendations': self._generate_clinical_recommendations(visits)
            }
            
            # 3. تجميع التقرير النهائي
            final_report = self._compile_comprehensive_report(
                patient_info, visits, analysis_results
            )
            
            self.logger.info("✅ تم إكمال التحليل بنجاح")
            return final_report
            
        except Exception as e:
            self.logger.error(f"❌ خطأ في التحليل: {str(e)}")
            self.logger.error(traceback.format_exc())
            return self._generate_error_report(str(e))

    def _extract_patient_information(self, content: str) -> PatientInfo:
        """استخراج معلومات المريض بدقة عالية"""
        
        # تنظيف النص
        content = re.sub(r'\s+', ' ', content)
        
        # أنماط البحث المحسنة
        extraction_patterns = {
            'name': [
                r'(?:اسم المريض|Patient Name|المريض)[:\s]*([^\n\r,]{3,50})',
                r'Name[:\s]*([A-Za-z\u0600-\u06FF\s]{3,50})',
                r'([A-Za-z\u0600-\u06FF]+\s+[A-Za-z\u0600-\u06FF]+\s+[A-Za-z\u0600-\u06FF]+)'
            ],
            'id_number': [
                r'(?:رقم الهوية|ID Number|الهوية الوطنية)[:\s]*(\d{10})',
                r'National ID[:\s]*(\d{10})',
                r'\b(\d{10})\b'
            ],
            'birth_date': [
                r'(?:تاريخ الميلاد|Date of Birth|DOB)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
                r'Born[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})'
            ],
            'gender': [
                r'(?:الجنس|Gender)[:\s]*(ذكر|أنثى|Male|Female)',
                r'\b(Male|Female|ذكر|أنثى)\b'
            ],
            'phone': [
                r'(?:رقم الجوال|Phone|Mobile)[:\s]*(\+?966\d{9}|\d{10})',
                r'(\+966\d{9}|05\d{8})'
            ]
        }
        
        extracted = {}
        for field, patterns in extraction_patterns.items():
            for pattern in patterns:
                match = re.search(pattern, content, re.IGNORECASE | re.MULTILINE)
                if match:
                    extracted[field] = match.group(1).strip()
                    break
        
        # حساب العمر من تاريخ الميلاد
        age = None
        if extracted.get('birth_date'):
            try:
                birth_date = datetime.strptime(extracted['birth_date'], '%d/%m/%Y')
                age = (datetime.now() - birth_date).days // 365
            except:
                pass
        
        return PatientInfo(
            name=extracted.get('name', 'غير محدد'),
            id_number=extracted.get('id_number', 'غير محدد'),
            birth_date=extracted.get('birth_date'),
            age=age,
            gender=extracted.get('gender'),
            phone=extracted.get('phone')
        )

    def _extract_all_visits(self, content: str) -> List[MedicalVisit]:
        """استخراج جميع الزيارات الطبية"""
        
        visits = []
        
        # البحث عن التواريخ كنقاط فصل
        date_pattern = r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})'
        date_matches = list(re.finditer(date_pattern, content))
        
        if not date_matches:
            return []
        
        # تقسيم المحتوى حسب التواريخ
        for i, date_match in enumerate(date_matches):
            visit_date = date_match.group(1)
            start_pos = date_match.start()
            
            # تحديد نهاية هذه الزيارة
            if i + 1 < len(date_matches):
                end_pos = date_matches[i + 1].start()
            else:
                end_pos = len(content)
            
            visit_content = content[start_pos:end_pos]
            
            # استخراج تفاصيل الزيارة
            visit = self._parse_single_visit(visit_date, visit_content)
            if visit:
                visits.append(visit)
        
        # ترتيب الزيارات حسب التاريخ
        visits.sort(key=lambda x: self._parse_date(x.date))
        
        return visits

    def _parse_single_visit(self, visit_date: str, content: str) -> Optional[MedicalVisit]:
        """تحليل زيارة واحدة بالتفصيل"""
        
        try:
            # استخراج اسم الطبيب
            doctor_patterns = [
                r'(?:Dr\.?|د\.?|الطبيب)[:\s]*([A-Za-z\u0600-\u06FF\s\.]{3,40})',
                r'Physician[:\s]*([A-Za-z\s\.]{3,40})'
            ]
            
            doctor_name = "غير محدد"
            for pattern in doctor_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    doctor_name = match.group(1).strip()
                    break
            
            # استخراج التخصص
            specialty = self._identify_doctor_specialty(content)
            
            # استخراج الشكوى الرئيسية
            chief_complaint = self._extract_chief_complaint(content)
            
            # استخراج التشخيص
            diagnosis = self._extract_diagnosis(content)
            
            # استخراج الأدوية
            medications = self._extract_medications_detailed(content)
            
            # استخراج الإجراءات
            procedures = self._extract_procedures_detailed(content)
            
            # استخراج التحاليل والأشعة
            lab_tests = self._extract_lab_tests(content)
            imaging = self._extract_imaging_studies(content)
            
            # حساب التكلفة
            total_cost = self._calculate_visit_cost(procedures, medications, lab_tests, imaging)
            
            # تحديد نوع الزيارة
            visit_type = self._determine_visit_type(content, procedures)
            
            return MedicalVisit(
                date=visit_date,
                doctor_name=doctor_name,
                doctor_specialty=specialty,
                department=None,
                visit_type=visit_type,
                chief_complaint=chief_complaint,
                diagnosis_primary=diagnosis.get('primary', 'غير محدد'),
                diagnosis_secondary=diagnosis.get('secondary', []),
                icd_codes=diagnosis.get('icd_codes', []),
                medications_prescribed=medications,
                procedures_performed=procedures,
                lab_tests_ordered=lab_tests,
                imaging_ordered=imaging,
                follow_up_required=self._check_follow_up_needed(content),
                follow_up_period=None,
                total_cost=total_cost,
                visit_duration=None,
                vital_signs={},
                clinical_notes=content[:200] + "..." if len(content) > 200 else content
            )
            
        except Exception as e:
            self.logger.error(f"خطأ في تحليل الزيارة: {e}")
            return None

    def _identify_doctor_specialty(self, content: str) -> Optional[str]:
        """تحديد تخصص الطبيب"""
        for specialty, keywords in self.medical_knowledge['specialties'].items():
            for keyword in keywords:
                if keyword.lower() in content.lower():
                    return specialty.replace('_', ' ').title()
        return None

    def _extract_chief_complaint(self, content: str) -> Optional[str]:
        """استخراج الشكوى الرئيسية"""
        patterns = [
            r'(?:الشكوى|Chief Complaint|CC)[:\s]*([^\n\r]{10,100})',
            r'(?:يشكو من|complains of)[:\s]*([^\n\r]{10,100})',
            r'(?:السبب|Reason)[:\s]*([^\n\r]{10,100})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return None

    def _extract_diagnosis(self, content: str) -> Dict:
        """استخراج التشخيص والأكواد"""
        diagnosis_info = {
            'primary': 'غير محدد',
            'secondary': [],
            'icd_codes': []
        }
        
        # البحث عن أكواد ICD
        icd_pattern = r'\b([A-Z]\d{2}\.?\d?)\b'
        icd_matches = re.findall(icd_pattern, content)
        diagnosis_info['icd_codes'] = list(set(icd_matches))
        
        # البحث عن التشخيص النصي
        diagnosis_patterns = [
            r'(?:التشخيص|Diagnosis)[:\s]*([^\n\r]{5,100})',
            r'(?:تشخيص|Dx)[:\s]*([^\n\r]{5,100})'
        ]
        
        for pattern in diagnosis_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                diagnosis_info['primary'] = match.group(1).strip()
                break
        
        return diagnosis_info

    def _extract_medications_detailed(self, content: str) -> List[Dict]:
        """استخراج الأدوية بالتفصيل"""
        medications = []
        
        # أنماط البحث عن الأدوية
        med_patterns = [
            r'(?:الأدوية|Medications?|Drugs?)[:\s]*([^\n\r]+)',
            r'(?:العلاج|Treatment)[:\s]*([^\n\r]+)',
            r'(?:وصف|Prescribed)[:\s]*([^\n\r]+)'
        ]
        
        med_text = ""
        for pattern in med_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                med_text = match.group(1)
                break
        
        if med_text:
            # تقسيم الأدوية
            med_list = re.split(r'[,،\n\r]+', med_text)
            for med in med_list:
                med = med.strip()
                if len(med) > 2:
                    med_info = {
                        'name': med,
                        'dosage': self._extract_dosage(med),
                        'frequency': self._extract_frequency(med),
                        'duration': self._extract_duration(med),
                        'category': self._categorize_medication(med)
                    }
                    medications.append(med_info)
        
        return medications

    def _extract_dosage(self, medication: str) -> Optional[str]:
        """استخراج الجرعة من نص الدواء"""
        dosage_pattern = r'(\d+(?:\.\d+)?\s*(?:mg|
