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

class DeepMedicalAnalyzer:
    def __init__(self):
        self.setup_medical_knowledge()
        
    def setup_medical_knowledge(self):
        """إعداد قاعدة المعرفة الطبية المتقدمة"""
        self.drug_interactions = {
            'warfarin': ['aspirin', 'ibuprofen', 'amiodarone'],
            'metformin': ['contrast_agents'],
            'ace_inhibitors': ['potassium_supplements', 'spironolactone']
        }
        
        self.unnecessary_tests = {
            'back_pain_acute': ['mri', 'ct_scan'],
            'viral_infection': ['antibiotics', 'chest_xray'],
            'headache_primary': ['ct_scan', 'mri']
        }
        
        self.cost_guidelines = {
            'consultation_emergency': 500,
            'consultation_specialist': 350,
            'xray': 150,
            'ct_scan': 800,
            'mri': 1500,
            'blood_test_basic': 80,
            'antibiotic_course': 60
        }

    def analyze_medical_case(self, content: str) -> Dict[str, Any]:
        """التحليل الطبي العميق والشامل"""
        
        print("🔍 بدء التحليل الطبي المتقدم...")
        
        # 1. استخراج البيانات الأساسية
        patient_data = self.extract_comprehensive_patient_data(content)
        visits_data = self.extract_detailed_visits(content)
        
        if not visits_data:
            return {"error": "لم يتم العثور على بيانات زيارات طبية قابلة للتحليل"}
        
        # 2. التحليل العميق
        analysis = {
            "patient_profile": patient_data,
            "visits_summary": self.create_visits_summary(visits_data),
            "clinical_timeline": self.analyze_clinical_progression(visits_data),
            "medication_analysis": self.deep_medication_analysis(visits_data),
            "procedures_evaluation": self.evaluate_procedures_necessity(visits_data),
            "cost_analysis": self.comprehensive_cost_analysis(visits_data),
            "quality_assessment": self.assess_care_quality(visits_data),
            "red_flags": self.identify_clinical_red_flags(visits_data),
            "efficiency_report": self.calculate_care_efficiency(visits_data),
            "recommendations": self.generate_expert_recommendations(visits_data)
        }
        
        # 3. تقرير التحليل النهائي
        final_report = self.compile_final_medical_report(analysis)
        
        print("✅ تم إكمال التحليل بنجاح")
        return final_report

    def extract_comprehensive_patient_data(self, content: str) -> Dict:
        """استخراج بيانات المريض الشاملة"""
        
        patient_info = {
            "name": "غير محدد",
            "id_number": "غير محدد", 
            "age": None,
            "gender": "غير محدد",
            "medical_history": [],
            "chronic_conditions": [],
            "allergies": [],
            "insurance_info": "غير محدد"
        }
        
        # استخراج الاسم
        name_patterns = [
            r'(?:اسم المريض|Patient Name|الاسم)[:\s]*([^\n\r,]{3,50})',
            r'Name[:\s]*([A-Za-z\u0600-\u06FF\s]{3,50})'
        ]
        
        for pattern in name_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                patient_info["name"] = match.group(1).strip()
                break
        
        # استخراج رقم الهوية
        id_match = re.search(r'(?:رقم الهوية|ID)[:\s]*(\d{10})', content)
        if id_match:
            patient_info["id_number"] = id_match.group(1)
        
        # استخراج العمر
        age_match = re.search(r'(?:العمر|Age)[:\s]*(\d{1,3})', content)
        if age_match:
            patient_info["age"] = int(age_match.group(1))
        
        # استخراج الجنس
        gender_match = re.search(r'(?:الجنس|Gender)[:\s]*(ذكر|أنثى|Male|Female)', content)
        if gender_match:
            patient_info["gender"] = gender_match.group(1)
        
        # استخراج التاريخ المرضي
        history_section = re.search(r'(?:التاريخ المرضي|Medical History)[:\s]*([^\n\r]{10,200})', content)
        if history_section:
            patient_info["medical_history"] = [h.strip() for h in history_section.group(1).split(',')]
        
        return patient_info

    def extract_detailed_visits(self, content: str) -> List[Dict]:
        """استخراج تفاصيل الزيارات الطبية بعمق"""
        
        visits = []
        
        # البحث عن التواريخ كمؤشرات للزيارات
        date_pattern = r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})'
        dates = re.findall(date_pattern, content)
        
        if not dates:
            return []
        
        # تقسيم المحتوى حسب التواريخ
        sections = re.split(date_pattern, content)
        
        for i in range(1, len(sections), 2):
            if i + 1 < len(sections):
                visit_date = sections[i]
                visit_content = sections[i + 1]
                
                visit_data = self.parse_single_visit_detailed(visit_date, visit_content)
                if visit_data:
                    visits.append(visit_data)
        
        return sorted(visits, key=lambda x: datetime.strptime(x['date'], '%d/%m/%Y'))

    def parse_single_visit_detailed(self, date: str, content: str) -> Dict:
        """تحليل زيارة واحدة بالتفصيل الكامل"""
        
        visit = {
            "date": date,
            "doctor": self.extract_doctor_info(content),
            "department": self.extract_department(content),
            "chief_complaint": self.extract_chief_complaint(content),
            "diagnosis": self.extract_diagnosis_detailed(content),
            "medications": self.extract_medications_comprehensive(content),
            "procedures": self.extract_procedures_comprehensive(content),
            "lab_tests": self.extract_lab_tests_detailed(content),
            "imaging": self.extract_imaging_detailed(content),
            "vital_signs": self.extract_vital_signs(content),
            "follow_up": self.extract_follow_up_info(content),
            "visit_cost": 0,
            "clinical_notes": content.strip()[:300]
        }
        
        # حساب تكلفة الزيارة
        visit["visit_cost"] = self.calculate_visit_cost_detailed(visit)
        
        return visit

    def extract_doctor_info(self, content: str) -> Dict:
        """استخراج معلومات الطبيب"""
        doctor_info = {"name": "غير محدد", "specialty": "غير محدد"}
        
        # اسم الطبيب
        doctor_patterns = [
            r'(?:د\.|Dr\.?|الطبيب)[:\s]*([A-Za-z\u0600-\u06FF\s\.]{3,40})',
            r'(?:الطبيب المعالج|Attending)[:\s]*([A-Za-z\u0600-\u06FF\s\.]{3,40})'
        ]
        
        for pattern in doctor_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                doctor_info["name"] = match.group(1).strip()
                break
        
        # التخصص
        specialties = {
            'باطنية': 'Internal Medicine',
            'قلبية': 'Cardiology', 
            'عظام': 'Orthopedics',
            'طوارئ': 'Emergency Medicine',
            'جراحة': 'Surgery',
            'أطفال': 'Pediatrics',
            'نساء': 'Gynecology'
        }
        
        for arabic, english in specialties.items():
            if arabic in content or english.lower() in content.lower():
                doctor_info["specialty"] = english
                break
                
        return doctor_info

    def extract_diagnosis_detailed(self, content: str) -> Dict:
        """استخراج التشخيص بالتفصيل"""
        
        diagnosis_info = {
            "primary": "غير محدد",
            "secondary": [],
            "icd_codes": [],
            "severity": "غير محدد",
            "certainty": "غير محدد"
        }
        
        # التشخيص الأساسي
        diag_patterns = [
            r'(?:التشخيص|Diagnosis)[:\s]*([^\n\r]{5,100})',
            r'(?:تشخيص|Dx)[:\s]*([^\n\r]{5,100})'
        ]
        
        for pattern in diag_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                diagnosis_info["primary"] = match.group(1).strip()
                break
        
        # أكواد ICD
        icd_pattern = r'\b([A-Z]\d{2}\.?\d?)\b'
        diagnosis_info["icd_codes"] = re.findall(icd_pattern, content)
        
        # درجة الشدة
        if any(word in content.lower() for word in ['حاد', 'شديد', 'acute', 'severe']):
            diagnosis_info["severity"] = "حاد"
        elif any(word in content.lower() for word in ['مزمن', 'chronic', 'متوسط', 'moderate']):
            diagnosis_info["severity"] = "مزمن"
        else:
            diagnosis_info["severity"] = "خفيف"
            
        return diagnosis_info

    def extract_medications_comprehensive(self, content: str) -> List[Dict]:
        """استخراج الأدوية بشكل شامل ومفصل"""
        
        medications = []
        
        # البحث عن قسم الأدوية
        med_section_patterns = [
            r'(?:الأدوية|Medications?|العلاج|Treatment)[:\s]*([^\n\r]+(?:\n[^\n\r]*)*)',
            r'(?:وصف|Prescribed)[:\s]*([^\n\r]+(?:\n[^\n\r]*)*)'
        ]
        
        med_text = ""
        for pattern in med_section_patterns:
            match = re.search(pattern, content, re.IGNORECASE | re.MULTILINE)
            if match:
                med_text = match.group(1)
                break
        
        if med_text:
            # تقسيم الأدوية
            med_lines = re.split(r'[\n\r]+|(?:\d+[\.\-])', med_text)
            
            for line in med_lines:
                line = line.strip()
                if len(line) > 3:
                    med_info = self.parse_medication_line(line)
                    if med_info:
                        medications.append(med_info)
        
        return medications

    def parse_medication_line(self, line: str) -> Dict:
        """تحليل سطر دواء واحد"""
        
        med_info = {
            "name": line.strip(),
            "dosage": "غير محدد",
            "frequency": "غير محدد", 
            "duration": "غير محدد",
            "route": "فموي",
            "category": self.categorize_medication(line),
            "cost_estimate": 0
        }
        
        # استخراج الجرعة
        dosage_pattern = r'(\d+(?:\.\d+)?\s*(?:mg|g|ml|units?))'
        dosage_match = re.search(dosage_pattern, line, re.IGNORECASE)
        if dosage_match:
            med_info["dosage"] = dosage_match.group(1)
        
        # استخراج التكرار
        frequency_patterns = [
            r'(\d+)\s*(?:times?|مرات?)\s*(?:daily|يومياً|per day)',
            r'(?:مرة|once|twice|ثلاث مرات|three times)',
            r'(?:كل|every)\s*(\d+)\s*(?:hours?|ساعات?)'
        ]
        
        for pattern in frequency_patterns:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                med_info["frequency"] = match.group(0)
                break
        
        # استخراج المدة
        duration_pattern = r'(?:لمدة|for)\s*(\d+)\s*(?:days?|أيام|weeks?|أسابيع)'
        duration_match = re.search(duration_pattern, line, re.IGNORECASE)
        if duration_match:
            med_info["duration"] = duration_match.group(0)
        
        # تقدير التكلفة
        med_info["cost_estimate"] = self.estimate_medication_cost(med_info)
        
        return med_info

    def categorize_medication(self, medication: str) -> str:
        """تصنيف الدواء حسب الفئة"""
        
        categories = {
            'مضاد حيوي': ['amoxicillin', 'augmentin', 'azithromycin', 'ceftriaxone', 'ciprofloxacin'],
            'مسكن ألم': ['paracetamol', 'ibuprofen', 'diclofenac', 'tramadol', 'aspirin'],
            'مضاد التهاب': ['prednisolone', 'dexamethasone', 'ibuprofen', 'diclofenac'],
            'أدوية القلب': ['amlodipine', 'lisinopril', 'metoprolol', 'atorvastatin'],
            'أدوية السكري': ['metformin', 'insulin', 'glibenclamide', 'glimepiride'],
            'فيتامينات': ['vitamin d', 'vitamin b12', 'folic acid', 'iron', 'calcium']
        }
        
        med_lower = medication.lower()
        for category, drugs in categories.items():
            if any(drug in med_lower for drug in drugs):
                return category
                
        return 'أخرى'

    def deep_medication_analysis(self, visits: List[Dict]) -> Dict:
        """تحليل عميق للأدوية عبر الزيارات"""
        
        analysis = {
            "total_medications": 0,
            "medication_categories": Counter(),
            "repeated_medications": [],
            "potential_interactions": [],
            "inappropriate_prescriptions": [],
            "cost_analysis": {"total": 0, "by_category": {}},
            "adherence_concerns": [],
            "recommendations": []
        }
        
        all_medications = []
        medication_timeline = defaultdict(list)
        
        # جمع جميع الأدوية من كل الزيارات
        for visit in visits:
            visit_date = visit['date']
            for med in visit.get('medications', []):
                all_medications.append(med)
                medication_timeline[med['name']].append({
                    'date': visit_date,
                    'details': med
                })
                analysis["medication_categories"][med['category']] += 1
                analysis["cost_analysis"]["total"] += med.get('cost_estimate', 0)
        
        analysis["total_medications"] = len(all_medications)
        
        # تحليل الأدوية المتكررة
        for med_name, occurrences in medication_timeline.items():
            if len(occurrences) > 1:
                analysis["repeated_medications"].append({
                    "medication": med_name,
                    "frequency": len(occurrences),
                    "dates": [occ['date'] for occ in occurrences],
                    "concern_level": "عالي" if len(occurrences) > 3 else "متوسط"
                })
        
        # فحص التفاعلات الدوائية المحتملة
        med_names = [med['name'].lower() for med in all_medications]
        for med1, interactions in self.drug_interactions.items():
            if med1 in ' '.join(med_names):
                for interaction in interactions:
                    if interaction in ' '.join(med_names):
                        analysis["potential_interactions"].append({
                            "drug1": med1,
                            "drug2": interaction,
                            "risk_level": "عالي",
                            "recommendation": f"يجب مراجعة تفاعل {med1} مع {interaction}"
                        })
        
        # فحص الوصفات غير المناسبة
        for visit in visits:
            diagnosis = visit.get('diagnosis', {}).get('primary', '').lower()
            
            # فحص المضادات الحيوية للعدوى الفيروسية
            if any(viral_term in diagnosis for viral_term in ['viral', 'فيروسي', 'flu', 'انفلونزا']):
                antibiotics = [med for med in visit.get('medications', []) 
                             if med['category'] == 'مضاد حيوي']
                if antibiotics:
                    analysis["inappropriate_prescriptions"].append({
                        "visit_date": visit['date'],
                        "issue": "مضاد حيوي للعدوى الفيروسية
