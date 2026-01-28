# AdaTP JavaScript SDK

A modern, high-performance WebSocket client SDK for the **Ada Transfer Protocol (AdaTP)**. Designed for building real-time collaboration apps, voice conferences, and file sharing platforms directly in the browser.

## 🚀 Features

*   **Real-time Messaging:** Zero-latency text chat and command dispatch.
*   **Voice Conferencing:** Built-in **Voice Engine** (AudioContext + Auto-Echo Cancellation). No external codecs (Opus/WebRTC) required.
*   **File Transfer:** Chunked binary file uploads with efficient memory usage.
*   **Presence:** Real-time user join/leave events.
*   **Zero Dependencies:** Single file (`adatp.js`), works in any modern browser.

---

## 📦 Installation

Simply download `src/adatp.js` and import it as an ES Module.

```javascript
import { AdaTP } from './path/to/adatp.js';
```

---

## ⚡ Quick Start

### 1. Connect & Login

```javascript
const client = new AdaTP("ws://localhost:3000/ws");

client.on('connect', () => {
    console.log("Connected to Server!");
    client.login("Username", "Password");
    client.join("general");
});

client.connect();
```

### 2. Chat (Send & Receive)

```javascript
// Listen for messages
client.on('message', (text, senderId) => {
    console.log(`${senderId} says: ${text}`);
});

// Send a message
client.say("Hello World!");
```

### 3. Voice Call (Push-to-Talk)

The SDK handles microphone permissions, mixing, and raw audio processing automatically.

```javascript
// Start Talking (Mic On)
await client.startCall();

// Stop Talking (Mic Off)
client.stopCall();

// Listen for others (Automatic Playback)
client.on('voice', (senderId) => {
    console.log(`${senderId} is talking...`);
    // Visual indicators can be updated here
});
```

### 4. File Upload

```javascript
const fileInput = document.getElementById('myFile');
const file = fileInput.files[0];

await client.sendFile(file);
console.log("Upload Sent!");
```

---

## 🛠 API Reference

### `class AdaTP(url)`

| Method | Description |
| :--- | :--- |
| `connect()` | Opens WebSocket connection. |
| `disconnect()` | Closes connection gracefully. |
| `login(user, pass)` | Sends authentication request. |
| `join(roomName)` | Joins a specific room/channel. |
| `say(text)` | Sends a text message to the room. |
| `startCall()` | Requests Mic access and starts streaming audio. |
| `stopCall()` | Stops audio streaming and releases Mic. |
| `sendFile(file)` | Uploads a File object (Browser File API). |

### Events (`client.on(event, cb)`)

| Event | Callback Arguments | Description |
| :--- | :--- | :--- |
| `'connect'` | `()` | Socket connected. |
| `'disconnect'` | `()` | Socket closed. |
| `'message'` | `(text, senderId)` | Text message received. |
| `'voice'` | `(senderId)` | Voice activity detected from a user. |
| `'user_joined'` | `(senderId)` | A new user joined the room. |
| `'user_left'` | `(senderId)` | A user disconnected or left. |

---

## ⚠️ Requirements
*   **HTTPS:** Browsers require HTTPS (or localhost) to access the Microphone (`getUserMedia`).
*   **Modern Browser:** Chrome 80+, Firefox 75+, Safari 13+ (ES Modules support).
