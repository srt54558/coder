import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const ADDRESS = '127.0.0.1';
const PORT = Number(process.env.COLLAB_RELAY_PORT || 8765);
const ALLOWED_ORIGINS = new Set(['https://coder.k-plus.one']);
const MAX_CLIENTS_PER_ROOM = 16;
const MAX_ROOM_LOGIN_ATTEMPTS = 20;
const MAX_MESSAGES_PER_MINUTE = 2000;
const MAX_PAYLOAD_BYTES = 30_000_000;
const rooms = new Map();
const clients = new Map();

function send(socket, message) {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function rejectUpgrade(socket, status) {
	socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
	socket.destroy();
}

function roomIdIsValid(value) {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{20,32}$/u.test(value);
}

function removeClient(client) {
	if (!client.room) return;
	const room = client.room;
	if (client.id === 'host') {
		clients.delete(client.socket);
		rooms.delete(room.id);
		for (const peer of room.members.values()) {
			clients.delete(peer.socket);
			peer.room = null;
			peer.socket.close(4001, 'Session beendet');
		}
		room.members.clear();
		client.room = null;
		return;
	}
	room.members.delete(client.id);
	clients.delete(client.socket);
	client.room = null;
	send(room.host.socket, { type: 'peer-left', peerId: client.id });
}

function connectToRoom(client, room, id) {
	client.id = id;
	client.room = room;
	room.members.set(id, client);
	clients.set(client.socket, client);
}

function handleMessage(client, raw) {
	const now = Date.now();
	if (now - client.rateStart >= 60_000) {
		client.rateStart = now;
		client.rateCount = 0;
	}
	client.rateCount += 1;
	if (client.rateCount > MAX_MESSAGES_PER_MINUTE) {
		client.socket.close(4008, 'Zu viele Nachrichten');
		return;
	}

	let message;
	try {
		message = JSON.parse(raw.toString());
	} catch {
		client.socket.close(4002, 'Ungültige Nachricht');
		return;
	}

	if (message?.type === 'create') {
		if (client.room || !roomIdIsValid(message.roomId) || rooms.has(message.roomId)) {
			client.socket.close(4003, 'Sitzung konnte nicht erstellt werden');
			return;
		}
		const room = { id: message.roomId, host: client, members: new Map(), loginAttempts: 0 };
		connectToRoom(client, room, 'host');
		rooms.set(room.id, room);
		send(client.socket, { type: 'created', roomId: room.id, peerId: 'host' });
		return;
	}

	if (message?.type === 'join') {
		const room = roomIdIsValid(message.roomId) ? rooms.get(message.roomId) : undefined;
		if (client.room || !room || room.members.size >= MAX_CLIENTS_PER_ROOM) {
			client.socket.close(4004, 'Sitzung nicht gefunden oder voll');
			return;
		}
		const peerId = randomBytes(12).toString('base64url');
		connectToRoom(client, room, peerId);
		send(room.host.socket, { type: 'peer-joined', peerId });
		send(client.socket, { type: 'joined', roomId: room.id, peerId, hostPeerId: 'host' });
		return;
	}

	if (!client.room) {
		client.socket.close(4005, 'Keine Sitzung');
		return;
	}

	if (message?.type === 'signal') {
		if (typeof message.to !== 'string' || !message.payload || typeof message.payload !== 'object')
			return;
		if (message.payload.type === 'auth-start') {
			client.room.loginAttempts += 1;
			if (client.room.loginAttempts > MAX_ROOM_LOGIN_ATTEMPTS) {
				client.socket.close(4008, 'Zu viele Verbindungsversuche');
				return;
			}
		}
		const target = client.room.members.get(message.to);
		if (!target) return;
		send(target.socket, { type: 'signal', from: client.id, payload: message.payload });
		return;
	}

	if (message?.type === 'broadcast' && message.payload && typeof message.payload === 'object') {
		for (const peer of client.room.members.values()) {
			if (peer.id !== client.id) {
				send(peer.socket, { type: 'broadcast', from: client.id, payload: message.payload });
			}
		}
		return;
	}

	if (message?.type === 'leave') client.socket.close(1000, 'Session beendet');
}

const httpServer = createServer((request, response) => {
	if (request.url === '/health') {
		response.writeHead(200, {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		});
		response.end('relay-only\n');
		return;
	}
	response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
	response.end('Not found\n');
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
httpServer.on('upgrade', (request, socket, head) => {
	if (request.url !== '/__collab' || !ALLOWED_ORIGINS.has(request.headers.origin || '')) {
		rejectUpgrade(socket, '403 Forbidden');
		return;
	}
	websocketServer.handleUpgrade(request, socket, head, (websocket) => {
		websocketServer.emit('connection', websocket, request);
	});
});

websocketServer.on('connection', (socket) => {
	const client = { socket, id: '', room: null, rateStart: Date.now(), rateCount: 0 };
	socket.on('message', (raw, isBinary) => {
		if (isBinary) {
			socket.close(4002, 'Ungültige Nachricht');
			return;
		}
		handleMessage(client, raw);
	});
	socket.on('close', () => removeClient(client));
	socket.on('error', () => removeClient(client));
});

httpServer.listen(PORT, ADDRESS, () => {
	process.stdout.write(`K+ collaboration relay listening on ${ADDRESS}:${PORT}\n`);
});
