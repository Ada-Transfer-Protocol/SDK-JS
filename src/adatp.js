/**
 * AdaTP JavaScript SDK (Modular Architecture)
 * Each class handles a specific domain of the protocol.
 */

// --- CONSTANTS ---
const MessageType = {
    HandshakeInit: 0x0001, AuthRequest: 0x0010, AuthSuccess: 0x0013,
    TextMessage: 0x0020, FileInit: 0x0030, FileChunk: 0x0031, FileComplete: 0x0033,
    VoiceData: 0x0044, VideoData: 0x0053, PresenceUpdate: 0x0060, JoinRoom: 0x00A0
};
const MAGIC_NUMBER = 0x41444154;

// --- PACKET UTILS ---
class Packet {
    constructor(type, payload, sessionId) {
        this.type = type; this.payload = payload; this.sessionId = sessionId;
    }
    toBytes() {
        const buf = new ArrayBuffer(45 + this.payload.length);
        const v = new DataView(buf);
        v.setUint32(0, MAGIC_NUMBER, true); v.setUint8(4, 1);
        v.setUint32(7, this.payload.length, true); v.setUint16(19, this.type, true);
        if (this.sessionId) new Uint8Array(buf).set(this.sessionId, 29);
        new Uint8Array(buf).set(this.payload, 45);
        return buf;
    }
    static fromBytes(buf) {
        if (buf.byteLength < 45) return null;
        const v = new DataView(buf);
        if (v.getUint32(0, true) !== MAGIC_NUMBER) return null;
        const len = v.getUint32(7, true);
        const type = v.getUint16(19, true);
        const sid = new Uint8Array(buf.slice(29, 45));
        const pay = new Uint8Array(buf.slice(45, 45 + len));
        return { type, payload: pay, sessionId: sid };
    }
}

// ==========================================
// 1. BASE CLIENT (Shared Core)
// ==========================================
class AdaTPBase {
    constructor(url, options = {}) {
        this.url = url;
        this.options = options;
        this.ws = null;
        this.sid = new Uint8Array(16); crypto.getRandomValues(this.sid);
        this.events = {};
        this.isConnected = false;

        // Auto-bind events from options (e.g. onConnect -> 'connect')
        Object.keys(options).forEach(key => {
            if (key.startsWith('on') && typeof options[key] === 'function') {
                // onIncomingCall -> incoming_call
                let eventName = key.substring(2).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toLowerCase();
                if (eventName.startsWith('_')) eventName = eventName.substring(1); // Remove leading underscore
                this.on(eventName, options[key]);
            }
        });

        // Auto Connect
        if (options.autoConnect !== false) {
            setTimeout(() => this.connect(options.username, options.password), 10);
        }
    }

    on(event, callback) { (this.events[event] ||= []).push(callback); }
    emit(event, ...args) { (this.events[event] || []).forEach(cb => cb(...args)); }

    connect(username = "User", password = "pass") {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();

        return new Promise((resolve, reject) => {
            if (this.ws) this.ws.close(); // Close existing if any pending
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = "arraybuffer";
            this.ws.onopen = () => {
                this._send(MessageType.AuthRequest, JSON.stringify({ username, password }));
                this.isConnected = true;
                this.emit('connect');
                resolve();
            };
            this.ws.onmessage = (e) => this._handle(e.data);
            this.ws.onclose = () => { this.isConnected = false; this.emit('disconnect'); };
            this.ws.onerror = (e) => reject(e);
        });
    }

    _handle(data) {
        const p = Packet.fromBytes(data);
        if (!p) return;
        const senderId = [...p.sessionId].map(b => b.toString(16).padStart(2, '0')).join('');
        this.handlePacket(p, senderId);
    }

    handlePacket(p, senderId) {
        // Override me
    }

    _send(type, data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        let pay = (typeof data === 'string') ? new TextEncoder().encode(data) : data;
        this.ws.send(new Packet(type, pay, this.sid).toBytes());
    }

    getMyId() { return [...this.sid].map(b => b.toString(16).padStart(2, '0')).join(''); }
}

// ==========================================
// 2. CHAT CLIENT (Text & Rooms)
// ==========================================
export class AdaTPChat extends AdaTPBase {
    join(room) { this._send(MessageType.JoinRoom, room); }

    say(text) { this._send(MessageType.TextMessage, text); }

    handlePacket(p, senderId) {
        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);
            // Hide standard signaling messages from chat
            if (txt.includes("INVITE:") || txt.includes("BYE")) return;

            this.emit('message', txt, senderId);
        }
        else if (p.type === MessageType.PresenceUpdate) {
            const status = new TextDecoder().decode(p.payload);
            this.emit(status === "LEAVE" ? 'user_left' : 'user_joined', senderId);
        }
    }
}

