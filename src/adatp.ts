/**
 * AdaTP TypeScript SDK (Modular Architecture)
 * Each class handles a specific domain of the protocol.
 */

// --- CONSTANTS ---
export const MessageType = {
    HandshakeInit: 0x0001,
    AuthRequest: 0x0010,
    AuthSuccess: 0x0013,
    TextMessage: 0x0020,
    FileInit: 0x0030,
    FileChunk: 0x0031,
    FileComplete: 0x0033,
    VoiceData: 0x0044,
    VideoData: 0x0053,
    PresenceUpdate: 0x0060,
    JoinRoom: 0x00A0
} as const;

export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

const MAGIC_NUMBER = 0x41444154;

// --- PACKET ---
interface ParsedPacket {
    type: MessageTypeValue;
    payload: Uint8Array;
    sessionId: Uint8Array;
}

class Packet {
    type: MessageTypeValue;
    payload: Uint8Array;
    sessionId: Uint8Array;

    constructor(type: MessageTypeValue, payload: Uint8Array, sessionId: Uint8Array) {
        this.type = type;
        this.payload = payload;
        this.sessionId = sessionId;
    }

    toBytes(): ArrayBuffer {
        const buf = new ArrayBuffer(45 + this.payload.length);
        const v = new DataView(buf);
        v.setUint32(0, MAGIC_NUMBER, true);
        v.setUint8(4, 1);
        v.setUint32(7, this.payload.length, true);
        v.setUint16(19, this.type, true);
        if (this.sessionId) new Uint8Array(buf).set(this.sessionId, 29);
        new Uint8Array(buf).set(this.payload, 45);
        return buf;
    }

    static fromBytes(buf: ArrayBuffer): ParsedPacket | null {
        if (buf.byteLength < 45) return null;
        const v = new DataView(buf);
        if (v.getUint32(0, true) !== MAGIC_NUMBER) return null;
        const len = v.getUint32(7, true);
        const type = v.getUint16(19, true) as MessageTypeValue;
        const sessionId = new Uint8Array(buf.slice(29, 45));
        const payload = new Uint8Array(buf.slice(45, 45 + len));
        return { type, payload, sessionId };
    }
}

// --- EVENT TYPES ---
type EventCallback = (...args: any[]) => void;
type EventMap = Record<string, EventCallback[]>;

// --- OPTIONS INTERFACE ---
export interface AdaTPOptions {
    autoConnect?: boolean;
    username?: string;
    password?: string;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onMessage?: (text: string, senderId: string) => void;
    onUserJoined?: (senderId: string) => void;
    onUserLeft?: (senderId: string) => void;
    onIncomingCall?: (senderId: string) => void;
    onDialing?: (targetId: string) => void;
    onRemoteRinging?: () => void;
    onConnected?: () => void;
    onEnded?: (reason: string) => void;
    onVoiceActivity?: (senderId: string) => void;
    onNetworkQuality?: (latency: number) => void;
    onProgress?: (percent: number) => void;
    onComplete?: () => void;
    onJoined?: (room: string) => void;
    onLeft?: () => void;
    onMuteChanged?: (senderId: string, isMuted: boolean) => void;
}

// ==========================================
// 1. BASE CLIENT (Shared Core)
// ==========================================
export class AdaTPBase {
    protected url: string;
    protected options: AdaTPOptions;
    protected ws: WebSocket | null = null;
    protected sid: Uint8Array;
    protected events: EventMap = {};
    protected isConnected: boolean = false;

    constructor(url: string, options: AdaTPOptions = {}) {
        this.url = url;
        this.options = options;
        this.sid = new Uint8Array(16);
        crypto.getRandomValues(this.sid);

        // Auto-bind events from options
        Object.keys(options).forEach(key => {
            const handler = (options as any)[key];
            if (key.startsWith('on') && typeof handler === 'function') {
                let eventName = key.substring(2).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toLowerCase();
                if (eventName.startsWith('_')) eventName = eventName.substring(1);
                this.on(eventName, handler);
            }
        });

        if (options.autoConnect !== false) {
            setTimeout(() => this.connect(options.username, options.password), 10);
        }
    }

    on(event: string, callback: EventCallback): void {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
    }

