declare const MessageType: {
    readonly HandshakeInit: 1;
    readonly HandshakeResponse: 2;
    readonly AuthRequest: 16;
    readonly AuthSuccess: 19;
    readonly TextMessage: 32;
    readonly FileInit: 48;
    readonly FileChunk: 49;
    readonly FileComplete: 51;
    readonly VoiceData: 68;
    readonly VideoData: 83;
    readonly PresenceUpdate: 96;
    readonly JoinRoom: 160;
};
type MessageTypeValue = typeof MessageType[keyof typeof MessageType];
interface ParsedPacket {
    msgType: MessageTypeValue;
    length: number;
    sessionId: Uint8Array;
    payload: Uint8Array;
}
declare class Packet {
    msgType: MessageTypeValue;
    payload: Uint8Array;
    sessionId: Uint8Array;
    flags: number;
    sequence: bigint;
    timestamp: bigint;
    constructor(msgType: MessageTypeValue, payload: Uint8Array, sessionId: Uint8Array);
    toBytes(): ArrayBuffer;
    static fromBytes(buffer: ArrayBuffer): ParsedPacket | null;
}

type VoiceDataHandler = (packet: ParsedPacket) => void;
type PresenceHandler = (packet: ParsedPacket) => void;
type MessageHandler = (text: string) => void;
type ConnectionHandler = () => void;
declare class AdaTPClient {
    private url;
    private ws;
    private sessionId;
    private audioCtx;
    private processor;
    private source;
    onMessage: MessageHandler | null;
    onConnect: ConnectionHandler | null;
    onDisconnect: ConnectionHandler | null;
    onVoiceData: VoiceDataHandler | null;
    onPresence: PresenceHandler | null;
    constructor(url: string);
    connect(): Promise<void>;
    private handlePacket;
    send(packet: Packet): void;
    authenticate(username: string, password: string): void;
    joinRoom(room: string): void;
    startVoiceCall(): Promise<void>;
    stopVoiceCall(): void;
    disconnect(): void;
    sendVoiceData(bytes: Uint8Array): void;
    getMyId(): string;
    getSessionId(): Uint8Array;
}

export { AdaTPClient, type ConnectionHandler, type MessageHandler, type PresenceHandler, type VoiceDataHandler };