// ==========================================
// 3. FILE TRANSFER CLIENT
// ==========================================
export class AdaTpFileTransfer extends AdaTPBase {
    async sendFile(file) {
        const id = new Uint8Array(16); crypto.getRandomValues(id);
        const meta = JSON.stringify({ id: [...id].join(''), name: file.name, size: file.size });

        this._send(MessageType.FileInit, meta);

        const buf = await file.arrayBuffer();
        const u8 = new Uint8Array(buf);
        const CHUNK = 16000;

        for (let i = 0; i < u8.length; i += CHUNK) {
            const chunk = u8.slice(i, i + CHUNK);
            const pay = new Uint8Array(16 + chunk.length);
            pay.set(id, 0); pay.set(chunk, 16);
            this.ws.send(new Packet(MessageType.FileChunk, pay, this.sid).toBytes());
            await new Promise(r => setTimeout(r, 2));
            this.emit('progress', (i / u8.length) * 100);
        }
        this._send(MessageType.FileComplete, id);
        this.emit('complete');
    }
}

// ==========================================
// 5. CONFERENCE CLIENT (Group Calls)
// ==========================================
export class AdaTPConference extends AdaTPBase {
    constructor(url, options) {
        super(url, options);
        this.audioCtx = null;
        this.micStream = null;
        this.users = new Set();
    }

    join(room) {
        this._send(MessageType.JoinRoom, room);
        this.startAudio();
        this.emit('joined', room);
        // Discovery
        setTimeout(() => this._send(MessageType.TextMessage, "DISCOVERY:WHO_IS_HERE"), 500);
    }

    leave() {
        this.stopAudio();
        // Tell others I'm leaving
        this._send(MessageType.TextMessage, "DISCOVERY:I_AM_LEAVING");
        setTimeout(() => {
            this._send(MessageType.JoinRoom, "lobby");
            this.emit('left');
        }, 100);
    }

    toggleMute() {
        if (this.micStream) {
            const t = this.micStream.getAudioTracks()[0];
            t.enabled = !t.enabled;
            const isMuted = !t.enabled;
            this._send(MessageType.TextMessage, isMuted ? "MUTE:ON" : "MUTE:OFF");
            return isMuted;
        }
        return false;
    }

    handlePacket(p, senderId) {
        const isMe = senderId === this.getMyId();

        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);
            if (txt === "DISCOVERY:WHO_IS_HERE") {
                this._send(MessageType.TextMessage, "DISCOVERY:I_AM_HERE");
                // Tell new user my mute state
                if (this.micStream && !this.micStream.getAudioTracks()[0].enabled) {
                    setTimeout(() => this._send(MessageType.TextMessage, "MUTE:ON"), 100);
                }
                if (!isMe) { this.users.add(senderId); this.emit('user_joined', senderId); }
            }
            else if (txt === "DISCOVERY:I_AM_HERE") {
                if (!isMe && !this.users.has(senderId)) {
                    this.users.add(senderId);
                    this.emit('user_joined', senderId);
                }
            }
            else if (txt === "DISCOVERY:I_AM_LEAVING") {
                if (!isMe) {
                    this.users.delete(senderId);
                    this.emit('user_left', senderId);
                }
            }
            else if (txt === "MUTE:ON") {
                this.emit('mute_changed', senderId, true);
            }
            else if (txt === "MUTE:OFF") {
                this.emit('mute_changed', senderId, false);
            }
        }
        else if (p.type === MessageType.VoiceData && !isMe) {
            if (!this.users.has(senderId)) { // Auto-add if speaks
                this.users.add(senderId);
                this.emit('user_joined', senderId);
            }
            this.emit('voice_activity', senderId);
            this._playAudio(p.payload);
        }
        else if (p.type === MessageType.PresenceUpdate) {
            const status = new TextDecoder().decode(p.payload);
            if (status === "JOIN") {
                this.users.add(senderId);
                this.emit('user_joined', senderId);
            } else {
                this.users.delete(senderId);
                this.emit('user_left', senderId);
            }
        }
    }

    // Audio Engine (Shared Logic - Should ideally be a mixin but copying for independence)
    async startAudio() {
        if (this.micStream) return;
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micStream = stream;
        const source = this.audioCtx.createMediaStreamSource(stream);
        const processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                let s = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this._send(MessageType.VoiceData, new Uint8Array(pcm.buffer));
        };
        source.connect(processor); processor.connect(this.audioCtx.destination);
        this.processor = processor; this.micSource = source;
    }

    stopAudio() {
        if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
        if (this.processor) { this.processor.disconnect(); this.micSource.disconnect(); this.processor = null; }
    }

    _playAudio(u8bytes) {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const int16 = new Int16Array(u8bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
        const buf = this.audioCtx.createBuffer(1, float32.length, 16000);
        buf.copyToChannel(float32, 0);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf; src.connect(this.audioCtx.destination); src.start();
    }
}

