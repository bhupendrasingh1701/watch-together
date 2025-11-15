// client/src/ProfilePanel.jsx
import React, { useEffect, useRef, useState } from 'react';
import { socket } from './socket';

/*
 ProfilePanel with overlay + animation
 - solid popup (already improved)
 - shows overlay behind popup when open
 - clicking overlay closes the popup
 - applies theme and persists profile to localStorage
*/

const THEME_IDS = [
  { id: 'theme-solarized', name: 'Solarized', gradient: 'linear-gradient(90deg,#268bd2,#b58900)' },
  { id: 'theme-midnight', name: 'Midnight', gradient: 'linear-gradient(90deg,#06b6d4,#7c3aed)' },
  { id: 'theme-sunset', name: 'Sunset', gradient: 'linear-gradient(90deg,#ff6b6b,#ffa94d)' },
  { id: 'theme-lavender', name: 'Lavender', gradient: 'linear-gradient(90deg,#9b8cff,#ff7ac6)' },
  { id: 'theme-mint', name: 'Mint', gradient: 'linear-gradient(90deg,#34d399,#06b6d4)' },
];

export default function ProfilePanel({ roomId = null, onChange = () => {} }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem('wt_name') || '');
  const [avatar, setAvatar] = useState(() => localStorage.getItem('wt_avatar') || null); // data URL or null
  const [theme, setThemeState] = useState(() => localStorage.getItem('wt_theme') || 'theme-solarized');

  const fileInputRef = useRef(null);
  const panelRef = useRef(null);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Announce profile changes to server and persist locally
  useEffect(() => {
    const payload = { name: name || 'Anon', avatar: avatar || null };
    try {
      socket.emit('announce', { roomId, name: payload.name, avatar: payload.avatar });
    } catch (err) {
      console.warn('announce emit failed', err);
    }

    try {
      onChange(payload);
    } catch (err) {
      console.warn('profile onChange failed', err);
    }

    try {
      if (name) localStorage.setItem('wt_name', name);
      else localStorage.removeItem('wt_name');

      if (avatar) localStorage.setItem('wt_avatar', avatar);
      else localStorage.removeItem('wt_avatar');
    } catch (err) {
      console.warn('saving profile to localStorage failed', err);
    }
  }, [name, avatar, roomId, onChange]);

  // Close panel when clicking outside (still OK) - overlay click will close too
  useEffect(() => {
    function onDocClick(ev) {
      if (!open) return;
      if (panelRef.current && !panelRef.current.contains(ev.target)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function applyTheme(themeId) {
    const all = THEME_IDS.map(t => t.id);
    document.documentElement.classList.remove(...all);
    document.documentElement.classList.add(themeId);
    try {
      localStorage.setItem('wt_theme', themeId);
    } catch (err) {
      console.warn('localStorage set failed for theme', err);
    }
    setThemeState(themeId);
  }

  function handlePickAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event) {
    const f = event?.target?.files && event.target.files[0];
    if (!f) return;

    const MAX_BYTES = 2.5 * 1024 * 1024; // ~2.5MB
    if (f.size > MAX_BYTES) {
      alert('Please choose an image smaller than ~2.5 MB for avatar.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      setAvatar(result);
    };
    reader.onerror = (err) => {
      console.warn('avatar file read error', err);
      alert('Failed to read file for avatar.');
    };
    reader.readAsDataURL(f);

    // clear input so same file can be selected again later
    event.target.value = '';
  }

  function handleRemoveAvatar() {
    setAvatar(null);
  }

  function initialsFromName(n) {
    if (!n) return 'A';
    const parts = n.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
  }

  function onToggleOpen() {
    setOpen(s => !s);
  }

  function resetProfile() {
    setName('');
    setAvatar(null);
    try {
      localStorage.removeItem('wt_name');
      localStorage.removeItem('wt_avatar');
    } catch (err) {
      console.warn('localStorage remove failed', err);
    }
  }

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        className="profile-btn"
        onClick={onToggleOpen}
        title={name ? `${name} — profile` : 'Profile'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {avatar ? (
          <img className="profile-btn-img" src={avatar} alt={name || 'avatar'} />
        ) : (
          <div className="profile-btn-initials">{initialsFromName(name || '')}</div>
        )}
      </button>

      {/* Overlay - covers rest of UI while popup open */}
      {open && <div className="popup-overlay" onClick={() => setOpen(false)} aria-hidden="true" />}

      {open && (
        <div className="profile-pop pop-animate" role="dialog" aria-label="Profile panel">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {avatar ? (
              <img src={avatar} alt="avatar" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, background: 'linear-gradient(90deg,var(--accent-a),var(--accent-b))', color: '#061325' }}>
                {initialsFromName(name || '')}
              </div>
            )}

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{name || 'Anon'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Set display name & avatar</div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)', background: 'transparent', color: 'inherit', outline: 'none' }}
            />
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
            <button className="btn" onClick={handlePickAvatarClick}>Upload</button>
            <button className="btn btn-outline" onClick={handleRemoveAvatar} disabled={!avatar}>Remove</button>
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Theme</div>

            <div style={{ display: 'flex', gap: 8 }}>
              {THEME_IDS.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTheme(t.id)}
                  title={t.name}
                  aria-pressed={theme === t.id}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: theme === t.id ? '2px solid var(--text)' : '1px solid rgba(255,255,255,0.04)',
                    background: t.gradient,
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={resetProfile}>Reset</button>
            <button className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