    emit(event: string, ...args: any[]): void {
        (this.events[event] || []).forEach(cb => cb(...args));
    }

    connect(username: string = "User", password: string = "pass"): Promise<void> {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            if (this.ws) this.ws.close();
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = "arraybuffer";

            this.ws.onopen = () => {
                this._send(MessageType.AuthRequest, JSON.stringify({ username, password }));
                this.isConnected = true;
                this.emit('connect');
                resolve();
            };

            this.ws.onmessage = (e: MessageEvent) => this._handle(e.data as ArrayBuffer);
            this.ws.onclose = () => {
                this.isConnected = false;
                this.emit('disconnect');
            };
            this.ws.onerror = (e) => reject(e);
        });
    }

    protected _handle(data: ArrayBuffer): void {
        const p = Packet.fromBytes(data);
        if (!p) return;
        const senderId = [...p.sessionId].map(b => b.toString(16).padStart(2, '0')).join('');
        this.handlePacket(p, senderId);
    }

    protected handlePacket(_p: ParsedPacket, _senderId: string): void {
        // Override me
    }

    protected _send(type: MessageTypeValue, data: string | Uint8Array): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = (typeof data === 'string') ? new TextEncoder().encode(data) : data;
        this.ws.send(new Packet(type, payload, this.sid).toBytes());
    }

    getMyId(): string {
        return [...this.sid].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}

// ==========================================
// 2. CHAT CLIENT (Text & Rooms)
// ==========================================
export class AdaTPChat extends AdaTPBase {
    join(room: string): void {
        this._send(MessageType.JoinRoom, room);
    }

    say(text: string): void {
        this._send(MessageType.TextMessage, text);
    }

    protected handlePacket(p: ParsedPacket, senderId: string): void {
        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);
            if (txt.includes("INVITE:") || txt.includes("BYE")) return;
            this.emit('message', txt, senderId);
        } else if (p.type === MessageType.PresenceUpdate) {
            const status = new TextDecoder().decode(p.payload);
            this.emit(status === "LEAVE" ? 'user_left' : 'user_joined', senderId);
        }
    }
}

// ==========================================
// 3. FILE TRANSFER CLIENT
// ==========================================
export class AdaTpFileTransfer extends AdaTPBase {
    async sendFile(file: File): Promise<void> {
        const id = new Uint8Array(16);
        crypto.getRandomValues(id);
        const meta = JSON.stringify({ id: [...id].join(''), name: file.name, size: file.size });

        this._send(MessageType.FileInit, meta);

        const buf = await file.arrayBuffer();
        const u8 = new Uint8Array(buf);
        const CHUNK = 16000;

        for (let i = 0; i < u8.length; i += CHUNK) {
            const chunk = u8.slice(i, i + CHUNK);
            const pay = new Uint8Array(16 + chunk.length);
            pay.set(id, 0);
            pay.set(chunk, 16);
            if (this.ws) {
                this.ws.send(new Packet(MessageType.FileChunk, pay, this.sid).toBytes());
            }
            await new Promise(r => setTimeout(r, 2));
            this.emit('progress', (i / u8.length) * 100);
        }

        this._send(MessageType.FileComplete, new Uint8Array(id));
        this.emit('complete');
    }
}

// ==========================================
// 4. AUDIO ENGINE
// ==========================================
interface AudioEngine {
    audioCtx: AudioContext | null;
    micStream: MediaStream | null;
    processor: ScriptProcessorNode | null;
    micSource: MediaStreamAudioSourceNode | null;
}

function createAudioEngine(): AudioEngine {
    return { audioCtx: null, micStream: null, processor: null, micSource: null };
}

async function startAudio(engine: AudioEngine, sendCallback: (type: MessageTypeValue, data: Uint8Array) => void): Promise<void> {
    if (engine.micStream) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!engine.audioCtx) {
        engine.audioCtx = new AudioContextClass({ sampleRate: 16000 });
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    engine.micStream = stream;

    const source = engine.audioCtx.createMediaStreamSource(stream);
    const processor = engine.audioCtx.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        sendCallback(MessageType.VoiceData, new Uint8Array(pcm.buffer));
    };

    source.connect(processor);
    processor.connect(engine.audioCtx.destination);
    engine.processor = processor;
    engine.micSource = source;
}

