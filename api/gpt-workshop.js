import os
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class MedicalConfig:
    # إعدادات OpenAI
    OPENAI_API_KEY: str = os.getenv('OPENAI_API_KEY', 'your-api-key-here')
    MODEL_NAME: str = "gpt-4-turbo-preview"
    MAX_TOKENS: int = 4000
    TEMPERATURE: float = 0.1
    
    # قواعد التحليل الطبي
    ANALYSIS_DEPTH_LEVELS = {
        "basic": 1,
        "intermediate": 2, 
        "advanced": 3,
        "expert": 4
    }
    
    # المعايير الطبية
    MEDICAL_STANDARDS = {
        "visit_frequency": {
            "normal": "1-2 مرات شهرياً",
            "concerning": "أكثر من 3 مرات أسبوعياً",
            "critical": "يومياً أو أكثر"
        },
        "medication_interactions": True,
        "cost_analysis": True,
        "quality_indicators": True
    }

config = MedicalConfig()
