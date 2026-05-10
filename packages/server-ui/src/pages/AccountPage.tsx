import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/* ── Types ────────────────────────────────────────────────────── */

interface UserDetail {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  enabled: boolean;
  createdAt: string;
}

/* ── Component ────────────────────────────────────────────────── */

export function AccountPage() {
  const { user: authUser, multiUser, refresh: refreshAuth } = useAuth();
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Profile edit
  const [editMode, setEditMode] = useState(false);
  const [profileData, setProfileData] = useState({ displayName: '', email: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // Password change
  const [showPassword, setShowPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await api.get<UserDetail>('/me');
      setUserDetail(data);
      setProfileData({
        displayName: data.displayName || '',
        email: data.email || '',
      });
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!userDetail) return;
    setProfileLoading(true);
    try {
      await api.patch(`/users/${userDetail.id}`, {
        displayName: profileData.displayName || undefined,
        email: profileData.email || undefined,
      });
      flashStatus('success', 'Profile updated');
      setEditMode(false);
      await loadProfile();
      await refreshAuth();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setProfileLoading(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!userDetail) return;
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      flashStatus('error', 'New passwords do not match');
      return;
    }
    if (passwordData.newPassword.length < 8) {
      flashStatus('error', 'Password must be at least 8 characters');
      return;
    }
    setPasswordLoading(true);
    try {
      await api.patch(`/users/${userDetail.id}`, {
        oldPassword: passwordData.oldPassword,
        newPassword: passwordData.newPassword,
      });
      flashStatus('success', 'Password changed');
      setShowPassword(false);
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Account</h1>
          <p>Manage your account settings and profile</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-account">
      <div className="page-header">
        <h1>Account</h1>
        <p>Manage your account settings and profile</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Profile Section */}
      <div className="section">
        <h2 className="section-header">Profile</h2>

        {!editMode ? (
          <div className="card">
            <div className="card-row">
              <div className="card-info">
                <strong>Username</strong>
                <span className="text-muted">{userDetail?.username || authUser?.username}</span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Display Name</strong>
                <span className="text-muted">
                  {userDetail?.displayName || authUser?.displayName || '-'}
                </span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Email</strong>
                <span className="text-muted">{userDetail?.email || authUser?.email || '-'}</span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Role</strong>
                <span className="text-muted">
                  <span
                    className={`badge ${
                      (userDetail?.role || authUser?.role) === 'admin'
                        ? 'badge-error'
                        : (userDetail?.role || authUser?.role) === 'operator'
                          ? 'badge-primary'
                          : 'badge-default'
                    }`}
                  >
                    {userDetail?.role || authUser?.role || '-'}
                  </span>
                </span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Member Since</strong>
                <span className="text-muted">
                  {userDetail?.createdAt
                    ? new Date(userDetail.createdAt).toLocaleDateString()
                    : '-'}
                </span>
              </div>
            </div>
            {multiUser && (
              <div className="card-row">
                <div className="card-actions">
                  <button data-testid="server-ui-account-edit" className="btn btn-sm" onClick={() => setEditMode(true)}>
                    Edit Profile
                  </button>
                  <button data-testid="server-ui-account-change-password" className="btn btn-sm" onClick={() => setShowPassword(true)}>
                    Change Password
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <form onSubmit={saveProfile}>
              <div style={{ padding: '16px' }}>
                <div className="input-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    value={profileData.displayName}
                    onChange={(e) =>
                      setProfileData((d) => ({ ...d, displayName: e.target.value }))
                    }
                  />
                </div>
                <div className="input-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData((d) => ({ ...d, email: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={profileLoading}>
                    {profileLoading ? 'Saving...' : 'Save'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditMode(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Change Password Modal */}
      {showPassword && (
        <div className="modal-overlay" onClick={() => setShowPassword(false)}>
          <div className="modal" data-testid="server-ui-account-password-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Change Password</h3>
            <form onSubmit={changePassword}>
              <div className="input-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={passwordData.oldPassword}
                  onChange={(e) =>
                    setPasswordData((d) => ({ ...d, oldPassword: e.target.value }))
                  }
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) =>
                    setPasswordData((d) => ({ ...d, newPassword: e.target.value }))
                  }
                  required
                  minLength={8}
                />
              </div>
              <div className="input-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) =>
                    setPasswordData((d) => ({ ...d, confirmPassword: e.target.value }))
                  }
                  required
                  minLength={8}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowPassword(false);
                    setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={passwordLoading}>
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
