// client/src/App.jsx
import React, { useEffect, useState } from 'react';
import './App.css';
import VideoPlayer from './VideoPlayer';
import ChatPanel from './ChatPanel';
import ProfilePanel from './ProfilePanel';
import UploadPanel from './UploadPanel';
import { socket } from './socket';



function makeRoomId(len = 6) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.toLowerCase();
}

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = urlParams.get('room') || '';

  const [roomId, setRoomId] = useState(initialRoom);
  const [view, setView] = useState(initialRoom ? 'room' : 'home');
  const [joinInput, setJoinInput] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [participants, setParticipants] = useState(0);
  const [participantsList, setParticipantsList] = useState([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [queue, setQueue] = useState([]);

  // host indicator
  const [isHost, setIsHost] = useState(false);

  // room settings state
  const [roomSettings, setRoomSettings] = useState({ password: null, allowUpload: 'host' });

  const [createPassword, setCreatePassword] = useState('');
  const [createAllowUpload, setCreateAllowUpload] = useState('host');

  useEffect(() => {
    if (inviteCopied) {
      const t = setTimeout(() => setInviteCopied(false), 1600);
      return () => clearTimeout(t);
    }
  }, [inviteCopied]);

  useEffect(() => {
    const onParticipants = (data) => {
      if (!data) return;
      const n = typeof data === 'number' ? data : (data.count ?? 0);
      setParticipants(n);
      if (data.list) setParticipantsList(data.list);
    };
    const onRoomSettings = (s) => {
      setRoomSettings(s || { password: null, allowUpload: 'host' });
    };
    const onYouAreHost = () => setIsHost(true);

    socket.on('participants', onParticipants);
    socket.on('room_settings', onRoomSettings);
    socket.on('you_are_host', onYouAreHost);

    return () => {
      socket.off('participants', onParticipants);
      socket.off('room_settings', onRoomSettings);
      socket.off('you_are_host', onYouAreHost);
    };
  }, []);

  useEffect(() => {
    const onQueueUpdated = (q) => setQueue(Array.isArray(q) ? q : []);
    socket.on('queue_updated', onQueueUpdated);

    return () => {
      socket.off('queue_updated', onQueueUpdated);
    };
  }, []);

  const canUpload = roomSettings.allowUpload === 'all' || isHost;

  function createRoom() {
    const id = makeRoomId(6);
    const settings = { password: createPassword || null, allowUpload: createAllowUpload || 'host' };
    setRoomId(id);
    const newUrl = `${location.pathname}?room=${id}`;
    window.history.replaceState({}, '', newUrl);
    setView('room');
    socket.emit('create_room', { roomId: id, settings });
    // ask server for queue right away
    socket.emit('request_queue', { roomId: id });
    setIsHost(false);
  }

  function joinRoom(id) {
    if (!id) return alert('Enter a room ID to join.');
    const cleaned = id.trim().toLowerCase();
    const password = prompt('Room password (leave blank if none):') || null;
    setRoomId(cleaned);
    const newUrl = `${location.pathname}?room=${cleaned}`;
    window.history.replaceState({}, '', newUrl);
    setView('room');
    socket.emit('join', { roomId: cleaned, password });
    // ask server for queue right away
    socket.emit('request_queue', { roomId: cleaned });
    setIsHost(false);
  }

  function handleCopyInvite() {
    const link = `${location.origin}${location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => setInviteCopied(true), () => alert('Copy failed — copy from address bar.'));
  }

  function leaveRoom() {
    if (roomId) {
      try {
        socket.emit('leave_room', { roomId });
      } catch {
        // ignore if already disconnected
      }
    }
    window.history.replaceState({}, '', location.pathname);
    setRoomId('');
    setView('home');
    setRoomSettings({ password: null, allowUpload: 'host' });
    setIsHost(false);
  }

  function updateSettings(patch) {
    socket.emit('update_settings', { roomId, settings: patch });
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="brand">Watch Together</div>
          {isHost && <div className="host-badge">Host</div>}
        </div>

        <nav className="top-actions" style={{ alignItems: 'center' }}>
          {view === 'room' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
  <button className="participant-pill" onClick={() => setShowParticipants(s => !s)}>
    Participants: <strong>{participants}</strong>
  </button>

  {/* overlay for participants pop */}
  {showParticipants && <div className="popup-overlay" onClick={() => setShowParticipants(false)} aria-hidden="true" />}

  {showParticipants && (
    <div className="participants-pop pop-animate" role="dialog" aria-label="Participants">
      <div style={{ padding: 8 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Participants ({participants})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {participantsList.length === 0 && <div style={{ color: 'var(--muted)' }}>No participants data</div>}
          {participantsList.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {p.avatar ? (
                <img src={p.avatar} alt={p.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(90deg,var(--accent-a),var(--accent-b))', color: '#061325', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {(p.name || 'A').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ fontWeight: 700 }}>{p.name || 'Anon'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )}
</div>


              <button className="btn btn-ghost" onClick={leaveRoom}>Leave Room</button>
            </div>
          )}

          <div style={{ marginLeft: 12 }}>
            <ProfilePanel onChange={() => {}} />
          </div>
        </nav>
      </header>

      <main className="main">
        {view === 'home' && (
          <section className="hero">
            <h1 className="title">Watch Together</h1>
            <p className="subtitle">Create a room, share the link, and watch videos in sync with friends.</p>

            <div className="controls-vertical">
              <div style={{ width: '100%' }}>
                <button className="btn btn-primary btn-block" onClick={createRoom}>Create Room</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  placeholder="Enter room ID (e.g. abc123)"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(joinInput); }}
                />
                <button className="btn" onClick={() => joinRoom(joinInput)}>Join Room</button>
              </div>

              <div style={{ marginTop: 18, width: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <label style={{ fontSize: 13, color: 'var(--muted)' }}>Room Password (optional)</label>
                  <input value={createPassword} onChange={e => setCreatePassword(e.target.value)} placeholder="Optional password" style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
                  <label style={{ fontSize: 13, color: 'var(--muted)' }}>Who can change video</label>
                  <select value={createAllowUpload} onChange={e => setCreateAllowUpload(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                    <option value="host">Host only</option>
                    <option value="all">Anyone</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="help"><strong>Tip:</strong> The person who creates the room becomes the host automatically. Host can change settings and decide who can upload video.</div>
          </section>
        )}

        {view === 'room' && (
          <section className="room" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="room-header">
              <div>
                <div className="room-id-label">Room</div>
                <div className="room-id-value">{roomId}</div>
              </div>

              <div className="room-actions">
                <button className="btn btn-outline" onClick={() => { handleCopyInvite(); }}>{inviteCopied ? 'Copied!' : 'Copy invite link'}</button>
                <button className="btn btn-ghost" onClick={leaveRoom}>Leave</button>
              </div>
            </div>

            <div className="room-content two-col">
              <div className="video-col">
                {/* pass queue and isHost into VideoPlayer so it updates when queue changes */}
                <VideoPlayer roomId={roomId} queue={queue} isHost={isHost} />
              </div>

              <aside className="side-col">
                <div className="panel">
                  <div className="panel-header">
                    <div className="panel-title">Chat</div>
                    <div className="panel-sub">Room chat (public)</div>
                  </div>

                  <UploadPanel roomId={roomId} canUpload={canUpload} />

                  <ChatPanel roomId={roomId} />
                </div>

                <div className="panel meta">
                  <div className="panel-header">
                    <div className="panel-title">Room settings</div>
                    <div className="panel-sub">Change (host only)</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Password: </div>
                      <div style={{ fontWeight: 700 }}>{roomSettings.password ? '●●●●' : 'None'}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Who can change video</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button className="btn" onClick={() => updateSettings({ allowUpload: 'host' })}>Host only</button>
                        <button className="btn" onClick={() => updateSettings({ allowUpload: 'all' })}>Anyone</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-header"><div className="panel-title">Participants</div></div>
                  <div>Count: <strong>{participants}</strong></div>
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <div>Made By Bhupendra Singh</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>watch with friends</div>
      </footer>
    </div>
  );
}
