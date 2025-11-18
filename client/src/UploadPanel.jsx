// client/src/UploadPanel.jsx
import React, { useState } from 'react';
import { socket } from './socket';

const API_BASE =
  import.meta.env?.VITE_API_URL ||
  import.meta.env?.VITE_SERVER_URL ||
  (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "http://localhost:3000");


export default function UploadPanel({ roomId, canUpload }) {
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleUploadFile(e) {
    e.preventDefault();
    if (!file) return alert('Choose a file first');
    if (!canUpload) return alert('You are not allowed to upload in this room.');

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });

      // try parse json; if server returned a non-json page, fall back to text
      let json;
      try {
        json = await res.json();
      } catch (parseErr) {
        const txt = await res.text();
        throw new Error(txt || 'Upload failed (invalid server response)');
      }

      if (!res.ok) {
        // server returned a JSON error object
        throw new Error(json.error || json.message || 'Upload failed');
      }

      let url = json.url;
      if (!url) throw new Error('Upload response missing url');

      // if url is relative (starts with '/'), make it absolute against API_BASE
      if (url.startsWith('/')) {
        // strip trailing slash on API_BASE if present
        const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
        url = `${base}${url}`;
      } else if (!/^https?:\/\//.test(url)) {
        // defensive: if server returned something odd, prefix API_BASE
        const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
        url = `${base}/${url}`;
      }

      // tell the room about the new source (server will broadcast back to everyone)
      const item = { url, title: file?.name || 'Uploaded video', uploadedBy: localStorage.getItem('wt_name') || 'me' };
      console.log('[UploadPanel] enqueueing upload', item);
      socket.emit('enqueue', { roomId, item });

      // clear UI
      setFile(null);
      setLink('');
    } catch (err) {
      alert('Upload failed: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  function handleSetLink(e) {
    e.preventDefault();
    if (!link.trim()) return;
    if (!canUpload) return alert('You are not allowed to change the video.');
    const item = { url: link.trim(), title: link.trim(), uploadedBy: localStorage.getItem('wt_name') || 'me' };
    console.log('[UploadPanel] enqueueing link', item);
    socket.emit('enqueue', { roomId, item });
    setLink('');
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Video Source</div>
      {!canUpload && <div style={{ color: 'var(--muted)', marginBottom: 8 }}>Only host can change the video source.</div>}
      <form onSubmit={handleUploadFile} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input type="file" accept="video/*" onChange={e => setFile(e.target.files[0])} disabled={!canUpload || busy} />
        <button className="btn" type="submit" disabled={!canUpload || busy}>{busy ? 'Uploading...' : 'Upload'}</button>
      </form>

      <form onSubmit={handleSetLink} style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="Paste video URL (mp4, HLS, youtube link...)"
          value={link}
          onChange={e => setLink(e.target.value)}
          disabled={!canUpload}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}
        />
        <button className="btn" type="submit" disabled={!canUpload}>Set</button>
      </form>
    </div>
  );
}
