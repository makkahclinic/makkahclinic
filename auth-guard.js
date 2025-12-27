/**
 * نظام الحماية الموحد - مجمع مكة الطبي
 * يستخدم Firebase للتحقق من المصادقة والأدوار
 * 
 * الأدوار المتاحة:
 * - owner: المالك (كل الصلاحيات)
 * - admin: مدير (سباهي + إدارة)
 * - staff: موظف (سباهي فقط)
 * - doctor: طبيب
 * - pharmacist: صيدلي
 * - insurance: تأمين
 * - patient: مريض
 * - viewer: مشاهد فقط
 */

const AuthGuard = {
    // Firebase Configuration
    firebaseConfig: {
        apiKey: "AIzaSyDhrkTwtV3Zwbj2k-PCUeXFqaFvtf_UT7s",
        authDomain: "insurance-check-6cec9.firebaseapp.com",
        projectId: "insurance-check-6cec9",
        storageBucket: "insurance-check-6cec9.appspot.com",
        messagingSenderId: "992769471393",
        appId: "1:992769471393:web:c8a9400210a0e7901011e0"
    },

    // الأدوار المسموح لها بالوصول لكل نوع صفحة
    pagePermissions: {
        'cbahi': ['owner', 'admin', 'staff', 'chair', 'member'],
        'rounds': ['owner', 'admin', 'staff', 'chair', 'member'],
        'calibration': ['owner', 'admin', 'staff', 'chair', 'member'],
        'complaints': ['owner', 'admin', 'staff', 'chair', 'member'],
        'eoc': ['owner', 'admin', 'staff', 'chair', 'member'],
        'incidents': ['owner', 'admin', 'staff', 'chair', 'member'],
        'maintenance': ['owner', 'admin', 'staff', 'chair', 'member'],
        'risk': ['owner', 'admin', 'staff', 'chair', 'member'],
        'admin': ['owner', 'admin'],
        'doctor': ['owner', 'admin', 'doctor'],
        'pharmacist': ['owner', 'admin', 'pharmacist'],
        'insurance': ['owner', 'admin', 'insurance'],
        'patient': ['owner', 'patient'],
        'owner': ['owner']
    },

    // المتغيرات
    auth: null,
    db: null,
    currentUser: null,
    userRole: null,
    isInitialized: false,

    /**
     * تهيئة النظام
     */
    async init() {
        if (this.isInitialized) return;

        try {
            const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
            const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

            const app = initializeApp(this.firebaseConfig);
            this.auth = getAuth(app);
            this.db = getFirestore(app);
            this.isInitialized = true;

            return new Promise((resolve) => {
                onAuthStateChanged(this.auth, async (user) => {
                    if (user) {
                        this.currentUser = user;
                        await this.loadUserRole(user.uid);
                        resolve(true);
                    } else {
                        this.currentUser = null;
                        this.userRole = null;
                        resolve(false);
                    }
                });
            });
        } catch (error) {
            console.error('AuthGuard init error:', error);
            return false;
        }
    },

    // API URL for backend
    apiUrl: 'https://script.google.com/macros/s/AKfycbyH9MJiYFP_0WaaL2EcxHawsUPxMZb4-W-gdBvaTdPxKbK6SeCqWd5wjjDNe9MzEfI/exec',

    /**
     * تحميل دور المستخدم من Backend (Google Sheets via Apps Script)
     * يستخدم API getUserRole بدلاً من Firestore
     */
    async loadUserRole(uid) {
        try {
            const email = this.currentUser?.email;
            if (!email) {
                this.userRole = 'viewer';
                return;
            }

            // المالك يحصل على دور owner تلقائياً
            if (email === 'husseinbabsail@gmail.com') {
                this.userRole = 'owner';
                this.userName = 'المالك';
                return;
            }

            // جلب الدور من Backend
            const idToken = await this.currentUser.getIdToken();
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'getUserRole',
                    payload: { email, idToken }
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.userRole = result.role || 'viewer';
                this.userName = result.name || '';
            } else {
                console.error('Error from API:', result.error);
                this.userRole = 'viewer';
            }
        } catch (error) {
            console.error('Error loading user role:', error);
            this.userRole = 'viewer';
        }
    },

    /**
     * التحقق من صلاحية الوصول لنوع صفحة معين
     * ⚠️ معطّل مؤقتاً - الكل يدخل
     */
    canAccess(pageType) {
        // ⚠️ معطّل مؤقتاً - السماح للجميع
        return true;
        
        // الكود الأصلي (معلّق):
        // if (!this.currentUser || !this.userRole) return false;
        // const allowedRoles = this.pagePermissions[pageType] || [];
        // return allowedRoles.includes(this.userRole);
    },

    /**
     * حماية الصفحة - يعيد التوجيه إذا لم يكن مصرح
     * ⚠️ معطّل مؤقتاً - الكل يدخل
     */
    async protectPage(pageType, redirectUrl = '/admin-login.html') {
        await this.init();

        // ⚠️ معطّل مؤقتاً - السماح للجميع حتى بدون تسجيل دخول
        return true;

        // الكود الأصلي (معلّق):
        // if (!this.currentUser) {
        //     window.location.href = redirectUrl;
        //     return false;
        // }
        // if (!this.canAccess(pageType)) {
        //     this.showAccessDenied();
        //     return false;
        // }
        // return true;
    },

    /**
     * عرض رسالة عدم الصلاحية
     */
    showAccessDenied() {
        document.body.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                font-family: 'Tajawal', sans-serif;
                background: linear-gradient(135deg, #1e3a5f 0%, #0d1f33 100%);
                color: white;
                text-align: center;
                padding: 2rem;
            ">
                <div style="
                    background: rgba(255,255,255,0.1);
                    padding: 3rem;
                    border-radius: 20px;
                    max-width: 400px;
                ">
                    <div style="font-size: 4rem; margin-bottom: 1rem;">🚫</div>
                    <h1 style="margin: 0 0 1rem; font-size: 1.8rem;">غير مصرح بالدخول</h1>
                    <p style="opacity: 0.8; margin-bottom: 2rem;">
                        ليس لديك صلاحية للوصول إلى هذه الصفحة.
                        <br>يرجى التواصل مع الإدارة.
                    </p>
                    <a href="/" style="
                        display: inline-block;
                        padding: 12px 30px;
                        background: #c9a962;
                        color: #1e3a5f;
                        text-decoration: none;
                        border-radius: 10px;
                        font-weight: bold;
                    ">العودة للرئيسية</a>
                </div>
            </div>
        `;
    },

    /**
     * الحصول على معلومات المستخدم الحالي
     */
    getUserInfo() {
        if (!this.currentUser) return null;
        return {
            uid: this.currentUser.uid,
            email: this.currentUser.email,
            displayName: this.currentUser.displayName,
            role: this.userRole
        };
    },

    /**
     * الحصول على ID Token للطلبات المحمية
     */
    async getIdToken() {
        if (!this.currentUser) return null;
        return await this.currentUser.getIdToken();
    },

    /**
     * تسجيل الخروج
     */
    async logout() {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
        await signOut(this.auth);
        window.location.href = '/';
    },

    /**
     * عرض شريط المستخدم
     */
    renderUserBar(containerId = 'user-bar') {
        const container = document.getElementById(containerId);
        if (!container || !this.currentUser) return;

        const roleNames = {
            'owner': 'المالك',
            'admin': 'مدير',
            'staff': 'موظف',
            'chair': 'رئيس لجنة',
            'member': 'عضو لجنة',
            'doctor': 'طبيب',
            'pharmacist': 'صيدلي',
            'insurance': 'تأمين',
            'patient': 'مريض',
            'viewer': 'مشاهد'
        };

        container.innerHTML = `
            <div style="
                display: flex;
                align-items: center;
                gap: 15px;
                padding: 10px 20px;
                background: rgba(255,255,255,0.1);
                border-radius: 10px;
            ">
                <span style="opacity: 0.8;">${this.currentUser.email}</span>
                <span style="
                    background: #c9a962;
                    color: #1e3a5f;
                    padding: 4px 12px;
                    border-radius: 15px;
                    font-size: 0.85rem;
                    font-weight: bold;
                ">${roleNames[this.userRole] || this.userRole}</span>
                <button onclick="AuthGuard.logout()" style="
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.3);
                    color: white;
                    padding: 6px 15px;
                    border-radius: 8px;
                    cursor: pointer;
                ">خروج</button>
            </div>
        `;
    }
};

// تصدير للاستخدام العام
window.AuthGuard = AuthGuard;
