# AdaTP JavaScript SDK (v2.1)

**Ada Transfer Protocol (AdaTP)** is a next-generation real-time communication protocol designed for low-latency voice, video, and data transfer. This SDK is written in **TypeScript** and provides a modular, low-code interface to integrate AdaTP into any web application.

> **Key Features:**
> *   🚀 **Low-Latency & High Performance**: Optimized binary protocol over WebSocket.
> *   🧩 **Modular Architecture**: Separate modules for Phone, Chat, Conference, and File Transfer.
> *   ⚡ **Low-Code Integration**: Initialize and start using with a simple configuration object.
> *   🔒 **Secure & Private**: Built-in authentication and room management.
> *   🔈 **High-Quality Audio**: 16kHz PCM Audio Engine with VAD.
> *   🦾 **TypeScript Support**: Fully typed for better development experience.

---

## 🔒 Transport security (and why there's no protocol-v2 handshake here)

This browser SDK is **plaintext-over-`wss`**: it does not run AdaTP's own
session encryption and instead delegates confidentiality **and** server
authentication to **TLS** (`wss://`), which browsers always have. Always connect
over `wss://` in production.

AdaTP **protocol v2** (the authenticated, Ed25519-signed handshake with key
pinning) exists for peers that *cannot* run TLS — e.g. constrained devices. A
browser can always use TLS, so v2 is **intentionally not implemented in this
SDK** (it would add a full crypto stack for no security gain over `wss://`). The
server and the Node/C/Python/PHP SDKs implement v2 end-to-end; see
[the spec](https://github.com/Ada-Transfer-Protocol/Server/blob/main/docs/spec/12-authenticated-handshake.md).

## 🛠 Prerequisites & Installation

**Prerequisites:**
- Node.js (v18+)
- NPM

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Build the SDK:**
   The SDK is written in TypeScript. You need to build it to generate the `dist` folder.
   ```bash
   npm run build
   ```
   This will create `dist/adatp.js` (ESM), `dist/client.js`, and type definitions (`.d.ts`).

3. **Running Examples:**
   We recommend using a simple HTTP server to serve the examples.
   ```bash
   npx serve .
   ```
   Then open `http://localhost:3000` in your browser.

---

## 📦 Usage

You can import the SDK directly from the `dist` folder in your project or HTML files.

```html
<script type="module">
    import { AdaTPPhone, AdaTPChat, AdaTPConference } from './dist/adatp.js';

    const client = new AdaTPChat("ws://localhost:8080/ws", {
        username: "MyUser",
        onMessage: (msg) => console.log(msg)
    });
</script>
```

---

## 📱 1. AdaTP Pro Phone (1-on-1 Calls)

Best for softphones, customer support lines, and private voice calls. Handles signaling (`INVITE`, `RINGING`, `BUSY`), audio streams, and connection quality monitoring automatically.

### **Quick Start**

```javascript
const phone = new AdaTPPhone("ws://127.0.0.1:3000/ws", {
    username: "Agent007", 
    
    // --- Lifecycle Events ---
    onConnect: ()       => console.log("Phone Online 🟢"),
    onDisconnect: ()    => console.log("Phone Offline 🔴"),
    
    // --- Call Events ---
    onIncomingCall: (id) => {
        console.log(`Incoming call from ${id}`);
        // Show UI: "Answer" or "Reject"
    },
    
    onDialing: (id)      => console.log(`Calling ${id}...`),
    onRemoteRinging: ()  => console.log("User is ringing..."),
    
    onConnected: () => {
        console.log("Call Established! 📞");
        // Audio starts automatically
    },
    
    onEnded: (reason) => console.log(`Call Ended: ${reason}`),
    
    // --- Quality & Status ---
    onNetworkQuality: (ms) => console.log(`Ping: ${ms}ms`),
    onVoiceActivity: ()    => console.log("User is speaking 🗣️")
});

// --- Actions ---
phone.call("User123");  // Start a call
phone.answer();         // Answer incoming
phone.reject();         // Reject incoming
phone.hangup();         // End call
phone.toggleMute();     // Mute/Unmute Mic
```

---

## 💬 2. AdaTP Chat (Real-time Messaging)

Best for support chats, group channels, and instant messaging. Supports private rooms (`join("room")`) and direct messages.

### **Quick Start**

```javascript
const chat = new AdaTPChat("ws://127.0.0.1:3000/ws", {
    username: "SupportBot",
    
    onConnect: () => {
        chat.join("general"); // Auto-join room
    },
    
    onMessage: (text, senderId) => {
        console.log(`[${senderId}]: ${text}`);
    },
    
    onUserJoined: (id) => console.log(`${id} joined the room.`),
    onUserLeft: (id)   => console.log(`${id} left the room.`)
});

// --- Actions ---
chat.say("Hello World!");  // Send to current room
chat.join("random");       // Switch room
```

---

## 👥 3. AdaTP Conference (Group Audio)

Best for meetings, stand-ups, and voice channels. Features automatic **P2P Discovery** (who is in the room) and **Mute Synchronization**.

### **Quick Start**

```javascript
const conf = new AdaTPConference("ws://127.0.0.1:3000/ws", {
    username: "TeamLead",
    
    onConnect: () => console.log("Connected to Server"),
    
    onJoined: (room) => console.log(`Joined #${room}`),
    
    // --- Participant Management ---
    onUserJoined: (id) => addParticipantCard(id),
    onUserLeft: (id)   => removeParticipantCard(id),
    
    // --- Real-time State ---
    onMuteChanged: (id, isMuted) => {
         // Show/Hide Mute Icon on User Card
         console.log(`User ${id} is ${isMuted ? 'muted' : 'unmuted'}`);
    },
    
    onVoiceActivity: (id) => highlightUser(id)
});

// --- Actions ---
conf.join("daily-standup"); // Join audio room
conf.toggleMute();          // Mute self & broadcast state
conf.leave();               // Leave room & notify others
```

---

## 📂 4. File Transfer (Binaries)

Reliable file streaming over AdaTP.

```javascript
import { AdaTpFileTransfer } from './dist/adatp.js';

const client = new AdaTpFileTransfer("ws://127.0.0.1:3000/ws");

// Send File
// client.sendFile(fileInput.files[0]);

// Receive Progress
client.on('progress', (pct) => console.log(`Upload: ${pct}%`));
client.on('complete', ()    => console.log("Transfer Done!"));
```

---

## License

MIT License. Ada Transfer Protocol Team.

## Language / locale

The SDK takes a `locale` option for its user-facing strings (client-side
metadata — the wire protocol is language-neutral). Default `en`; supported:
`en tr it fr de zh ja hi ar`.

```js
const chat = new AdaTPChat(url, { username, password, locale: 'tr' });
chat.setLocale('de'); // switch at runtime
```
