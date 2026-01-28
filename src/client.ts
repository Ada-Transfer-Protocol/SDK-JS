import { Packet, ParsedPacket, MessageType } from './packet';

export type VoiceDataHandler = (packet: ParsedPacket) => void;
export type PresenceHandler = (packet: ParsedPacket) => void;
export type MessageHandler = (text: string) => void;
export type ConnectionHandler = () => void;

export class AdaTPClient {
    private url: string;
    private ws: WebSocket | null = null;
    private sessionId: Uint8Array;

    // Audio Context for RAW Capture
    private audioCtx: AudioContext | null = null;
    private processor: ScriptProcessorNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;

    // Event Handlers
    public onMessage: MessageHandler | null = null;
    public onConnect: ConnectionHandler | null = null;
    public onDisconnect: ConnectionHandler | null = null;
    public onVoiceData: VoiceDataHandler | null = null;
    public onPresence: PresenceHandler | null = null;

    constructor(url: string) {
        this.url = url;

        // Generate a random Session ID for this client (16 bytes)
        this.sessionId = new Uint8Array(16);
        crypto.getRandomValues(this.sessionId);
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = "arraybuffer";

            this.ws.onopen = () => {
                if (this.onConnect) this.onConnect();
                resolve();
            };

            this.ws.onmessage = (e: MessageEvent) => {
                const packet = Packet.fromBytes(e.data as ArrayBuffer);
                if (packet) this.handlePacket(packet);
            };

            this.ws.onerror = (e) => reject(e);

            this.ws.onclose = () => {
                if (this.onDisconnect) this.onDisconnect();
            };
        });
    }

    private handlePacket(pkt: ParsedPacket): void {
        if (pkt.msgType === MessageType.VoiceData) {
            if (this.onVoiceData) this.onVoiceData(pkt);
        } else if (pkt.msgType === MessageType.PresenceUpdate) {
            if (this.onPresence) this.onPresence(pkt);
        } else if (pkt.msgType === MessageType.TextMessage || pkt.msgType === MessageType.AuthSuccess) {
            const text = new TextDecoder().decode(pkt.payload);
            if (this.onMessage) this.onMessage(text);
        }
    }

    send(packet: Packet): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet.toBytes());
        }
    }

    authenticate(username: string, password: string): void {
        const payload = new TextEncoder().encode(JSON.stringify({ username, password }));
        this.send(new Packet(MessageType.AuthRequest, payload, this.sessionId));
    }

    joinRoom(room: string): void {
        const payload = new TextEncoder().encode(room);
        this.send(new Packet(MessageType.JoinRoom, payload, this.sessionId));
    }

    // --- RAW AUDIO LOGIC ---

    async startVoiceCall(): Promise<void> {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;

        if (!this.audioCtx) {
            this.audioCtx = new AudioContextClass({ sampleRate: 16000 });
        }

        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.source = this.audioCtx.createMediaStreamSource(stream);
            this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);

            this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
                const inputData = e.inputBuffer.getChannelData(0);

                // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
                const int16Buffer = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                this.sendVoiceData(new Uint8Array(int16Buffer.buffer));
            };

            this.source.connect(this.processor);
            this.processor.connect(this.audioCtx.destination);

            console.log("AdaTP: Mic Started (RAW PCM 16kHz)");
        } catch (e) {
            console.error("Mic Error", e);
        }
    }

    stopVoiceCall(): void {
        if (this.processor) {
            this.processor.disconnect();
        }
        if (this.source) {
            this.source.disconnect();
        }
        this.processor = null;
        this.source = null;
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.stopVoiceCall();
    }

    sendVoiceData(bytes: Uint8Array): void {
        this.send(new Packet(MessageType.VoiceData, bytes, this.sessionId));
    }

    getMyId(): string {
        return [...this.sessionId].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    getSessionId(): Uint8Array {
        return this.sessionId;
    }
}