function stopAudio(engine: AudioEngine): void {
    if (engine.micStream) {
        engine.micStream.getTracks().forEach(t => t.stop());
        engine.micStream = null;
    }
    if (engine.processor) {
        engine.processor.disconnect();
        engine.micSource?.disconnect();
        engine.processor = null;
    }
}

function playAudio(engine: AudioEngine, u8bytes: Uint8Array): void {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!engine.audioCtx) {
        engine.audioCtx = new AudioContextClass({ sampleRate: 16000 });
    }

    const int16 = new Int16Array(u8bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
    }

    const buf = engine.audioCtx.createBuffer(1, float32.length, 16000);
    buf.copyToChannel(float32, 0);
    const src = engine.audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(engine.audioCtx.destination);
    src.start();
}

// ==========================================
// 5. CONFERENCE CLIENT (Group Calls)
// ==========================================
export class AdaTPConference extends AdaTPBase {
    private audio: AudioEngine;
    private users: Set<string> = new Set();

    constructor(url: string, options: AdaTPOptions = {}) {
        super(url, options);
        this.audio = createAudioEngine();
    }

    get audioCtx(): AudioContext | null { return this.audio.audioCtx; }
    get micStream(): MediaStream | null { return this.audio.micStream; }

    join(room: string): void {
        this._send(MessageType.JoinRoom, room);
        this.startAudio();
        this.emit('joined', room);
        setTimeout(() => this._send(MessageType.TextMessage, "DISCOVERY:WHO_IS_HERE"), 500);
    }

    leave(): void {
        this.stopAudio();
        this._send(MessageType.TextMessage, "DISCOVERY:I_AM_LEAVING");
        setTimeout(() => {
            this._send(MessageType.JoinRoom, "lobby");
            this.emit('left');
        }, 100);
    }

    toggleMute(): boolean {
        if (this.audio.micStream) {
            const t = this.audio.micStream.getAudioTracks()[0];
            t.enabled = !t.enabled;
            const isMuted = !t.enabled;
            this._send(MessageType.TextMessage, isMuted ? "MUTE:ON" : "MUTE:OFF");
            return isMuted;
        }
        return false;
    }

    protected handlePacket(p: ParsedPacket, senderId: string): void {
        const isMe = senderId === this.getMyId();

        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);

            if (txt === "DISCOVERY:WHO_IS_HERE") {
                this._send(MessageType.TextMessage, "DISCOVERY:I_AM_HERE");
                if (this.audio.micStream && !this.audio.micStream.getAudioTracks()[0].enabled) {
                    setTimeout(() => this._send(MessageType.TextMessage, "MUTE:ON"), 100);
                }
                if (!isMe) { this.users.add(senderId); this.emit('user_joined', senderId); }
            } else if (txt === "DISCOVERY:I_AM_HERE") {
                if (!isMe && !this.users.has(senderId)) {
                    this.users.add(senderId);
                    this.emit('user_joined', senderId);
                }
            } else if (txt === "DISCOVERY:I_AM_LEAVING") {
                if (!isMe) { this.users.delete(senderId); this.emit('user_left', senderId); }
            } else if (txt === "MUTE:ON") {
                this.emit('mute_changed', senderId, true);
            } else if (txt === "MUTE:OFF") {
                this.emit('mute_changed', senderId, false);
            }
        } else if (p.type === MessageType.VoiceData && !isMe) {
            if (!this.users.has(senderId)) {
                this.users.add(senderId);
                this.emit('user_joined', senderId);
            }
            this.emit('voice_activity', senderId);
            playAudio(this.audio, p.payload);
        } else if (p.type === MessageType.PresenceUpdate) {
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

    async startAudio(): Promise<void> {
        await startAudio(this.audio, (type, data) => this._send(type, data));
    }

    stopAudio(): void { stopAudio(this.audio); }
    getUsers(): Set<string> { return this.users; }
}

// ==========================================
// 6. PHONE CLIENT (1:1 Calls with Signaling)
// ==========================================
type CallState = "IDLE" | "DIALING" | "INCOMING" | "CONNECTED";

