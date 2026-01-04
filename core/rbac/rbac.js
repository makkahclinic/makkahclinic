/**
 * RBAC - Role-Based Access Control Engine
 * نظام التحكم بالصلاحيات لمجمع مكة الطبي
 */

import { PERMISSIONS, SYSTEMS_CONFIG } from './permissions-map.js';

export class RBAC {
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

    isPrivileged() {
        return this.isOwner() || this.isAdmin();
    }

    isActive() {
        return this.status === 'active';
    }

    can(permissionKey) {
        if (!this.isActive()) return false;
        if (this.isOwner() || this.isAdmin()) return true;
        return this.permissions[permissionKey] === true;
    }

    applyUI() {
        if (this.isOwner() || this.isAdmin()) return;

        document.querySelectorAll('[data-permission]').forEach(el => {
            const key = el.dataset.permission;
            if (!this.can(key)) {
                el.remove();
            }
        });
    }

    guardPage(permissionKey) {
        if (!this.can(permissionKey)) {
            window.location.href = 'access-denied.html';
            return false;
        }
        return true;
    }

    canAccessDashboard(type) {
        if (!this.isActive()) return false;
        if (this.isOwner()) return true;
        
        switch(type) {
            case 'owner':
                return false;
            case 'admin':
                return this.isAdmin();
            case 'staff':
                return true;
            default:
                return false;
        }
    }

    guardDashboard(type) {
        if (!this.canAccessDashboard(type)) {
            window.location.href = 'access-denied.html';
            return false;
        }
        return true;
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
        if (this.isOwner() || this.isAdmin()) {
            return Object.keys(SYSTEMS_CONFIG);
        }
        return Object.keys(this.permissions).filter(key => this.permissions[key] === true);
    }

    static getPermissions() {
        return PERMISSIONS;
    }

    static getSystemsConfig() {
        return SYSTEMS_CONFIG;
    }
}
