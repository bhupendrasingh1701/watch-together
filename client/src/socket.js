import { io } from 'socket.io-client';
export const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('socket connected (client) ->', socket.id);
});
socket.on('connect_error', (err) => {
  console.error('socket connect_error', err);
});
