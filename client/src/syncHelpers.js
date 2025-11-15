// src/syncHelpers.js
export async function syncClock(socket, times = 4) {
  let offset = 0;
  for (let i = 0; i < times; i++) {
    const t0 = Date.now() / 1000;
    socket.emit('time_request', t0);
    const resp = await new Promise(resolve => socket.once('time_response', resolve));
    const t1 = Date.now() / 1000;
    const rtt = t1 - t0;
    const serverTime = resp.serverTime;
    const estimated = serverTime - (t0 + rtt / 2);
    offset = i === 0 ? estimated : offset * 0.6 + estimated * 0.4;
  }
  return offset;
}

export function serverToLocal(serverTs, offset) {
  return serverTs - offset;
}
