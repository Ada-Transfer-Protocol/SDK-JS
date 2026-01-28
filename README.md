# AdaTP JavaScript SDK (v2.0)

**Ada Transfer Protocol (AdaTP)** is a next-generation real-time communication protocol designed for low-latency voice, video, and data transfer. This JavaScript SDK provides a modular, low-code interface to integrate AdaTP into any web application.

> **Key Features:**
> *   🚀 **Low-Latency & High Performance**: Optimized binary protocol over WebSocket.
> *   🧩 **Modular Architecture**: Separate modules for Phone, Chat, Conference, and File Transfer.
> *   ⚡ **Low-Code Integration**: Initialize and start using with a simple configuration object.
> *   🔒 **Secure & Private**: Built-in authentication and room management.
> *   🔈 **High-Quality Audio**: 16kHz PCM Audio Engine with VAD (Voice Activity Detection).

---

## 📦 Installation

Simply copy the `src` folder to your project or import directly.

```javascript
import { AdaTPPhone, AdaTPChat, AdaTPConference } from './src/adatp.js';
```

---

## 📱 1. AdaTP Pro Phone (1-on-1 Calls)

Best for softphones, customer support lines, and private voice calls. Handles signaling (`INVITE`, `RINGING`, `BUSY`), audio streams, and connection quality monitoring automatically.

### **Quick Start**

```javascript
const phone = new AdaTPPhone("ws://127.0.0.1:3000/ws", {
    username: "Agent007", // Auto-login
    
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
import { AdaTpFileTransfer } from './src/adatp.js';

const client = new AdaTpFileTransfer("ws://127.0.0.1:3000/ws");

// Send File
const fileInput = document.getElementById('myFile');
client.sendFile(fileInput.files[0]);

// Receive Progress
client.on('progress', (pct) => console.log(`Upload: ${pct}%`));
client.on('complete', ()    => console.log("Transfer Done!"));
```

---

## 🛠 Advanced Configuration

All classes accept an optional `options` object:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `username` | `string` | `"User"` | Initial username for authentication. |
| `password` | `string` | `"pass"` | Password for authentication. |
| `autoConnect`| `boolean`| `true` | Automatically connect on instantiation. |
| `*` | `function` | `undefined` | Any event handler (e.g. `onConnect`, `onMessage`). |

---

## License

MIT License. Ada Transfer Protocol Team.
