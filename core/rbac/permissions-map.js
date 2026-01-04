/**
 * خريطة الصلاحيات - المصدر الوحيد لتعريف الأنظمة
 * Makkah Medical Complex - RBAC System
 */

export const PERMISSIONS = {
    dashboard: 'dashboard',
    eoc: 'eoc',
    complaints: 'complaints',
    incidents: 'incidents',
    risks: 'risks',
    rounds: 'rounds',
    calibration: 'calibration',
    maintenance: 'maintenance',
    needlestick: 'needlestick',
    insurance: 'insurance',
    cbahi: 'cbahi'
};

export const SYSTEMS_CONFIG = {
    'dashboard': { name: 'لوحة التحكم', icon: 'tachometer-alt', color: '#1e3a5f' },
    'eoc': { name: 'الطوارئ', icon: 'broadcast-tower', color: '#dc2626' },
    'cbahi': { name: 'بوابة سباهي', icon: 'award', color: '#1e3a5f' },
    'complaints': { name: 'الشكاوى', icon: 'comment-dots', color: '#667eea' },
    'incidents': { name: 'الحوادث', icon: 'exclamation-triangle', color: '#f5576c' },
    'risks': { name: 'سجل المخاطر', icon: 'shield-alt', color: '#4facfe' },
    'rounds': { name: 'الجولات', icon: 'clipboard-check', color: '#43e97b' },
    'calibration': { name: 'المعايرة', icon: 'cogs', color: '#f093fb' },
    'maintenance': { name: 'الصيانة', icon: 'wrench', color: '#ffa726' },
    'needlestick': { name: 'الوخز الإبري', icon: 'syringe', color: '#ef4444' },
    'insurance': { name: 'التأمين الطبي', icon: 'file-medical', color: '#10b981' }
};

export const ROLES = {
    owner: { id: 'owner', name: 'المالك', color: '#dc2626', level: 100 },
    admin: { id: 'admin', name: 'المدير', color: '#2563eb', level: 90 },
    chair: { id: 'chair', name: 'رئيس لجنة', color: '#7c3aed', level: 70 },
    member: { id: 'member', name: 'عضو لجنة', color: '#059669', level: 50 },
    staff: { id: 'staff', name: 'موظف', color: '#6b7280', level: 30 },
    viewer: { id: 'viewer', name: 'مشاهد', color: '#9ca3af', level: 10 }
};

export const COMMITTEES = [
    { id: 'FMS', name: 'إدارة المرافق والسلامة' },
    { id: 'IPC', name: 'مكافحة العدوى' },
    { id: 'PSC', name: 'سلامة المرضى' },
    { id: 'RM', name: 'إدارة المخاطر' },
    { id: 'QI', name: 'تحسين الجودة' }
];
