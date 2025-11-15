// server/server.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const { Server } = require('socket.io');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET','POST'] }
});

// In-memory rooms store
// rooms[roomId] = { host, clients:Set, clientsInfo:Map, messages:[], state:{}, settings:{} , _cleanupTimeout:null }
const rooms = {};
const MAX_MESSAGES_PER_ROOM = 200;

// Admin endpoint to inspect rooms
app.get('/admin/rooms', (req, res) => {
  try {
    const summary = Object.entries(rooms).map(([id, r]) => ({
      id,
      host: r.host,
      count: r.clients.size,
      settings: r.settings,
      source: r.state?.source || null,
      messages: r.messages.length
    }));
    return res.json({ rooms: summary });
  } catch (err) {
    return res.status(500).json({ error: 'failed to build rooms summary' });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const urlPath = `/uploads/${req.file.filename}`;
  const fullUrl = `${req.protocol}://${req.get('host')}${urlPath}`;
  return res.json({ url: fullUrl });
});

// Helper: broadcast participants
function emitParticipants(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // prune disconnected sockets
  for (const id of Array.from(room.clients)) {
    if (!io.sockets.sockets.get(id)) {
      room.clients.delete(id);
      room.clientsInfo.delete(id);
    }
  }
  const participantsArr = Array.from(room.clientsInfo.entries()).map(([id, info]) => ({ id, ...info }));
  io.in(roomId).emit('participants', { count: room.clients.size, list: participantsArr });
}

// Helper: choose a new host
function electNewHost(roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  for (const id of room.clients) {
    if (io.sockets.sockets.get(id)) {
      room.host = id;
      io.to(id).emit('you_are_host');
      return id;
    } else {
      room.clients.delete(id);
      room.clientsInfo.delete(id);
    }
  }
  room.host = null;
  return null;
}

// Remove socket from room and clean up
function removeSocketFromRoom(roomId, socketId) {
  const room = rooms[roomId];
  if (!room) return;
  room.clients.delete(socketId);
  room.clientsInfo.delete(socketId);

  if (room.host === socketId) {
    const next = electNewHost(roomId);
    console.log(`host ${socketId} left room ${roomId}, new host: ${next}`);
  }

  // broadcast updated participants
  emitParticipants(roomId);

  // Immediate deletion of room when empty
  if (room.clients.size === 0) {
    console.log(`room ${roomId} is empty -> deleting immediately`);
    delete rooms[roomId];
  }
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('create_room', ({ roomId, settings = {} }) => {
    if (!roomId) return;
    rooms[roomId] ??= { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: {}, _cleanupTimeout: null };
    rooms[roomId].host = socket.id;
    rooms[roomId].settings = {
      password: settings.password || null,
      allowUpload: settings.allowUpload || 'host'
    };
    socket.join(roomId);
    rooms[roomId].clients.add(socket.id);

    socket.emit('you_are_host');
    socket.emit('chat_history', rooms[roomId].messages || []);
    emitParticipants(roomId);
    io.in(roomId).emit('room_settings', rooms[roomId].settings);
    console.log(`room ${roomId} created by ${socket.id}`, rooms[roomId].settings);
  });

  socket.on('join', ({ roomId, password = null }) => {
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: { password: null, allowUpload: 'host' }, _cleanupTimeout: null };
    }
    const settings = rooms[roomId].settings || {};
    if (settings.password && settings.password !== password) {
      socket.emit('join_failed', { reason: 'incorrect_password' });
      return;
    }

    socket.join(roomId);
    rooms[roomId].clients.add(socket.id);

    if (!rooms[roomId].host) {
      rooms[roomId].host = socket.id;
      socket.emit('you_are_host');
    } else {
      io.to(rooms[roomId].host).emit('request_state', { to: socket.id });
    }

    socket.emit('chat_history', rooms[roomId].messages || []);
    socket.emit('room_settings', rooms[roomId].settings || {});
    if (rooms[roomId].state && rooms[roomId].state.source) {
      socket.emit('set_source', rooms[roomId].state.source);
    }

    emitParticipants(roomId);
    console.log(`${socket.id} joined ${roomId}`);
  });

  socket.on('leave_room', ({ roomId }) => {
    if (!roomId || !rooms[roomId]) return;
    try { socket.leave(roomId); } catch (e) {}
    removeSocketFromRoom(roomId, socket.id);
    console.log(`${socket.id} left ${roomId} (explicit)`);
  });

  socket.on('announce', ({ roomId, name, avatar }) => {
    if (!roomId) return;
    rooms[roomId] ??= { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: { password: null, allowUpload: 'host' }, _cleanupTimeout: null };
    rooms[roomId].clientsInfo.set(socket.id, { name: name || 'Anon', avatar: avatar || null });
    emitParticipants(roomId);
    console.log('announce -> participants for', roomId, Array.from(rooms[roomId].clientsInfo.entries()).map(([id, info]) => ({ id, ...info })));
  });

  socket.on('update_settings', ({ roomId, settings }) => {
    if (!roomId || !rooms[roomId]) return;
    if (rooms[roomId].host !== socket.id) {
      socket.emit('error_message', { message: 'only host can update settings' });
      return;
    }
    rooms[roomId].settings = { ...(rooms[roomId].settings || {}), ...settings };
    io.in(roomId).emit('room_settings', rooms[roomId].settings);
    console.log('room settings updated', roomId, rooms[roomId].settings);
  });

  socket.on('set_source', ({ roomId, url }) => {
    if (!roomId || !rooms[roomId]) return;
    const sett = rooms[roomId].settings || { allowUpload: 'host' };
    const allowed = (sett.allowUpload === 'all') || (rooms[roomId].host === socket.id);
    if (!allowed) {
      socket.emit('error_message', { message: 'not allowed to set video source' });
      return;
    }
    rooms[roomId].state = rooms[roomId].state || {};
    rooms[roomId].state.source = url;
    io.in(roomId).emit('set_source', url);
    console.log('set_source by', socket.id, 'for', roomId, url);
  });

  socket.on('chat_message', ({ roomId, text, name, at, avatar }) => {
    if (!roomId) return;
    rooms[roomId] ??= { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: { password: null, allowUpload: 'host' }, _cleanupTimeout: null };
    const payload = { text, name: name || 'Anon', at: at || (Date.now() / 1000), avatar: avatar || null, from: socket.id };
    rooms[roomId].messages.push(payload);
    if (rooms[roomId].messages.length > MAX_MESSAGES_PER_ROOM) {
      rooms[roomId].messages.splice(0, rooms[roomId].messages.length - MAX_MESSAGES_PER_ROOM);
    }
    io.in(roomId).emit('chat_message', payload);
  });

  socket.on('control', ({ roomId, msg }) => {
    if (!roomId) return;
    rooms[roomId] ??= { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: { password: null, allowUpload: 'host' }, _cleanupTimeout: null };
    rooms[roomId].state = rooms[roomId].state || {};
    rooms[roomId].state.lastControl = msg;
    io.in(roomId).emit('control', msg);
  });

  socket.on('send_state_to', ({ to, state }) => {
    io.to(to).emit('control', state);
  });

  socket.on('time_request', clientSentAt => {
    socket.emit('time_response', { clientSentAt, serverTime: Date.now() / 1000 });
  });

  socket.on('disconnecting', (reason) => {
    for (const r of socket.rooms) {
      if (r === socket.id) continue;
      const roomId = r;
      if (!rooms[roomId]) continue;
      removeSocketFromRoom(roomId, socket.id);
    }
    console.log('socket disconnecting', socket.id, 'reason', reason);
  });

  socket.on('disconnect', (reason) => {
    console.log('socket disconnected', socket.id, 'reason', reason);
  });

  // Reorder queue (host only). newOrder is an array of queue items (same shape as stored).
  socket.on('reorder_queue', ({ roomId, newOrder }) => {
    if (!roomId || !rooms[roomId] || !Array.isArray(newOrder)) return;
    if (rooms[roomId].host !== socket.id) {
      socket.emit('error_message', { message: 'only host can reorder queue' });
      return;
    }
    rooms[roomId].state = rooms[roomId].state || {};
    rooms[roomId].state.queue = newOrder;
    io.in(roomId).emit('queue_updated', rooms[roomId].state.queue);
    console.log('reorder_queue', roomId);
  });

  // Remove item from queue (host only). index is item index to remove.
  socket.on('remove_from_queue', ({ roomId, index }) => {
    if (!roomId || !rooms[roomId]) return;
    if (rooms[roomId].host !== socket.id) {
      socket.emit('error_message', { message: 'only host can remove items' });
      return;
    }
    rooms[roomId].state = rooms[roomId].state || {};
    const q = rooms[roomId].state.queue || [];
    if (typeof index === 'number' && index >= 0 && index < q.length) {
      q.splice(index, 1);
      io.in(roomId).emit('queue_updated', q);
      console.log('removed queue item', roomId, index);
    }
  });

  // client can request the current queue for a room (useful when joining)
  socket.on('request_queue', ({ roomId }) => {
    if (!roomId || !rooms[roomId]) {
      socket.emit('queue_updated', []); // reply empty
      return;
    }
    const q = rooms[roomId].state?.queue || [];
    socket.emit('queue_updated', q);
  });

  socket.on('enqueue', ({ roomId, item }) => {
    if (!roomId || !item || !item.url) {
      console.log('enqueue ignored - missing roomId or item', roomId, item);
      return;
    }
    // ensure room exists
    rooms[roomId] ??= { host: null, clients: new Set(), clientsInfo: new Map(), messages: [], state: {}, settings: { password: null, allowUpload: 'host' }, _cleanupTimeout: null };
    const room = rooms[roomId];
    room.state = room.state || {};
    room.state.queue = room.state.queue || [];

    const info = room.clientsInfo.get(socket.id) || { name: 'Anon' };
    const normalized = { ...item, uploadedBy: item.uploadedBy || info.name, at: Date.now() / 1000 };
    room.state.queue.push(normalized);

    console.log('enqueue', roomId, normalized);
    io.in(roomId).emit('queue_updated', room.state.queue);
  });

  // Advance to next item in queue (anyone can request next)
  socket.on('next', ({ roomId }) => {
    if (!roomId || !rooms[roomId] || !rooms[roomId].state) return;
    const q = rooms[roomId].state.queue || [];
    if (q.length === 0) {
      // nothing to play next
      io.in(roomId).emit('queue_updated', q);
      return;
    }
    const next = q.shift();
    rooms[roomId].state.source = next.url;
    io.in(roomId).emit('set_source', next.url);
    io.in(roomId).emit('queue_updated', rooms[roomId].state.queue || []);
    console.log('next ->', roomId, next.url);
  });

  // when a client notifies that the currently playing video ended,
  // treat it like "next" (so queue automatically advances at end)
  socket.on('video_ended', ({ roomId }) => {
    if (!roomId || !rooms[roomId] || !rooms[roomId].state) return;
    const q = rooms[roomId].state.queue || [];
    if (q.length === 0) {
      io.in(roomId).emit('queue_updated', q);
      return;
    }
    const next = q.shift();
    rooms[roomId].state.source = next.url;
    io.in(roomId).emit('set_source', next.url);
    io.in(roomId).emit('queue_updated', rooms[roomId].state.queue || []);
    console.log('video ended -> next for', roomId, next.url);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server listening on ${PORT}`));
