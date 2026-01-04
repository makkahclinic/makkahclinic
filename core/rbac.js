/**
 * RBAC - Role-Based Access Control Engine
 * نظام التحكم بالصلاحيات لمجمع مكة الطبي
 * 
 * الأدوار المتاحة:
 * - owner: المالك (يرى كل شيء)
 * - admin: المدير (حسب الصلاحيات)
 * - chair: رئيس لجنة
 * - member: عضو لجنة
 * - staff: موظف
 * - viewer: مشاهد فقط
 */

const SYSTEMS_CONFIG = {
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

class RBAC {
    constructor(userData) {
        this.uid = userData.uid || '';
        this.email = userData.email || '';
        this.role = userData.role || 'viewer';
        this.permissions = userData.permissions || {};
        this.status = userData.status || 'active';
        this.committee = userData.committee || null;
    }

    isOwner() {
        return this.role === 'owner';
    }

    isAdmin() {
        return this.role === 'admin';
    }

    isActive() {
        return this.status === 'active';
    }

    can(permission) {
        if (!this.isActive()) return false;
        // المالك والمدير لديهم كل الصلاحيات
        if (this.isOwner() || this.isAdmin()) return true;
        return this.permissions[permission] === true;
    }

    canAccessDashboard(type) {
        if (!this.isActive()) return false;
        
        // المالك يدخل أي لوحة تحكم
        if (this.isOwner()) return true;
        
        switch(type) {
            case 'owner':
                return false; // فقط المالك
            case 'admin':
                return this.isAdmin(); // المدير فقط (المالك مر من فوق)
            case 'staff':
                return true; // الجميع
            default:
                return false;
        }
    }

    guardPage(permission) {
        if (!this.can(permission)) {
            window.location.href = 'access-denied.html';
            return false;
        }
        return true;
    }

    guardDashboard(type) {
        if (!this.canAccessDashboard(type)) {
            window.location.href = 'access-denied.html';
            return false;
        }
        return true;
    }

    applyUI() {
        // المالك والمدير يرون كل شيء
        if (this.isOwner() || this.isAdmin()) return;

        document.querySelectorAll('[data-permission]').forEach(el => {
            const permission = el.dataset.permission;
            if (!this.can(permission)) {
                el.style.display = 'none';
            }
        });
    }

    getRedirectUrl() {
        if (!this.isActive()) return 'access-denied.html?reason=suspended';
        
        switch(this.role) {
            case 'owner':
                return 'owner-dashboard.html';
            case 'admin':
                return 'admin-dashboard.html';
            default:
                return 'staff-dashboard.html';
        }
    }

    getAvailableSystems() {
        // المالك والمدير لديهم كل الأنظمة
        if (this.isOwner() || this.isAdmin()) {
            return Object.keys(SYSTEMS_CONFIG);
        }
        
        return Object.keys(this.permissions).filter(key => this.permissions[key] === true);
    }

    static async loadFromFirestore(db, uid) {
        try {
            const doc = await db.collection('staff_roles').doc(uid).get();
            if (doc.exists) {
                return new RBAC({ uid, ...doc.data() });
            }
            return null;
        } catch (e) {
            console.error('RBAC load error:', e);
            return null;
        }
    }

    static getSystemsConfig() {
        return SYSTEMS_CONFIG;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RBAC, SYSTEMS_CONFIG };
}
