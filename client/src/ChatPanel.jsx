// client/src/ChatPanel.jsx
import React, { useEffect, useRef, useState } from 'react';
import { socket } from './socket';

/** small helpers */
function colorFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  const hex = (h >>> 0).toString(16).slice(-6).padStart(6, '0');
  return `#${hex}`;
}
function initialsFromName(name) {
  if (!name) return 'A';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function formatTimeFromEpochSeconds(epochSec) {
  try { return new Date(epochSec * 1000).toLocaleTimeString(); } catch { return ''; }
}

export default function ChatPanel({ roomId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('wt_name') || '');
  const listRef = useRef(null);

  // scroll helper (declared before use)
  function scrollToBottom() {
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 20);
  }

  useEffect(() => {
    const onHistory = (history = []) => {
      const enriched = history.map(h => ({ ...h, displayTime: formatTimeFromEpochSeconds(h.at) }));
      setMessages(enriched);
      scrollToBottom();
    };
    const onChat = (msg) => {
      const enriched = { ...msg, displayTime: formatTimeFromEpochSeconds(msg.at) };
      setMessages(prev => [...prev, enriched]);
      scrollToBottom();
    };

    socket.on('chat_history', onHistory);
    socket.on('chat_message', onChat);

    return () => {
      socket.off('chat_history', onHistory);
      socket.off('chat_message', onChat);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'wt_name') setName(e.newValue || '');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const avatarLocal = () => localStorage.getItem('wt_avatar') || null;

  function send() {
    if (!text.trim()) return;
    const payload = {
      roomId,
      text: text.trim(),
      name: name || localStorage.getItem('wt_name') || 'Anon',
      at: Date.now() / 1000,
      avatar: avatarLocal()
    };
    socket.emit('chat_message', payload);
    setText('');
    // wait for server broadcast to append
  }

  return (
    <div>
      {/* read-only profile display */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width:36, height:36, borderRadius:10, overflow:'hidden', background:'#111', display:'flex', alignItems:'center', justifyContent:'center'}}>
          {avatarLocal() ? (
            <img src={avatarLocal()} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          ) : (
            <div style={{ width:'100%', textAlign:'center', color:'#fff', fontWeight:700 }}>{initialsFromName(name || 'Anon')}</div>
          )}
        </div>

        <div style={{ fontWeight:700 }}>{name ? name : 'Anon'}</div>
        <div style={{ marginLeft:'auto', color:'var(--muted)', fontSize:12 }}>Room: <strong style={{color:'#fff'}}>{roomId}</strong></div>
      </div>

      <div className="chat-window" ref={listRef}>
        {messages.length === 0 && <div className="chat-meta">No messages yet — say hi 👋</div>}

        {messages.map((m, i) => {
          const initials = initialsFromName(m.name || 'Anon');
          const avatar = m.avatar || null;
          return (
            <div key={i} style={{ display:'flex', gap:10 }}>
              <div style={{ width:44, flex:'0 0 44px', display:'flex', alignItems:'flex-start' }}>
                {avatar ? (
                  <img src={avatar} alt="avatar" style={{ width:36, height:36, borderRadius:8, objectFit:'cover' }} />
                ) : (
                  <div style={{
                    width:36, height:36, borderRadius:8, background: colorFromString(m.name || 'Anon'),
                    display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:13
                  }}>{initials}</div>
                )}
              </div>

              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ fontWeight:700 }}>{m.name || 'Anon'}</div>
                  <div style={{ fontSize:12, color:'var(--muted)' }}>{m.displayTime || ''}</div>
                </div>
                <div style={{
                  marginTop:6,
                  background:'rgba(255,255,255,0.02)',
                  padding:'10px 12px',
                  borderRadius:10,
                  color:'#e6eef6',
                  lineHeight:1.4
                }}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-input-row" style={{ marginTop: 10 }}>
        <input
          className="chat-input"
          placeholder={name ? `Message as ${name}` : 'Write a message...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className="btn btn-primary" onClick={send}>Send</button>
      </div>
    </div>
  );
}
