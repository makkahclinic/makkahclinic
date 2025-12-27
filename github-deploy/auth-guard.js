/**
 * نظام الحماية الموحد - مجمع مكة الطبي
 * ⚠️ معطّل مؤقتاً - الدخول مفتوح للجميع
 */

const AuthGuard = {
    currentUser: { email: 'guest@m2020m.org' },
    userRole: 'staff',
    userName: 'زائر',
    isInitialized: true,

    async init() {
        return true;
    },

    canAccess(pageType) {
        return true;
    },

    async protectPage(pageType, redirectUrl) {
        return true;
    },

    showAccessDenied() {
        // لا شيء
    },

    getUserInfo() {
        return {
            uid: 'guest',
            email: 'guest@m2020m.org',
            displayName: 'زائر',
            role: 'staff'
        };
    },

    async getIdToken() {
        return 'guest-token';
    },

    async logout() {
        window.location.href = '/';
    },

    renderUserBar(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = '<div style="padding:10px;color:#c9a962;">الحماية معطلة مؤقتاً</div>';
        }
    }
};

window.AuthGuard = AuthGuard;
