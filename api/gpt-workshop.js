import json
import re
from datetime import datetime
from collections import defaultdict, Counter

class MedicalAnalyzer:
    def __init__(self):
        self.patterns = self._init_patterns()
        self.medical_db = self._init_medical_database()
    
    def _init_patterns(self):
        return {
            'patient_name': r'(?:اسم المريض|Patient Name|الاسم)[:\s]*([^\n\r,]{3,50})',
            'patient_id': r'(?:رقم الهوية|ID|المعرف)[:\s]*(\d{10,15})',
            'age': r'(?:العمر|Age)[:\s]*(\d{1,3})',
            'gender': r'(?:الجنس|Gender)[:\s]*(ذكر|أنثى|Male|Female)',
            'date': r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
            'diagnosis': r'(?:التشخيص|Diagnosis)[:\s]*([^\n\r]{5,200})',
            'medication': r'(?:الأدوية|Medications?)[:\s]*([^\n\r]+)',
            'procedure': r'(?:الإجراءات|Procedures?)[:\s]*([^\n\r]+)',
            'cost': r'(?:التكلفة|Cost)[:\s]*(\d+(?:\.\d+)?)',
        }
    
    def _init_medical_database(self):
        return {
            'medications': {
                'antibiotics': ['amoxicillin', 'azithromycin', 'ceftriaxone'],
                'painkillers': ['paracetamol', 'ibuprofen', 'tramadol'],
                'steroids': ['prednisolone', 'dexamethasone']
            },
            'procedures': {
                'imaging': ['xray', 'ct', 'mri', 'ultrasound'],
                'lab': ['cbc', 'glucose', 'creatinine', 'liver function']
            },
            'costs': {
                'consultation': 200,
                'xray': 150,
                'ct_scan': 800,
                'blood_test': 80,
                'medication_avg': 50
            }
        }
    
    def analyze_medical_file(self, text_content):
        """التحليل الرئيسي للملف الطبي"""
        try:
            # استخراج البيانات الأساسية
            patient_info = self._extract_patient_info(text_content)
            visits = self._extract_visits(text_content)
            
            # التحليل المتقدم
            analysis_results = {
                'patient_summary': patient_info,
                'total_visits': len(visits),
                'visits_analysis': self._analyze_visits(visits),
                'medication_analysis': self._analyze_medications(visits),
                'cost_analysis': self._analyze_costs(visits),
                'quality_indicators': self._assess_quality(visits),
                'recommendations': self._generate_recommendations(visits)
            }
            
            return self._format_final_report(analysis_results)
            
        except Exception as e:
            return {
                'error': f'خطأ في التحليل: {str(e)}',
                'status': 'failed',
                'suggestion': 'تأكد من تنسيق الملف الطبي'
            }
    
    def _extract_patient_info(self, content):
        """استخراج معلومات المريض"""
        info = {}
        
        for key, pattern in self.patterns.items():
            if key.startswith('patient_') or key in ['age', 'gender']:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    clean_key = key.replace('patient_', '')
                    info[clean_key] = match.group(1).strip()
        
        return info
    
    def _extract_visits(self, content):
        """استخراج الزيارات الطبية"""
        visits = []
        
        # البحث عن التواريخ كنقاط تقسيم
        dates = re.findall(self.patterns['date'], content)
        
        if not dates:
            return [self._create_single_visit(content)]
        
        # تقسيم المحتوى حسب التواريخ
        sections = re.split(self.patterns['date'], content)
        
        for i in range(1, len(sections), 2):
            if i + 1 < len(sections):
                visit_date = sections[i]
                visit_content = sections[i + 1]
                visit = self._parse_visit(visit_date, visit_content)
                visits.append(visit)
        
        return visits
    
    def _parse_visit(self, date, content):
        """تحليل زيارة واحدة"""
        visit = {
            'date': date,
            'diagnosis': self._extract_field(content, 'diagnosis'),
            'medications': self._extract_medications_list(content),
            'procedures': self._extract_procedures_list(content),
            'estimated_cost': 0
        }
        
        # حساب التكلفة المقدرة
        visit['estimated_cost'] = self._calculate_visit_cost(visit)
        
        return visit
    
    def _extract_field(self, content, field_type):
        """استخراج حقل محدد"""
        pattern = self.patterns.get(field_type, '')
        if pattern:
            match = re.search(pattern, content, re.IGNORECASE)
            return match.group(1).strip() if match else 'غير محدد'
        return 'غير محدد'
    
    def _extract_medications_list(self, content):
        """استخراج قائمة الأدوية"""
        medications = []
        
        # البحث عن قسم الأدوية
        med_match = re.search(r'(?:الأدوية|Medications?)[:\s]*([^\n\r]+(?:\n[^\n\r]*)*)', 
                             content, re.IGNORECASE | re.MULTILINE)
        
        if med_match:
            med_text = med_match.group(1)
            # تقسيم الأدوية
            med_lines = re.split(r'[\n\r]+|(?:\d+[\.\-])', med_text)
            
            for line in med_lines:
                line = line.strip()
                if len(line) > 3:
                    medications.append({
                        'name': line,
                        'category': self._categorize_medication(line)
                    })
        
        return medications
    
    def _extract_procedures_list(self, content):
        """استخراج قائمة الإجراءات"""
        procedures = []
        
        # البحث في النص عن إجراءات شائعة
        for category, proc_list in self.medical_db['procedures'].items():
            for proc in proc_list:
                if proc.lower() in content.lower():
                    procedures.append({
                        'name': proc,
                        'category': category
                    })
        
        return procedures
    
    def _categorize_medication(self, medication):
        """تصنيف الدواء"""
        med_lower = medication.lower()
        
        for category, drugs in self.medical_db['medications'].items():
            if any(drug in med_lower for drug in drugs):
                return category
        
        return 'other'
    
    def _calculate_visit_cost(self, visit):
        """حساب تكلفة الزيارة"""
        total_cost = self.medical_db['costs']['consultation']  # رسوم الاستشارة
        
        # تكلفة الأدوية
        total_cost += len(visit['medications']) * self.medical_db['costs']['medication_avg']
        
        # تكلفة الإجراءات
        for procedure in visit['procedures']:
            proc_name = procedure['name'].lower()
            if 'ct' in proc_name:
                total_cost += self.medical_db['costs']['ct_scan']
            elif 'xray' in proc_name:
                total_cost += self.medical_db['costs']['xray']
            elif 'blood' in proc_name or 'test' in proc_name:
                total_cost += self.medical_db['costs']['blood_test']
        
        return total_cost
    
    def _analyze_visits(self, visits):
        """تحليل الزيارات"""
        if not visits:
            return {'message': 'لا توجد زيارات للتحليل'}
        
        analysis = {
            'total_visits': len(visits),
            'date_range': self._get_date_range(visits),
            'most_common_diagnoses': self._get_common_diagnoses(visits),
            'visit_frequency': self._calculate_visit_frequency(visits)
        }
        
        return analysis
    
    def _analyze_medications(self, visits):
        """تحليل الأدوية"""
        all_meds = []
        for visit in visits:
            all_meds.extend(visit.get('medications', []))
        
        if not all_meds:
            return {'message': 'لا توجد أدوية للتحليل'}
        
        med_categories = Counter(med['category'] for med in all_meds)
        
        return {
            'total_medications': len(all_meds),
            'categories_distribution': dict(med_categories),
            'potential_concerns': self._identify_medication_concerns(all_meds)
        }
    
    def _analyze_costs(self, visits):
        """تحليل التكاليف"""
        total_cost = sum(visit.get('estimated_cost', 0) for visit in visits)
        avg_cost_per_visit = total_cost / len(visits) if visits else 0
        
        return {
            'total_estimated_cost': total_cost,
            'average_cost_per_visit': avg_cost_per_visit,
            'cost_breakdown': self._breakdown_costs(visits)
        }
    
    def _assess_quality(self, visits):
        """تقييم جودة الرعاية"""
        quality_score = 100
        issues = []
        
        # فحص التكرار غير المبرر للإجراءات
        all_procedures = []
        for visit in visits:
            all_procedures.extend([p['name'] for p in visit.get('procedures', [])])
        
        procedure_counts = Counter(all_procedures)
        for proc, count in procedure_counts.items():
            if count > 2:  # إجراء متكرر أكثر من مرتين
                quality_score -= 10
                issues.append(f'إجراء متكرر: {proc} ({count} مرات)')
        
        # فحص استخدام المضادات الحيوية
        antibiotic_visits = 0
        for visit in visits:
            diagnosis = visit.get('diagnosis', '').lower()
            medications = visit.get('medications', [])
            
            has_antibiotics = any(med['category'] == 'antibiotics' for med in medications)
            is_viral = any(term in diagnosis for term in ['viral', 'فيروسي', 'flu'])
            
            if has_antibiotics and is_viral:
                quality_score -= 15
                issues.append(f'مضاد حيوي للعدوى الفيروسية في {visit["date"]}')
        
        return {
            'quality_score': max(quality_score, 0),
            'issues_identified': issues,
            'assessment': 'ممتاز' if quality_score >= 90 else 'جيد' if quality_score >= 70 else 'يحتاج تحسين'
        }
    
    def _generate_recommendations(self, visits):
        """توليد التوصيات"""
        recommendations = []
        
        # تحليل التكاليف
        total_cost = sum(visit.get('estimated_cost', 0) for visit in visits)
        if total_cost > 2000:
            recommendations.append('يُنصح بمراجعة ضرورة بعض الإجراءات لتقليل التكاليف')
        
        # تحليل تكرار الزيارات
        if len(visits) > 5:
            recommendations.append('عدد الزيارات مرتفع - يُنصح بوضع خطة علاجية شاملة')
        
        # تحليل الأدوية
        all_meds = []
        for visit in visits:
            all_meds.extend(visit.get('medications', []))
        
        if len(all_meds) > 10:
            recommendations.append('عدد الأدوية مرتفع - يُنصح بمراجعة التفاعلات الدوائية')
        
        return recommendations
    
    def _create_single_visit(self, content):
        """إنشاء زيارة واحدة من المحتوى"""
        return {
            'date': 'غير محدد',
            'diagnosis': self._extract_field(content, 'diagnosis'),
            'medications': self._extract_medications_list(content),
            'procedures': self._extract_procedures_list(content),
            'estimated_cost': 200  # تكلفة أساسية
        }
    
    def _get_date_range(self, visits):
        """حساب المدى الزمني للزيارات"""
        dates = [visit['date'] for visit in visits if visit['date'] != 'غير محدد']
        if len(dates) >= 2:
            return f'من {min(dates)} إلى {max(dates)}'
        elif len(dates) == 1:
            return f'زيارة واحدة في {dates[0]}'
        return 'غير محدد'
    
    def _get_common_diagnoses(self, visits):
        """الحصول على التشخيصات الأكثر شيوعاً"""
        diagnoses = [visit.get('diagnosis', '') for visit in visits]
        diagnoses = [d for d in diagnoses if d and d != 'غير محدد']
        
        if diagnoses:
            return Counter(diagnoses).most_common(3)
        return []
    
    def _calculate_visit_frequency(self, visits):
        """حساب تكرار الزيارات"""
        if len(visits) <= 1:
            return 'زيارة واحدة أو أقل'
        
        # تقدير بسيط لتكرار الزيارات
        if len(visits) >= 5:
            return 'زيارات متكررة'
        elif len(visits) >= 3:
            return 'زيارات متوسطة'
        else:
            return 'زيارات قليلة'
    
    def _identify_medication_concerns(self, medications):
        """تحديد مخاوف الأدوية"""
        concerns = []
        
        # فحص المضادات الحيوية المتعددة
        antibiotics = [med for med in medications if med['category'] == 'antibiotics']
        if len(antibiotics) > 2:
            concerns.append('استخدام متعدد للمضادات الحيوية')
        
        # فحص المسكنات المتعددة
        painkillers = [med for med in medications if med['category'] == 'painkillers']
        if len(painkillers) > 3:
            concerns.append('استخدام مفرط للمسكنات')
        
        return concerns
    
    def _breakdown_costs(self, visits):
        """تفصيل التكاليف"""
        breakdown = {
            'consultations': len(visits) * self.medical_db['costs']['consultation'],
            'medications': 0,
            'procedures': 0
        }
        
        for visit in visits:
            breakdown['medications'] += len(visit.get('medications', [])) * self.medical_db['costs']['medication_avg']
            
            for procedure in visit.get('procedures', []):
                proc_name = procedure['name'].lower()
                if 'ct' in proc_name:
                    breakdown['procedures'] += self.medical_db['costs']['ct_scan']
                elif 'xray' in proc_name:
                    breakdown['procedures'] += self.medical_db['costs']['xray']
                else:
                    breakdown['procedures'] += self.medical_db['costs']['blood_test']
        
        return breakdown
    
    def _format_final_report(self, analysis_results):
        """تنسيق التقرير النهائي"""
        report = {
            'status': 'success',
            'analysis_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'patient_info': analysis_results['patient_summary'],
            'summary': {
                'total_visits': analysis_results['total_visits'],
                'total_estimated_cost': analysis_results['cost_analysis']['total_estimated_cost'],
                'quality_score': analysis_results['quality_indicators']['quality_score']
            },
            'detailed_analysis': analysis_results,
            'key_findings': self._extract_key_findings(analysis_results),
            'action_items': analysis_results['recommendations']
        }
        
        return report
    
    def _extract_key_findings(self, analysis):
        """استخراج النتائج الرئيسية"""
        findings = []
        
        # نتائج التكلفة
        total_cost = analysis['cost_analysis']['total_estimated_cost']
        if total_cost > 2000:
            findings.append(f'التكلفة الإجمالية مرتفعة: {total_cost} ريال')
        
        # نتائج الجودة
        quality_score = analysis['quality_indicators']['quality_score']
        if quality_score < 70:
            findings.append(f'نقاط جودة الرعاية منخفضة: {quality_score}%')
        
        # نتائج الأدوية
        med_analysis = analysis['medication_analysis']
        if isinstance(med_analysis, dict) and med_analysis.get('total_medications', 0) > 10:
            findings.append(f'عدد كبير من الأدوية: {med_analysis["total_medications"]}')
        
        return findings

# استخدام المحلل
def analyze_medical_case(file_content):
    """دالة لتحليل الحالة الطبية"""
    analyzer = MedicalAnalyzer()
    return analyzer.analyze_medical_file
