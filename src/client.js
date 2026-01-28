import { Packet, MessageType } from './packet.js';

export class AdaTPClient {
    constructor(url) {
        this.url = url;
        this.ws = null;

        // Generate a random Session ID for this client (16 bytes)
        this.sessionId = new Uint8Array(16);
        crypto.getRandomValues(this.sessionId);

        this.onMessage = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.onVoiceData = null;

        // Audio Context for RAW Capture
        this.audioCtx = null;
        this.processor = null;
        this.source = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = "arraybuffer";
            this.ws.onopen = () => { if (this.onConnect) this.onConnect(); resolve(); };
            this.ws.onmessage = (e) => this.handlePacket(Packet.fromBytes(e.data));
            this.ws.onerror = (e) => reject(e);
            this.ws.onclose = () => { if (this.onDisconnect) this.onDisconnect(); };
        });
    }

    handlePacket(pkt) {
        if (pkt.msgType === MessageType.VoiceData) {
            // Pass Full Packet to access Sender ID
            if (this.onVoiceData) this.onVoiceData(pkt);
        } else if (pkt.msgType === MessageType.PresenceUpdate) {
            // Forward presence updates (Join/Leave)
            if (this.onPresence) this.onPresence(pkt);
        } else if (pkt.msgType === MessageType.TextMessage || pkt.msgType === MessageType.AuthSuccess) {
            const text = new TextDecoder().decode(pkt.payload);
            if (this.onMessage) this.onMessage(text);
        }
    }

    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(packet.toBytes());
    }

    authenticate(u, p) {
        this.send(new Packet(MessageType.AuthRequest, new TextEncoder().encode(JSON.stringify({ username: u, password: p })), this.sessionId));
    }

    joinRoom(r) {
        this.send(new Packet(MessageType.JoinRoom, new TextEncoder().encode(r), this.sessionId));
    }

    // --- RAW AUDIO LOGIC ---

    async startVoiceCall() {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); // Low sample rate for speed
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.source = this.audioCtx.createMediaStreamSource(stream);
            // BufferSize 2048 = ~128ms latency at 16kHz
            this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);

                // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
                const int16Buffer = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Send raw Int16 bytes
                this.sendVoiceData(new Uint8Array(int16Buffer.buffer));
            };

            this.source.connect(this.processor);
            this.processor.connect(this.audioCtx.destination); // Needed for Chrome to fire event

            console.log("AdaTP: Mic Started (RAW PCM 16kHz)");
        } catch (e) {
            console.error("Mic Error", e);
        }
    }

    stopVoiceCall() {
        if (this.processor) {
            this.processor.disconnect();
            this.source.disconnect();
            this.processor = null;
            this.source = null;
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(); // Sends Close frame immediately
            this.ws = null;
        }
        this.stopVoiceCall();
    }

    sendVoiceData(bytes) {
        this.send(new Packet(MessageType.VoiceData, bytes, this.sessionId));
    }

    // Helper to get my own Session ID as Hex String
    getMyId() {
        return [...this.sessionId].map(x => x.toString(16).padStart(2, '0')).join('');
    }
}
