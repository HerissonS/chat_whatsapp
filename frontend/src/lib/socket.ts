import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Conexão em tempo real. O caminho é calculado a partir da página atual,
 * então funciona tanto na raiz quanto em subcaminho atrás de proxy.
 */
export function getSocket(): Socket {
  if (socket) return socket;
  const path = new URL('socket.io', document.baseURI).pathname;
  socket = io({ path, transports: ['websocket', 'polling'], withCredentials: true, reconnectionDelayMax: 10_000 });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
