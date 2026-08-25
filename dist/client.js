// src/packet.ts
var MAGIC_NUMBER = 1094992212;
var MessageType = {
  HandshakeInit: 1,
  HandshakeResponse: 2,
  AuthRequest: 16,
  AuthSuccess: 19,
  TextMessage: 32,
  FileInit: 48,
  FileChunk: 49,
  FileComplete: 51,
  VoiceData: 68,
  GameState: 80,
  VideoData: 147,
  PresenceUpdate: 96,
  JoinRoom: 160
};
var Packet = class {
  constructor(msgType, payload, sessionId) {
    this.msgType = msgType;
    this.payload = payload;
    this.sessionId = sessionId;
    this.flags = 0;
    this.sequence = 0n;
    this.timestamp = BigInt(Date.now());
  }
  toBytes() {
    const headerSize = 45;
    const totalSize = headerSize + this.payload.length;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    view.setUint32(0, MAGIC_NUMBER, true);
    view.setUint8(4, 1);
    view.setUint16(5, this.flags, true);
    view.setUint32(7, this.payload.length, true);
    view.setBigUint64(11, this.sequence, true);
    view.setUint16(19, this.msgType, true);
    view.setBigUint64(21, this.timestamp, true);
    if (this.sessionId && this.sessionId.length === 16) {
      uint8.set(this.sessionId, 29);
    }
    uint8.set(this.payload, 45);
    return buffer;
  }
  static fromBytes(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 45) return null;
    const magic = view.getUint32(0, true);
    if (magic !== MAGIC_NUMBER) return null;
    const length = view.getUint32(7, true);
    const msgType = view.getUint16(19, true);
    const sessionId = new Uint8Array(buffer.slice(29, 29 + 16));
    const payload = new Uint8Array(buffer.slice(45, 45 + length));
    return {
      msgType,
      length,
      sessionId,
      payload
    };
  }
};

// src/client.ts
var AdaTPClient = class {
  constructor(url) {
    this.ws = null;
    // Audio Context for RAW Capture
    this.audioCtx = null;
    this.processor = null;
    this.source = null;
    // Event Handlers
    this.onMessage = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onVoiceData = null;
    this.onPresence = null;
    this.url = url;
    this.sessionId = new Uint8Array(16);
    crypto.getRandomValues(this.sessionId);
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => {
        if (this.onConnect) this.onConnect();
        resolve();
      };
      this.ws.onmessage = (e) => {
        const packet = Packet.fromBytes(e.data);
        if (packet) this.handlePacket(packet);
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => {
        if (this.onDisconnect) this.onDisconnect();
      };
    });
  }
  handlePacket(pkt) {
    if (pkt.msgType === MessageType.VoiceData) {
      if (this.onVoiceData) this.onVoiceData(pkt);
    } else if (pkt.msgType === MessageType.PresenceUpdate) {
      if (this.onPresence) this.onPresence(pkt);
    } else if (pkt.msgType === MessageType.TextMessage || pkt.msgType === MessageType.AuthSuccess) {
      const text = new TextDecoder().decode(pkt.payload);
      if (this.onMessage) this.onMessage(text);
    }
  }
  send(packet) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packet.toBytes());
    }
  }
  authenticate(username, password) {
    const payload = new TextEncoder().encode(JSON.stringify({ username, password }));
    this.send(new Packet(MessageType.AuthRequest, payload, this.sessionId));
  }
  joinRoom(room) {
    const payload = new TextEncoder().encode(room);
    this.send(new Packet(MessageType.JoinRoom, payload, this.sessionId));
  }
  // --- RAW AUDIO LOGIC ---
  async startVoiceCall() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!this.audioCtx) {
      this.audioCtx = new AudioContextClass({ sampleRate: 16e3 });
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const int16Buffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Buffer[i] = s < 0 ? s * 32768 : s * 32767;
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
  stopVoiceCall() {
    if (this.processor) {
      this.processor.disconnect();
    }
    if (this.source) {
      this.source.disconnect();
    }
    this.processor = null;
    this.source = null;
  }
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopVoiceCall();
  }
  sendVoiceData(bytes) {
    this.send(new Packet(MessageType.VoiceData, bytes, this.sessionId));
  }
  getMyId() {
    return [...this.sessionId].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  getSessionId() {
    return this.sessionId;
  }
};
export {
  AdaTPClient
};
