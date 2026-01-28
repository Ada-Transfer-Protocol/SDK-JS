export const MAGIC_NUMBER = 0x41444154; // "ADAT"

export const MessageType = {
    HandshakeInit: 0x0001,
    HandshakeResponse: 0x0002,
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
};

export const PacketFlags = {
    Encrypted: 0x0001
};

export class Packet {
    constructor(msgType, payload, sessionId) {
        this.msgType = msgType;
        this.payload = payload; // Uint8Array
        this.sessionId = sessionId; // Uint8Array (16 bytes)
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

        // Magic (Little Endian)
        view.setUint32(0, MAGIC_NUMBER, true);
        // Version
        view.setUint8(4, 1);
        // Flags
        view.setUint16(5, this.flags, true);
        // Length
        view.setUint32(7, this.payload.length, true);
        // Sequence (64-bit)
        view.setBigUint64(11, this.sequence, true);
        // Type
        view.setUint16(19, this.msgType, true);
        // Timestamp
        view.setBigUint64(21, this.timestamp, true);

        // Session ID (16 bytes)
        if (this.sessionId && this.sessionId.length === 16) {
            uint8.set(this.sessionId, 29);
        }

        // Payload
        uint8.set(this.payload, 45);

        return buffer;
    }

    static fromBytes(buffer) {
        const view = new DataView(buffer);
        if (buffer.byteLength < 45) throw new Error("Packet too short");

        const magic = view.getUint32(0, true);
        if (magic !== MAGIC_NUMBER) throw new Error("Invalid magic");

        const length = view.getUint32(7, true);
        const msgType = view.getUint16(19, true);

        // Extract Session ID (Offset 29, 16 bytes)
        const sessionId = new Uint8Array(buffer.slice(29, 29 + 16));

        // Extract Payload
        const payload = new Uint8Array(buffer.slice(45, 45 + length));

        return {
            msgType,
            length,
            sessionId,
            payload
        };
    }
}
