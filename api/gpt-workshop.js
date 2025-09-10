from flask import Flask, request, render_template, jsonify, flash, redirect, url_for
import os
import openai
from werkzeug.utils import secure_filename
import PyPDF2
import docx
import re
import json
from datetime import datetime
import logging

# إعداد التسجيل
logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'

# إعدادات التطبيق
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'doc', 'docx'}
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# إنشاء مجلد التحميل
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# إعداد OpenAI (ضع مفتاح API الخاص بك هنا)
openai.api_key = "your-openai-api-key-here"

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_file(filepath):
    """استخراج النص من الملفات المختلفة"""
    try:
        file_extension = filepath.rsplit('.', 1)[1].lower()
        
        if file_extension == 'txt':
            with open(filepath, 'r', encoding='utf-8') as file:
                return file.read()
                
        elif file_extension == 'pdf':
            text = ""
            with open(filepath, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n"
            return text
            
        elif file_extension in ['doc', 'docx']:
            doc = docx.Document(filepath)
            text = ""
            for paragraph in doc.paragraphs:
                text += paragraph.text + "\n"
            return text
            
    except Exception as e:
        logging.error(f"خطأ في استخراج النص: {str(e)}")
        return None

def extract_patient_data(text):
    """استخراج البيانات الأساسية من النص"""
    try:
        # أنماط البحث البسيطة والفعالة
        patterns = {
            'patient_name': r'(?:اسم المريض|المريض|الاسم)[:\s]*([^\n\r]+)',
            'patient_id': r'(?:رقم الهوية|الهوية|الرقم الوطني)[:\s]*([0-9]+)',
            'age': r'(?:العمر|السن)[:\s]*([0-9]+)',
            'gender': r'(?:الجنس|النوع)[:\s]*([^\n\r]+)',
            'dates': r'(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
            'departments': r'(?:القسم|الشعبة|العيادة)[:\s]*([^\n\r]+)',
            'doctors': r'(?:الطبيب|الدكتور|د\.)[:\s]*([^\n\r]+)',
            'diagnoses': r'(?:التشخيص|الحالة|المرض)[:\s]*([^\n\r]+)',
            'medications': r'(?:الدواء|العلاج|الأدوية)[:\s]*([^\n\r]+)',
            'procedures': r'(?:الإجراء|العملية|الفحص)[:\s]*([^\n\r]+)'
        }
        
        extracted_data = {}
        for key, pattern in patterns.items():
            matches = re.findall(pattern, text, re.IGNORECASE | re.MULTILINE)
            if matches:
                extracted_data[key] = matches
        
        return extracted_data
        
    except Exception as e:
        logging.error(f"خطأ في استخراج البيانات: {str(e)}")
        return {}

def generate_medical_analysis(text, extracted_data):
    """إنتاج التحليل الطبي العميق"""
    try:
        # إنشاء prompt محسن للحصول على تحليل عميق
        analysis_prompt = f"""
أنت خبير طبي متخصص. قم بتحليل هذا الملف الطبي بعمق وإنتاج تقرير شامل:

النص الطبي:
{text[:3000]}  # أول 3000 حرف لتجنب تجاوز الحد

البيانات المستخرجة:
{json.dumps(extracted_data, ensure_ascii=False, indent=2)}

قم بإنتاج تقرير طبي شامل يتضمن:

## 1. ملخص المريض
- المعلومات الشخصية الأساسية
- التاريخ المرضي والعائلي
- عوامل الخطر الحالية

## 2. تحليل الزيارات الطبية
- عدد الزيارات وتكرارها
- الأقسام المختلفة التي تمت زيارتها
- تقييم ضرورة كل زيارة
- أنماط غير طبيعية في الزيارات

## 3. مراجعة الأدوية والعلاجات
- قائمة شاملة بالأدوية الموصوفة
- تحليل التفاعلات الدوائية المحتملة
- تقييم مناسبة الجرعات والمدة
- كشف الإفراط في وصف الأدوية

## 4. تحليل الإجراءات والفحوصات
- قائمة بجميع الفحوصات المطلوبة
- تقييم ضرورة كل فحص
- كشف التكرار غير المبرر
- تحليل التكلفة مقابل الفائدة

## 5. تقييم جودة الرعاية الطبية
- مدى اتباع الإرشادات الطبية المعتمدة
- جودة التوثيق الطبي
- التنسيق بين الأطباء المختلفين
- كفاءة المتابعة الطبية

## 6. المشاكل والمخاطر المحتملة
- أخطاء في التشخيص أو العلاج
- تضارب في الأدوية أو الإجراءات
- مخاطر على صحة المريض
- مشاكل مالية أو تأمينية

## 7. التوصيات والتحسينات
- توصيات لتحسين الرعاية
- اقتراحات لتجنب المخاطر
- خطة المتابعة المستقبلية
- نصائح للمريض

## 8. الملاحظات النهائية
- تقييم عام للحالة
- درجة الخطورة إن وجدت
- أولويات العلاج

استخدم اللغة العربية وكن دقيقاً ومهنياً في التحليل.
"""

        # استدعاء OpenAI API
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo-16k",  # استخدام نموذج أكبر
            messages=[
                {"role": "system", "content": "أنت خبير طبي متخصص في تحليل الحالات الطبية وكتابة التقارير الشاملة."},
                {"role": "user", "content": analysis_prompt}
            ],
            max_tokens=4000,
            temperature=0.2,
            timeout=60  # مهلة زمنية 60 ثانية
        )
        
        return response.choices[0].message.content
        
    except openai.error.RateLimitError:
        return "خطأ: تم تجاوز حد الاستخدام لـ OpenAI API. يرجى المحاولة لاحقاً."
    except openai.error.InvalidRequestError as e:
        return f"خطأ في الطلب: {str(e)}"
    except openai.error.AuthenticationError:
        return "خطأ: مفتاح API غير صحيح. يرجى التحقق من الإعدادات."
    except Exception as e:
        logging.error(f"خطأ في التحليل: {str(e)}")
        return f"حدث خطأ أثناء التحليل: {str(e)}"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            flash('لم يتم اختيار ملف')
            return redirect(request.url)
        
        file = request.files['file']
        if file.filename == '':
            flash('لم يتم اختيار ملف')
            return redirect(request.url)
        
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{timestamp}_{filename}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            
            file.save(filepath)
            
            # استخراج النص
            text_content = extract_text_from_file(filepath)
            if not text_content:
                flash('فشل في قراءة الملف')
                return redirect(url_for('index'))
            
            # استخراج البيانات
            extracted_data = extract_patient_data(text_content)
            
            # إنتاج التحليل
            analysis_result = generate_medical_analysis(text_content, extracted_data)
            
            # حفظ النتائج
            result_data = {
                'filename': filename,
                'upload_time': datetime.now().isoformat(),
                'extracted_data': extracted_data,
                'analysis': analysis_result,
                'text_length': len(text_content)
            }
            
            # حفظ في ملف JSON
            result_filename = f"analysis_{timestamp}.json"
            result_path = os.path.join(app.config['UPLOAD_FOLDER'], result_filename)
            
            with open(result_path, 'w', encoding='utf-8') as f:
                json.dump(result_data, f, ensure_ascii=False, indent=2)
            
            return render_template('result.html', 
                                 analysis=analysis_result,
                                 extracted_data=extracted_data,
                                 filename=filename)
        else:
            flash('نوع الملف غير مدعوم. يرجى رفع ملف PDF, DOC, DOCX, أو TXT')
            return redirect(url_for('index'))
            
    except Exception as e:
        logging.error(f"خطأ في رفع الملف: {str(e)}")
        flash(f'حدث خطأ: {str(e)}')
        return redirect(url_for('index'))

@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    """API endpoint للتحليل المباشر"""
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'لم يتم إرسال النص'}), 400
        
        text = data['text']
        extracted_data = extract_patient_data(text)
        analysis = generate_medical_analysis(text, extracted_data)
        
        return jsonify({
            'success': True,
            'extracted_data': extracted_data,
            'analysis': analysis,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logging.error(f"خطأ في API: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(500)
def internal_error(error):
    logging.error(f"خطأ 500: {str(error)}")
    return render_template('error.html', 
                         error_message="حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى."), 500

@app.errorhandler(413)
def too_large(error):
    return render_template('error.html', 
                         error_message="الملف كبير جداً. الحد الأقصى 16 ميجابايت."), 413

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
