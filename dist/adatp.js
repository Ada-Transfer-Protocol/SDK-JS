// src/adatp.ts
var MessageType = {
  HandshakeInit: 1,
  AuthRequest: 16,
  AuthSuccess: 19,
  AuthFailure: 20,
  TextMessage: 32,
  FileInit: 48,
  FileChunk: 49,
  FileComplete: 51,
  VoiceData: 68,
  GameState: 80,
  ToolCall: 112,
  ToolResult: 113,
  ToolError: 114,
  VideoData: 147,
  PresenceUpdate: 96,
  JoinRoom: 160,
  RoomJoined: 161
};
var MAGIC_NUMBER = 1094992212;
var Packet = class {
  constructor(type, payload, sessionId) {
    this.type = type;
    this.payload = payload;
    this.sessionId = sessionId;
  }
  toBytes() {
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
  static fromBytes(buf) {
    if (buf.byteLength < 45) return null;
    const v = new DataView(buf);
    if (v.getUint32(0, true) !== MAGIC_NUMBER) return null;
    const len = v.getUint32(7, true);
    const type = v.getUint16(19, true);
    const sessionId = new Uint8Array(buf.slice(29, 45));
    const payload = new Uint8Array(buf.slice(45, 45 + len));
    return { type, payload, sessionId };
  }
};
var AdaTPBase = class {
  constructor(url, options = {}) {
    this.ws = null;
    this.events = {};
    this.isConnected = false;
    /** True after the server confirmed AuthSuccess. */
    this.authenticated = false;
    this.url = url;
    this.options = options;
    this.sid = new Uint8Array(16);
    crypto.getRandomValues(this.sid);
    Object.keys(options).forEach((key) => {
      const handler = options[key];
      if (key.startsWith("on") && typeof handler === "function") {
        let eventName = key.substring(2).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
        if (eventName.startsWith("_")) eventName = eventName.substring(1);
        this.on(eventName, handler);
      }
    });
    if (options.autoConnect !== false) {
      setTimeout(() => this.connect(options.username, options.password), 10);
    }
  }
  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }
  emit(event, ...args) {
    (this.events[event] || []).forEach((cb) => cb(...args));
  }
  connect(username = "User", password = "pass") {
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
        this.emit("connect");
        resolve();
      };
      this.ws.onmessage = (e) => this._handle(e.data);
      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit("disconnect");
      };
      this.ws.onerror = (e) => reject(e);
    });
  }
  _handle(data) {
    const p = Packet.fromBytes(data);
    if (!p) return;
    const senderId = [...p.sessionId].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (p.type === MessageType.AuthSuccess) {
      let identity = null;
      try {
        identity = JSON.parse(new TextDecoder().decode(p.payload));
      } catch {
      }
      this.authenticated = true;
      this.emit("auth", identity);
      return;
    }
    if (p.type === MessageType.AuthFailure) {
      const reason = new TextDecoder().decode(p.payload);
      this.authenticated = false;
      console.warn("[AdaTP] Authentication rejected by server:", reason);
      this.emit("auth_failure", reason);
      return;
    }
    if (p.type === MessageType.RoomJoined) {
      this.emit("room_joined", new TextDecoder().decode(p.payload));
      return;
    }
    this.handlePacket(p, senderId);
  }
  handlePacket(_p, _senderId) {
  }
  _send(type, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.ws.send(new Packet(type, payload, this.sid).toBytes());
  }
  getMyId() {
    return [...this.sid].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
};
var AdaTPChat = class extends AdaTPBase {
  join(room) {
    this._send(MessageType.JoinRoom, room);
  }
  say(text) {
    this._send(MessageType.TextMessage, text);
  }
  handlePacket(p, senderId) {
    if (p.type === MessageType.TextMessage) {
      const txt = new TextDecoder().decode(p.payload);
      if (txt.includes("INVITE:") || txt.includes("BYE")) return;
      this.emit("message", txt, senderId);
    } else if (p.type === MessageType.PresenceUpdate) {
      const status = new TextDecoder().decode(p.payload);
      this.emit(status === "LEAVE" ? "user_left" : "user_joined", senderId);
    }
  }
};
var AdaTPGame = class extends AdaTPBase {
  join(room) {
    this._send(MessageType.JoinRoom, room);
  }
  /** Broadcasts a state object (JSON) or raw bytes to the current room. */
  sendState(state) {
    const payload = state instanceof Uint8Array ? state : JSON.stringify(state);
    this._send(MessageType.GameState, payload);
  }
  say(text) {
    this._send(MessageType.TextMessage, text);
  }
  handlePacket(p, senderId) {
    if (p.type === MessageType.GameState) {
      const raw = new TextDecoder().decode(p.payload);
      let state;
      try {
        state = JSON.parse(raw);
      } catch {
        state = p.payload;
      }
      this.emit("state", state, senderId);
    } else if (p.type === MessageType.TextMessage) {
      this.emit("message", new TextDecoder().decode(p.payload), senderId);
    } else if (p.type === MessageType.PresenceUpdate) {
      const status = new TextDecoder().decode(p.payload);
      this.emit(status === "LEAVE" ? "user_left" : "user_joined", senderId);
    }
  }
};
var AdaTpFileTransfer = class extends AdaTPBase {
  async sendFile(file) {
    const id = new Uint8Array(16);
    crypto.getRandomValues(id);
    const meta = JSON.stringify({ id: [...id].join(""), filename: file.name, size: file.size });
    this._send(MessageType.FileInit, meta);
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const CHUNK = 16384;
    for (let i = 0; i < u8.length; i += CHUNK) {
      const chunk = u8.slice(i, i + CHUNK);
      const pay = new Uint8Array(16 + chunk.length);
      pay.set(id, 0);
      pay.set(chunk, 16);
      if (this.ws) {
        this.ws.send(new Packet(MessageType.FileChunk, pay, this.sid).toBytes());
      }
      await new Promise((r) => setTimeout(r, 2));
      this.emit("progress", i / u8.length * 100);
    }
    this._send(MessageType.FileComplete, new Uint8Array(id));
    this.emit("complete");
  }
};
function createAudioEngine() {
  return { audioCtx: null, micStream: null, processor: null, micSource: null };
}
async function startAudio(engine, sendCallback) {
  if (engine.micStream) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!engine.audioCtx) {
    engine.audioCtx = new AudioContextClass({ sampleRate: 16e3 });
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  engine.micStream = stream;
  const source = engine.audioCtx.createMediaStreamSource(stream);
  const processor = engine.audioCtx.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    sendCallback(MessageType.VoiceData, new Uint8Array(pcm.buffer));
  };
  source.connect(processor);
  processor.connect(engine.audioCtx.destination);
  engine.processor = processor;
  engine.micSource = source;
}
function stopAudio(engine) {
  if (engine.micStream) {
    engine.micStream.getTracks().forEach((t) => t.stop());
    engine.micStream = null;
  }
  if (engine.processor) {
    engine.processor.disconnect();
    engine.micSource?.disconnect();
    engine.processor = null;
  }
}
function playAudio(engine, u8bytes) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!engine.audioCtx) {
    engine.audioCtx = new AudioContextClass({ sampleRate: 16e3 });
  }
  const int16 = new Int16Array(u8bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  const buf = engine.audioCtx.createBuffer(1, float32.length, 16e3);
  buf.copyToChannel(float32, 0);
  const src = engine.audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(engine.audioCtx.destination);
  src.start();
}
var AdaTPConference = class extends AdaTPBase {
  constructor(url, options = {}) {
    super(url, options);
    this.users = /* @__PURE__ */ new Set();
    this.audio = createAudioEngine();
  }
  get audioCtx() {
    return this.audio.audioCtx;
  }
  get micStream() {
    return this.audio.micStream;
  }
  join(room) {
    this._send(MessageType.JoinRoom, room);
    this.startAudio();
    this.emit("joined", room);
    setTimeout(() => this._send(MessageType.TextMessage, "DISCOVERY:WHO_IS_HERE"), 500);
  }
  leave() {
    this.stopAudio();
    this._send(MessageType.TextMessage, "DISCOVERY:I_AM_LEAVING");
    setTimeout(() => {
      this._send(MessageType.JoinRoom, "lobby");
      this.emit("left");
    }, 100);
  }
  toggleMute() {
    if (this.audio.micStream) {
      const t = this.audio.micStream.getAudioTracks()[0];
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
        if (this.audio.micStream && !this.audio.micStream.getAudioTracks()[0].enabled) {
          setTimeout(() => this._send(MessageType.TextMessage, "MUTE:ON"), 100);
        }
        if (!isMe) {
          this.users.add(senderId);
          this.emit("user_joined", senderId);
        }
      } else if (txt === "DISCOVERY:I_AM_HERE") {
        if (!isMe && !this.users.has(senderId)) {
          this.users.add(senderId);
          this.emit("user_joined", senderId);
        }
      } else if (txt === "DISCOVERY:I_AM_LEAVING") {
        if (!isMe) {
          this.users.delete(senderId);
          this.emit("user_left", senderId);
        }
      } else if (txt === "MUTE:ON") {
        this.emit("mute_changed", senderId, true);
      } else if (txt === "MUTE:OFF") {
        this.emit("mute_changed", senderId, false);
      }
    } else if (p.type === MessageType.VoiceData && !isMe) {
      if (!this.users.has(senderId)) {
        this.users.add(senderId);
        this.emit("user_joined", senderId);
      }
      this.emit("voice_activity", senderId);
      playAudio(this.audio, p.payload);
    } else if (p.type === MessageType.PresenceUpdate) {
      const status = new TextDecoder().decode(p.payload);
      if (status === "JOIN") {
        this.users.add(senderId);
        this.emit("user_joined", senderId);
      } else {
        this.users.delete(senderId);
        this.emit("user_left", senderId);
      }
    }
  }
  async startAudio() {
    await startAudio(this.audio, (type, data) => this._send(type, data));
  }
  stopAudio() {
    stopAudio(this.audio);
  }
  getUsers() {
    return this.users;
  }
};
var AdaTPPhone = class extends AdaTPBase {
  constructor(url, options = {}) {
    super(url, options);
    this.callState = "IDLE";
    this.currentRoom = null;
    this.pendingRoom = null;
    this.signalingRoom = "global_signaling";
    this.lastPingStart = 0;
    this.pingInterval = null;
    this.audio = createAudioEngine();
    this.pingInterval = setInterval(() => this.ping(), 2e3);
  }
  get audioCtx() {
    return this.audio.audioCtx;
  }
  get micStream() {
    return this.audio.micStream;
  }
  ping() {
    this.lastPingStart = Date.now();
    this._send(MessageType.TextMessage, "SYS:PING");
  }
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
    this.emit("dialing", targetId);
  }
  answer() {
    if (this.callState !== "INCOMING") return;
    this._send(MessageType.TextMessage, `ACCEPT:${this.pendingRoom}`);
    this._joinAndStart(this.pendingRoom);
  }
  reject() {
    if (this.pendingRoom) this._send(MessageType.TextMessage, `REJECT:${this.pendingRoom}`);
    this._reset();
    this.emit("ended", "Rejected");
  }
  hangup() {
    if (this.currentRoom) this._send(MessageType.TextMessage, "BYE");
    this._reset();
    this.emit("ended", "Ended");
  }
  toggleMute() {
    if (this.audio.micStream) {
      const t = this.audio.micStream.getAudioTracks()[0];
      t.enabled = !t.enabled;
      return !t.enabled;
    }
    return false;
  }
  _joinAndStart(room) {
    this._send(MessageType.JoinRoom, room);
    this.currentRoom = room;
    this.callState = "CONNECTED";
    this.emit("connected");
    this.startAudio();
  }
  _reset() {
    this.stopAudio();
    this.callState = "IDLE";
    this.currentRoom = null;
    this.pendingRoom = null;
    setTimeout(() => this._send(MessageType.JoinRoom, this.signalingRoom), 300);
  }
  handlePacket(p, senderId) {
    const isMe = senderId === this.getMyId();
    if (p.type === MessageType.TextMessage) {
      const txt = new TextDecoder().decode(p.payload);
      if (isMe && txt === "SYS:PING") {
        this.emit("network_quality", Date.now() - this.lastPingStart);
        return;
      }
      if (isMe) return;
      if (txt.startsWith("INVITE:")) {
        const parts = txt.split(":");
        if (parts[1] === this.getMyId().substring(0, 6)) {
          if (this.callState !== "IDLE") {
            this._send(MessageType.TextMessage, `BUSY:${parts[2]}`);
          } else {
            this.pendingRoom = parts[2];
            this.callState = "INCOMING";
            this.emit("incoming_call", senderId);
            this._send(MessageType.TextMessage, `RINGING:${parts[2]}`);
          }
        }
      } else if (txt.startsWith("RINGING:")) {
        if (this.callState === "DIALING" && this.pendingRoom === txt.split(":")[1]) {
          this.emit("remote_ringing");
        }
      } else if (txt.startsWith("ACCEPT:")) {
        if (this.pendingRoom === txt.split(":")[1]) {
          this._joinAndStart(this.pendingRoom);
        }
      } else if (txt.startsWith("REJECT:") && this.pendingRoom === txt.split(":")[1]) {
        this._reset();
        this.emit("ended", "Call Declined");
      } else if (txt.startsWith("BUSY:") && this.pendingRoom === txt.split(":")[1]) {
        this._reset();
        this.emit("ended", "User Busy");
      } else if (txt === "BYE" && this.callState === "CONNECTED") {
        this._reset();
        this.emit("ended", "Remote Ended");
      }
    } else if (p.type === MessageType.VoiceData && !isMe) {
      this.emit("voice_activity", senderId);
      playAudio(this.audio, p.payload);
    }
  }
  async startAudio() {
    await startAudio(this.audio, (type, data) => this._send(type, data));
  }
  stopAudio() {
    stopAudio(this.audio);
  }
  getCallState() {
    return this.callState;
  }
  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    super.disconnect();
  }
};
export {
  AdaTPBase,
  AdaTPChat,
  AdaTPConference,
  AdaTPGame,
  AdaTPPhone,
  AdaTpFileTransfer,
  MessageType
};
