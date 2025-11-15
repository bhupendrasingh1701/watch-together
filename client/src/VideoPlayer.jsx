// client/src/VideoPlayer.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { syncClock, serverToLocal } from './syncHelpers';

/*
  Full VideoPlayer with:
  - native <video> + optional YouTube iframe
  - soft-sync logic (nudges/hard seeks)
  - queue handling (shows queue, Next button)
  - drag-and-drop reorder (host-only) and remove (host-only)
  - emits control (play/pause/seek) and video_ended
*/

export default function VideoPlayer({ roomId = 'room1', queue = [], isHost = false }) {
  const videoRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytContainerRef = useRef(null);
  const dragIndexRef = useRef(null);

  // role + clock
  const [localQueue, setLocalQueue] = useState(Array.isArray(queue) ? queue : []);
  const [isHostLocal, setIsHostLocal] = useState(isHost);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(offset);
  const isHostRef = useRef(isHostLocal);

  // feedback prevention + adjust timeout
  const applyingRemoteRef = useRef(false);
  const adjustTimeoutRef = useRef(null);

  useEffect(() => { isHostRef.current = isHostLocal; }, [isHostLocal]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => { setLocalQueue(Array.isArray(queue) ? queue : []); }, [queue]);
  useEffect(() => { setIsHostLocal(isHost); }, [isHost]);

  // -------- YouTube helpers ----------
  const parseYouTubeId = useCallback((maybeUrl) => {
    if (typeof maybeUrl !== 'string') return null;
    try {
      const u = new URL(maybeUrl);
      const hostname = u.hostname.replace('www.', '');
      if (hostname.includes('youtube.com')) return u.searchParams.get('v');
      if (hostname.includes('youtu.be')) return u.pathname.slice(1);
    } catch (err) {
      console.warn(err);
    }
    return null;
  }, []);

  const loadYouTubeAPI = useCallback((cb) => {
    if (window.YT && window.YT.Player) {
      cb && cb();
      return;
    }
    const id = 'yt-api';
    if (document.getElementById(id)) {
      const t = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(t);
          cb && cb();
        }
      }, 100);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = () => cb && cb();
  }, []);

  const destroyYTPlayer = useCallback(() => {
    try {
      if (ytPlayerRef.current && ytPlayerRef.current.destroy) {
        ytPlayerRef.current.destroy();
      }
    } catch (err) {
      console.warn('destroy yt err', err);
    }
    ytPlayerRef.current = null;
    if (ytContainerRef.current) {
      ytContainerRef.current.innerHTML = '';
    }
  }, []);

  // ---------- apply source (YT or native) ----------
  const applySource = useCallback((src, autoplay = true) => {
    if (!src) return;
    // normalize youtube url -> youtube:ID
    let normalized = src;
    const maybeYt = parseYouTubeId(src);
    if (maybeYt) normalized = `youtube:${maybeYt}`;

    if (String(normalized).startsWith('youtube:')) {
      const videoId = String(normalized).split(':')[1];

      // hide native video
      if (videoRef.current) {
        try { videoRef.current.pause(); } catch (err) { console.warn(err); }
        videoRef.current.style.display = 'none';
      }

      loadYouTubeAPI(() => {
        // create container
        let wrap = document.getElementById('yt-player');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.id = 'yt-player';
          ytContainerRef.current = wrap;
          if (videoRef.current && videoRef.current.parentNode) {
            videoRef.current.parentNode.insertBefore(wrap, videoRef.current);
          } else {
            document.body.appendChild(wrap);
          }
        } else {
          wrap.innerHTML = '';
          ytContainerRef.current = wrap;
        }

        destroyYTPlayer();

        ytPlayerRef.current = new window.YT.Player(wrap, {
          height: '360',
          width: '100%',
          videoId,
          playerVars: { modestbranding: 1, rel: 0, controls: 1 },
          events: {
            onReady: () => {
              if (autoplay) {
                try { ytPlayerRef.current.playVideo(); } catch (err) { console.warn('YT play error', err); }
              }
            },
            onStateChange: (event) => {
              if (!applyingRemoteRef.current) {
                try {
                  const now = ytPlayerRef.current.getCurrentTime();
                  if (event.data === window.YT.PlayerState.PLAYING) {
                    socket.emit('control', { roomId, msg: { type: 'play', at: now, sentAt: Date.now() / 1000 } });
                  } else if (event.data === window.YT.PlayerState.PAUSED) {
                    socket.emit('control', { roomId, msg: { type: 'pause', at: now, sentAt: Date.now() / 1000 } });
                  } else if (event.data === window.YT.PlayerState.ENDED) {
                    socket.emit('video_ended', { roomId });
                  }
                } catch (err2) {
                  console.warn('YT state change emit err', err2);
                }
              }
            }
          }
        });
      });

      return;
    }

    // native video
    destroyYTPlayer();
    if (videoRef.current) {
      videoRef.current.style.display = 'block';
      try {
        if (videoRef.current.src !== src) {
          videoRef.current.src = src;
          videoRef.current.load();
        }
        if (autoplay) {
          videoRef.current.play().catch((err) => { console.warn('video play fail', err); });
        }
      } catch (err) {
        console.warn('applySource error', err);
      }
    }
  }, [destroyYTPlayer, loadYouTubeAPI, parseYouTubeId, roomId]);

  // ---------- soft-adjust helpers ----------
  const cancelAdjust = useCallback(() => {
    if (adjustTimeoutRef.current) {
      clearTimeout(adjustTimeoutRef.current);
      adjustTimeoutRef.current = null;
    }
    if (videoRef.current) videoRef.current.playbackRate = 1;
  }, []);

  const softAdjustTo = useCallback((target) => {
    if (!videoRef.current) return;
    cancelAdjust();
    const toleranceHard = 0.6;
    const toleranceSoft = 0.15;
    const maxAdjustDuration = 2000;

    const current = videoRef.current.currentTime;
    const diff = target - current;
    const safeTarget = Math.max(0, target);

    if (Math.abs(diff) > toleranceHard) {
      videoRef.current.currentTime = safeTarget;
      videoRef.current.playbackRate = 1;
      return;
    }
    if (Math.abs(diff) <= toleranceSoft) {
      videoRef.current.playbackRate = 1;
      return;
    }

    const RATE_FAST = 1.05;
    const RATE_SLOW = 0.95;
    if (diff > 0.05) videoRef.current.playbackRate = RATE_FAST;
    else if (diff < -0.05) videoRef.current.playbackRate = RATE_SLOW;
    else videoRef.current.playbackRate = 1;

    adjustTimeoutRef.current = setTimeout(() => {
      adjustTimeoutRef.current = null;
      try {
        if (Math.abs(videoRef.current.currentTime - safeTarget) > 0.2) {
          videoRef.current.currentTime = safeTarget;
        }
        videoRef.current.playbackRate = 1;
      } catch (err) {
        console.warn('final adjust err', err);
      }
    }, maxAdjustDuration);
  }, [cancelAdjust]);

  // ---------- socket handlers & clock sync ----------
  useEffect(() => {
    // join + announce + listeners
    socket.emit('join', { roomId });
    const name = localStorage.getItem('wt_name') || '';
    const avatar = localStorage.getItem('wt_avatar') || null;
    socket.emit('announce', { roomId, name, avatar });

    const onYouAreHost = () => setIsHostLocal(true);
    const onQueueUpdated = (q) => setLocalQueue(Array.isArray(q) ? q : []);
    const onSetSource = (url) => {
      console.log('[VideoPlayer] set_source received ->', url);
      if (url) applySource(url, true);
    };

    const onRequestState = ({ to }) => {
      if (isHostRef.current) {
        if (ytPlayerRef.current && window.YT) {
          try {
            const now = ytPlayerRef.current.getCurrentTime();
            const playing = ytPlayerRef.current.getPlayerState() === window.YT.PlayerState.PLAYING;
            const state = { type: playing ? 'play' : 'pause', at: now, sentAt: Date.now() / 1000 };
            socket.emit('send_state_to', { to, state });
            return;
          } catch (err) {
            console.warn('send_state_to yt err', err);
          }
        }
        if (videoRef.current) {
          const state = { type: videoRef.current.paused ? 'pause' : 'play', at: videoRef.current.currentTime, sentAt: Date.now() / 1000 };
          socket.emit('send_state_to', { to, state });
        }
      }
    };

    const onControl = (msg) => {
      if (!msg) return;
      const isYtActive = (ytPlayerRef.current && typeof ytPlayerRef.current.getPlayerState === 'function');
      if (isYtActive && window.YT) {
        applyingRemoteRef.current = true;
        try {
          const localNow = Date.now() / 1000;
          const senderLocalTime = msg.sentAt ? serverToLocal(msg.sentAt, offsetRef.current) : localNow;
          const delta = localNow - senderLocalTime;
          const target = (typeof msg.at === 'number') ? (msg.at + delta) : undefined;

          if (msg.type === 'pause') {
            if (typeof target === 'number') ytPlayerRef.current.seekTo(target, true);
            ytPlayerRef.current.pauseVideo();
            return;
          }
          if (msg.type === 'play') {
            if (typeof target === 'number') ytPlayerRef.current.seekTo(target, true);
            ytPlayerRef.current.playVideo();
            return;
          }
          if (msg.type === 'seek') {
            if (typeof target === 'number') ytPlayerRef.current.seekTo(target, true);
            return;
          }
        } finally {
          setTimeout(() => { applyingRemoteRef.current = false; }, 120);
        }
        return;
      }

      if (!videoRef.current) return;
      applyingRemoteRef.current = true;
      try {
        const localNow = Date.now() / 1000;
        const senderLocalTime = msg.sentAt ? serverToLocal(msg.sentAt, offsetRef.current) : localNow;
        const delta = localNow - senderLocalTime;
        const target = (typeof msg.at === 'number') ? (msg.at + delta) : undefined;
        const safeTarget = (typeof target === 'number') ? Math.max(0, target) : undefined;
        const cur = videoRef.current.currentTime;

        if (msg.type === 'pause') {
          if (typeof safeTarget === 'number' && Math.abs(cur - safeTarget) > 0.5) {
            videoRef.current.currentTime = safeTarget;
          }
          videoRef.current.pause();
          cancelAdjust();
          return;
        }
        if (msg.type === 'play') {
          if (videoRef.current.paused) {
            if (typeof safeTarget === 'number' && Math.abs(cur - safeTarget) > 0.6) {
              videoRef.current.currentTime = safeTarget;
            } else if (typeof safeTarget === 'number') {
              videoRef.current.currentTime = safeTarget;
            }
            videoRef.current.play().catch((err) => { console.warn('video play err', err); });
            cancelAdjust();
            return;
          } else {
            if (typeof target === 'number') softAdjustTo(target);
            return;
          }
        }
        if (msg.type === 'seek') {
          if (typeof safeTarget === 'number') videoRef.current.currentTime = safeTarget;
          if (!videoRef.current.paused && typeof target === 'number') softAdjustTo(target);
          return;
        }
      } finally {
        setTimeout(() => { applyingRemoteRef.current = false; }, 120);
      }
    };

    socket.on('you_are_host', onYouAreHost);
    socket.on('queue_updated', onQueueUpdated);
    socket.on('set_source', onSetSource);
    socket.on('request_state', onRequestState);
    socket.on('control', onControl);

    (async () => {
      try {
        const o = await syncClock(socket, 4);
        setOffset(o);
      } catch (syncErr) {
        console.warn('Clock sync failed', syncErr);
      }
    })();

    return () => {
      socket.off('you_are_host', onYouAreHost);
      socket.off('queue_updated', onQueueUpdated);
      socket.off('set_source', onSetSource);
      socket.off('request_state', onRequestState);
      socket.off('control', onControl);
    };
  }, [roomId, applySource, cancelAdjust, softAdjustTo]);

  // ---------- emit helpers ----------
  const emitControl = useCallback((type) => {
    if (applyingRemoteRef.current) return;

    const isYtActive = (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function');
    if (isYtActive) {
      try {
        const at = ytPlayerRef.current.getCurrentTime();
        socket.emit('control', { roomId, msg: { type, at, sentAt: Date.now() / 1000 } });
      } catch (err) {
        console.warn('emitControl yt err', err);
      }
      return;
    }

    if (!videoRef.current) return;
    socket.emit('control', { roomId, msg: { type, at: videoRef.current.currentTime, sentAt: Date.now() / 1000 } });
  }, [roomId]);

  const handlePlay = () => emitControl('play');
  const handlePause = () => emitControl('pause');
  const handleSeeked = () => emitControl('seek');

  // ---------- local events ----------
  function onNativeEnded() {
    try { socket.emit('video_ended', { roomId }); } catch (err) { console.warn('video_ended emit err', err); }
  }

  function handleNextClick() {
    socket.emit('next', { roomId });
  }

  // Drag & drop handlers
  function onDragStart(e, idx) {
    dragIndexRef.current = idx;
    try { e.dataTransfer?.setData('text/plain', String(idx)); } catch (err) { console.warn(err); }
  }
  function onDragOver(e) {
    e.preventDefault();
  }
  function onDrop(e, idx) {
    e.preventDefault();
    const from = (dragIndexRef.current !== null && dragIndexRef.current !== undefined)
      ? dragIndexRef.current
      : parseInt(e.dataTransfer.getData('text/plain'), 10);
    const to = idx;
    if (from === undefined || Number.isNaN(from)) return;
    if (from === to) return;
    const newQ = Array.isArray(localQueue) ? [...localQueue] : [];
    const [item] = newQ.splice(from, 1);
    newQ.splice(to, 0, item);
    // ask server to reorder (server checks host)
    socket.emit('reorder_queue', { roomId, newOrder: newQ });
    dragIndexRef.current = null;
  }

  function handleRemove(idx) {
    socket.emit('remove_from_queue', { roomId, index: idx });
  }

  // ---------- render ----------
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <video
            ref={videoRef}
            width="100%"
            controls
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onEnded={onNativeEnded}
            style={{ display: 'block', background: '#000', borderRadius: 8 }}
          >
            <source src="" type="video/mp4" />
            Your browser does not support the video tag.
          </video>

          <div style={{ marginTop: 10, color: 'var(--muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{isHostLocal ? 'You are host' : 'Viewer'}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {Array.isArray(localQueue) && localQueue.length > 0 && (
                  <button className="btn" onClick={handleNextClick}>Next ▶</button>
                )}
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Queue: <strong>{Array.isArray(localQueue) ? localQueue.length : 0}</strong>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, marginTop: 6 }}>
              socket id: <code>{socket.id || '—'}</code><br />
              clock offset (s): <code>{Number.isFinite(offset) ? offset.toFixed(3) : '—'}</code>
            </div>
          </div>
        </div>

        <aside style={{ width: 320 }}>
          <div style={{ padding: 12, background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800 }}>Up next</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Queue: <strong>{Array.isArray(localQueue) ? localQueue.length : 0}</strong>
              </div>
            </div>

            {(!Array.isArray(localQueue) || localQueue.length === 0) && (
              <div style={{ color: 'var(--muted)', marginTop: 10 }}>Queue is empty</div>
            )}

            <ol style={{ paddingLeft: 16, marginTop: 8 }}>
              {(Array.isArray(localQueue) ? localQueue : []).map((it, i) => (
                <li
                  key={it.url + '|' + i}
                  draggable={isHostRef.current}
                  onDragStart={(e) => onDragStart(e, i)}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, i)}
                  style={{
                    marginBottom: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    cursor: isHostRef.current ? 'grab' : 'default'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{it.title || (it.url || '').split('/').pop()}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>by {it.uploadedBy || 'Anon'}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {isHostRef.current && (
                      <button className="btn" title="Remove" onClick={() => handleRemove(i)}>✕</button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn" onClick={handleNextClick} disabled={!Array.isArray(localQueue) || localQueue.length === 0}>
                Next ▶
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