export class AdaTPPhone extends AdaTPBase {
    constructor(url, options) {
        super(url, options);
        this.callState = "IDLE";
        this.currentRoom = null;
        this.signalingRoom = "global_signaling";
        this.audioCtx = null;
        this.micStream = null;

        // Auto-ping
        this.lastPingStart = 0;
        setInterval(() => this.ping(), 2000);
    }

    ping() {
        this.lastPingStart = Date.now();
        this._send(MessageType.TextMessage, "SYS:PING");
    }

    // --- API ---
    init() {
        this.connect().then(() => {
            this._send(MessageType.JoinRoom, this.signalingRoom);
        });
    }

    call(targetId) {
        if (this.callState !== "IDLE") return;
        const room = `room_${Date.now()}`;
        this.pendingRoom = room;

        this._send(MessageType.TextMessage, `INVITE:${targetId}:${room}`);
        this.callState = "DIALING";
        this.emit('dialing', targetId);
    }

    answer() {
        if (this.callState !== "INCOMING") return;

        this._send(MessageType.TextMessage, `ACCEPT:${this.pendingRoom}`);
        this._joinAndStart(this.pendingRoom);
    }

    reject() {
        if (this.pendingRoom) this._send(MessageType.TextMessage, `REJECT:${this.pendingRoom}`);
        this._reset();
        this.emit('ended', 'Rejected');
    }

    hangup() {
        if (this.currentRoom) this._send(MessageType.TextMessage, "BYE");
        this._reset();
        this.emit('ended', 'Ended');
    }

    toggleMute() {
        if (this.micStream) {
            const t = this.micStream.getAudioTracks()[0];
            t.enabled = !t.enabled;
            return !t.enabled;
        }
        return false;
    }

    // --- INTERNAL ---
    _joinAndStart(room) {
        this._send(MessageType.JoinRoom, room);
        this.currentRoom = room;
        this.callState = "CONNECTED";
        this.emit('connected');
        this.startAudio();
    }

    _reset() {
        this.stopAudio();
        this.callState = "IDLE";
        this.currentRoom = null;
        this.pendingRoom = null;
        // Return to signaling
        setTimeout(() => this._send(MessageType.JoinRoom, this.signalingRoom), 300);
    }

    handlePacket(p, senderId) {
        const isMe = senderId === this.getMyId();

        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);

            // Ping Logic
            if (isMe && txt === "SYS:PING") {
                this.emit('network_quality', Date.now() - this.lastPingStart);
                return;
            }
            if (isMe) return;

            // Signaling Logic
            if (txt.startsWith("INVITE:")) {
                const parts = txt.split(':');
                if (parts[1] === this.getMyId().substring(0, 6)) {
                    if (this.callState !== "IDLE") {
                        this._send(MessageType.TextMessage, `BUSY:${parts[2]}`);
                    } else {
                        this.pendingRoom = parts[2];
                        this.callState = "INCOMING";
                        this.emit('incoming_call', senderId);
                        this._send(MessageType.TextMessage, `RINGING:${parts[2]}`);
                    }
                }
            }
            else if (txt.startsWith("RINGING:")) {
                if (this.callState === "DIALING" && this.pendingRoom === txt.split(':')[1])
                    this.emit('remote_ringing');
            }
            else if (txt.startsWith("ACCEPT:")) {
                if (this.pendingRoom === txt.split(':')[1])
                    this._joinAndStart(this.pendingRoom);
            }
            else if (txt.startsWith("REJECT:") && this.pendingRoom === txt.split(':')[1]) {
                this._reset(); this.emit('ended', 'Call Declined');
            }
            else if (txt.startsWith("BUSY:") && this.pendingRoom === txt.split(':')[1]) {
                this._reset(); this.emit('ended', 'User Busy');
            }
            else if (txt === "BYE" && this.callState === "CONNECTED") {
                this._reset(); this.emit('ended', 'Remote Ended');
            }
        }
        else if (p.type === MessageType.VoiceData && !isMe) {
            this.emit('voice_activity', senderId);
            this._playAudio(p.payload);
        }
    }

    // Audio Engine
    async startAudio() {
        if (this.micStream) return;
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micStream = stream;
        const source = this.audioCtx.createMediaStreamSource(stream);
        const processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                let s = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this._send(MessageType.VoiceData, new Uint8Array(pcm.buffer));
        };
        source.connect(processor); processor.connect(this.audioCtx.destination);
        this.processor = processor; this.micSource = source;
    }

    stopAudio() {
        if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
        if (this.processor) { this.processor.disconnect(); this.micSource.disconnect(); this.processor = null; }
    }

    _playAudio(u8bytes) {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const int16 = new Int16Array(u8bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
        const buf = this.audioCtx.createBuffer(1, float32.length, 16000);
        buf.copyToChannel(float32, 0);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf; src.connect(this.audioCtx.destination); src.start();
    }
}