export class AdaTPPhone extends AdaTPBase {
    private audio: AudioEngine;
    private callState: CallState = "IDLE";
    private currentRoom: string | null = null;
    private pendingRoom: string | null = null;
    private signalingRoom: string = "global_signaling";
    private lastPingStart: number = 0;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(url: string, options: AdaTPOptions = {}) {
        super(url, options);
        this.audio = createAudioEngine();
        this.pingInterval = setInterval(() => this.ping(), 2000);
    }

    get audioCtx(): AudioContext | null { return this.audio.audioCtx; }
    get micStream(): MediaStream | null { return this.audio.micStream; }

    ping(): void {
        this.lastPingStart = Date.now();
        this._send(MessageType.TextMessage, "SYS:PING");
    }

    init(): void {
        this.connect().then(() => {
            this._send(MessageType.JoinRoom, this.signalingRoom);
        });
    }

    call(targetId: string): void {
        if (this.callState !== "IDLE") return;
        const room = `room_${Date.now()}`;
        this.pendingRoom = room;
        this._send(MessageType.TextMessage, `INVITE:${targetId}:${room}`);
        this.callState = "DIALING";
        this.emit('dialing', targetId);
    }

    answer(): void {
        if (this.callState !== "INCOMING") return;
        this._send(MessageType.TextMessage, `ACCEPT:${this.pendingRoom}`);
        this._joinAndStart(this.pendingRoom!);
    }

    reject(): void {
        if (this.pendingRoom) this._send(MessageType.TextMessage, `REJECT:${this.pendingRoom}`);
        this._reset();
        this.emit('ended', 'Rejected');
    }

    hangup(): void {
        if (this.currentRoom) this._send(MessageType.TextMessage, "BYE");
        this._reset();
        this.emit('ended', 'Ended');
    }

    toggleMute(): boolean {
        if (this.audio.micStream) {
            const t = this.audio.micStream.getAudioTracks()[0];
            t.enabled = !t.enabled;
            return !t.enabled;
        }
        return false;
    }

    private _joinAndStart(room: string): void {
        this._send(MessageType.JoinRoom, room);
        this.currentRoom = room;
        this.callState = "CONNECTED";
        this.emit('connected');
        this.startAudio();
    }

    private _reset(): void {
        this.stopAudio();
        this.callState = "IDLE";
        this.currentRoom = null;
        this.pendingRoom = null;
        setTimeout(() => this._send(MessageType.JoinRoom, this.signalingRoom), 300);
    }

    protected handlePacket(p: ParsedPacket, senderId: string): void {
        const isMe = senderId === this.getMyId();

        if (p.type === MessageType.TextMessage) {
            const txt = new TextDecoder().decode(p.payload);

            if (isMe && txt === "SYS:PING") {
                this.emit('network_quality', Date.now() - this.lastPingStart);
                return;
            }
            if (isMe) return;

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
            } else if (txt.startsWith("RINGING:")) {
                if (this.callState === "DIALING" && this.pendingRoom === txt.split(':')[1]) {
                    this.emit('remote_ringing');
                }
            } else if (txt.startsWith("ACCEPT:")) {
                if (this.pendingRoom === txt.split(':')[1]) {
                    this._joinAndStart(this.pendingRoom!);
                }
            } else if (txt.startsWith("REJECT:") && this.pendingRoom === txt.split(':')[1]) {
                this._reset();
                this.emit('ended', 'Call Declined');
            } else if (txt.startsWith("BUSY:") && this.pendingRoom === txt.split(':')[1]) {
                this._reset();
                this.emit('ended', 'User Busy');
            } else if (txt === "BYE" && this.callState === "CONNECTED") {
                this._reset();
                this.emit('ended', 'Remote Ended');
            }
        } else if (p.type === MessageType.VoiceData && !isMe) {
            this.emit('voice_activity', senderId);
            playAudio(this.audio, p.payload);
        }
    }

    async startAudio(): Promise<void> {
        await startAudio(this.audio, (type, data) => this._send(type, data));
    }

    stopAudio(): void { stopAudio(this.audio); }
    getCallState(): CallState { return this.callState; }

    override disconnect(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        super.disconnect();
    }
}