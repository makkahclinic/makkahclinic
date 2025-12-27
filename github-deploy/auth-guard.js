/**
 * نظام الحماية الموحد - مجمع مكة الطبي
 * يعتمد على Firebase Auth + Firestore (staff_roles/{uid})
 * v2.0 - 2025
 */

const AuthGuard = {
    currentUser: null,
    userRole: null,
    userData: null,
    isInitialized: false,
    db: null,
    auth: null,
    
    firebaseConfig: {
        apiKey: "AIzaSyDhrkTwtV3Zwbj2k-PCUeXFqaFvtf_UT7s",
        authDomain: "insurance-check-6cec9.firebaseapp.com",
        projectId: "insurance-check-6cec9",
        storageBucket: "insurance-check-6cec9.appspot.com",
        messagingSenderId: "992769471393",
        appId: "1:992769471393:web:c8a9400210a0e7901011e0"
    },

    OWNER_EMAIL: 'husseinbabsail@gmail.com',

    pagePermissions: {
        'public': ['guest', 'viewer', 'staff', 'member', 'chair', 'admin', 'owner'],
        'staff': ['staff', 'member', 'chair', 'admin', 'owner'],
        'cbahi': ['staff', 'member', 'chair', 'admin', 'owner'],
        'admin': ['admin', 'owner'],
        'owner': ['owner'],
        'eoc': ['staff', 'member', 'chair', 'admin', 'owner'],
        'reports': ['staff', 'member', 'chair', 'admin', 'owner'],
        'committees': ['member', 'chair', 'admin', 'owner']
    },

    async init() {
        if (this.isInitialized) return true;
        
        try {
            const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
            const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
            
            let app;
            if (getApps().length === 0) {
                app = initializeApp(this.firebaseConfig);
            } else {
                app = getApp();
            }
            
            this.auth = getAuth(app);
            this.db = getFirestore(app);
            this._getDoc = getDoc;
            this._doc = doc;
            
            return new Promise((resolve) => {
                onAuthStateChanged(this.auth, async (user) => {
                    if (user) {
                        this.currentUser = user;
                        await this.loadUserRole(user.uid, user.email);
                    } else {
                        this.currentUser = null;
                        this.userRole = 'guest';
                        this.userData = null;
                    }
                    this.isInitialized = true;
                    resolve(true);
                });
                
                setTimeout(() => {
                    if (!this.isInitialized) {
                        this.isInitialized = true;
                        this.userRole = 'guest';
                        resolve(true);
                    }
                }, 5000);
            });
        } catch (error) {
            console.error('AuthGuard init error:', error);
            this.isInitialized = true;
            this.userRole = 'guest';
            return false;
        }
    },

    async loadUserRole(uid, email) {
        if (email && email.toLowerCase() === this.OWNER_EMAIL.toLowerCase()) {
            this.userRole = 'owner';
            this.userData = {
                role: 'owner',
                status: 'active',
                email: email,
                fullName: 'المالك'
            };
            localStorage.setItem('staffRole', 'owner');
            localStorage.setItem('staffEmail', email);
            localStorage.setItem('staffUid', uid);
            return;
        }

        try {
            const docRef = this._doc(this.db, "staff_roles", uid);
            const docSnap = await this._getDoc(docRef);
            
            if (docSnap.exists()) {
                this.userData = docSnap.data();
                
                if (this.userData.status === 'suspended') {
                    this.userRole = 'suspended';
                } else {
                    this.userRole = this.userData.role || 'viewer';
                }
                
                localStorage.setItem('staffRole', this.userRole);
                localStorage.setItem('staffEmail', email || '');
                localStorage.setItem('staffUid', uid);
            } else {
                this.userRole = 'pending';
                this.userData = null;
            }
        } catch (error) {
            console.error('Error loading user role:', error);
            this.userRole = 'guest';
            this.userData = null;
        }
    },

    systemIds: ['complaints', 'incidents', 'risks', 'risk', 'rounds', 'calibration', 'maintenance', 'needlestick', 'eoc', 'cbahi'],

    canAccess(pageType) {
        const allowedRoles = this.pagePermissions[pageType] || this.pagePermissions['public'];
        return allowedRoles.includes(this.userRole);
    },

    canAccessSystem(systemId) {
        if (this.userRole === 'owner' || this.userRole === 'admin') {
            return true;
        }
        if (this.userData && this.userData.allowedSystems) {
            const normalizedId = systemId === 'risk' ? 'risks' : systemId;
            return this.userData.allowedSystems.includes(normalizedId);
        }
        return false;
    },

    async protectPage(pageType, redirectUrl = 'admin-login.html') {
        await this.init();
        
        if (pageType === 'public') {
            return true;
        }

        if (!this.currentUser) {
            this.showAccessDenied('يجب تسجيل الدخول أولاً', redirectUrl);
            return false;
        }

        if (this.userRole === 'suspended') {
            this.showAccessDenied('حسابك معلق. تواصل مع الإدارة.', redirectUrl);
            await this.logout();
            return false;
        }

        if (this.userRole === 'pending') {
            this.showAccessDenied('طلبك قيد المراجعة. انتظر الموافقة.', redirectUrl);
            await this.logout();
            return false;
        }

        if (this.systemIds.includes(pageType)) {
            if (!this.canAccessSystem(pageType)) {
                this.showAccessDenied('ليس لديك صلاحية للوصول لهذا النظام', redirectUrl);
                return false;
            }
            return true;
        }

        if (!this.canAccess(pageType)) {
            this.showAccessDenied('ليس لديك صلاحية لهذه الصفحة', redirectUrl);
            return false;
        }

        return true;
    },

    showAccessDenied(message, redirectUrl) {
        const overlay = document.createElement('div');
        overlay.id = 'access-denied-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: linear-gradient(135deg, #1e3a5f 0%, #0d1f33 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            font-family: 'Tajawal', sans-serif;
            color: white;
            text-align: center;
            padding: 20px;
        `;
        overlay.innerHTML = `
            <div style="background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; max-width: 400px;">
                <div style="width: 80px; height: 80px; background: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                    <i class="fas fa-lock" style="font-size: 2rem;"></i>
                </div>
                <h2 style="margin-bottom: 15px; color: #c9a962;">الوصول مرفوض</h2>
                <p style="margin-bottom: 25px; opacity: 0.9;">${message}</p>
                <a href="${redirectUrl}" style="display: inline-block; padding: 12px 30px; background: #c9a962; color: #1e3a5f; text-decoration: none; border-radius: 10px; font-weight: 700;">
                    تسجيل الدخول
                </a>
            </div>
        `;
        document.body.innerHTML = '';
        document.body.appendChild(overlay);
    },

    getUserInfo() {
        return {
            uid: this.currentUser?.uid || null,
            email: this.currentUser?.email || null,
            displayName: this.userData?.fullName || this.currentUser?.displayName || 'زائر',
            role: this.userRole,
            userData: this.userData
        };
    },

    async getIdToken() {
        if (this.currentUser) {
            return await this.currentUser.getIdToken();
        }
        return null;
    },

    async logout() {
        try {
            if (this.auth) {
                await this.auth.signOut();
            }
            localStorage.removeItem('staffRole');
            localStorage.removeItem('staffEmail');
            localStorage.removeItem('staffUid');
            this.currentUser = null;
            this.userRole = 'guest';
            this.userData = null;
        } catch (error) {
            console.error('Logout error:', error);
        }
    },

    renderUserBar(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const info = this.getUserInfo();
        const roleLabels = {
            'owner': 'المالك',
            'admin': 'مدير',
            'chair': 'رئيس لجنة',
            'member': 'عضو',
            'staff': 'موظف',
            'viewer': 'مشاهد',
            'guest': 'زائر',
            'pending': 'قيد المراجعة',
            'suspended': 'معلق'
        };
        
        container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(201,169,98,0.1); border-radius: 10px;">
                <div style="width: 35px; height: 35px; background: #c9a962; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #1e3a5f; font-weight: bold;">
                    ${info.displayName?.charAt(0) || '؟'}
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 0.9rem;">${info.displayName}</div>
                    <div style="font-size: 0.75rem; opacity: 0.7;">${roleLabels[info.role] || info.role}</div>
                </div>
                ${info.uid ? `<button onclick="AuthGuard.logout().then(() => location.href='admin-login.html')" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 5px;"><i class="fas fa-sign-out-alt"></i></button>` : ''}
            </div>
        `;
    },

    hasSystem(systemId) {
        if (this.userRole === 'owner' || this.userRole === 'admin') {
            return true;
        }
        if (this.userData && this.userData.allowedSystems) {
            const normalizedId = systemId === 'risk' ? 'risks' : systemId;
            return this.userData.allowedSystems.includes(normalizedId);
        }
        return false;
    },

    isOwner() {
        return this.userRole === 'owner';
    },

    isAdmin() {
        return this.userRole === 'admin' || this.userRole === 'owner';
    }
};

window.AuthGuard = AuthGuard;
