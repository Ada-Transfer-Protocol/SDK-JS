/**
 * AdaTP TypeScript SDK (Modular Architecture)
 * Each class handles a specific domain of the protocol.
 */
declare const MessageType: {
    readonly HandshakeInit: 1;
    readonly AuthRequest: 16;
    readonly AuthSuccess: 19;
    readonly AuthFailure: 20;
    readonly TextMessage: 32;
    readonly FileInit: 48;
    readonly FileChunk: 49;
    readonly FileComplete: 51;
    readonly VoiceData: 68;
    readonly GameState: 80;
    readonly ToolCall: 112;
    readonly ToolResult: 113;
    readonly ToolError: 114;
    readonly VideoData: 147;
    readonly PresenceUpdate: 96;
    readonly JoinRoom: 160;
    readonly RoomJoined: 161;
};
type MessageTypeValue = typeof MessageType[keyof typeof MessageType];
interface ParsedPacket {
    type: MessageTypeValue;
    payload: Uint8Array;
    sessionId: Uint8Array;
}
type EventCallback = (...args: any[]) => void;
type EventMap = Record<string, EventCallback[]>;
declare const ADATP_LOCALES: readonly ["en", "tr", "it", "fr", "de", "zh", "ja", "hi", "ar"];
type AdaTPLocale = typeof ADATP_LOCALES[number];
interface AdaTPOptions {
    autoConnect?: boolean;
    username?: string;
    password?: string;
    /** SDK language for user-facing SDK strings. Default 'en'.
     *  The wire protocol is language-neutral; this is client-side metadata. */
    locale?: AdaTPLocale | string;
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
declare class AdaTPBase {
    protected url: string;
    protected options: AdaTPOptions;
    protected ws: WebSocket | null;
    protected sid: Uint8Array;
    protected events: EventMap;
    protected isConnected: boolean;
    /** Active SDK locale (normalized; falls back to 'en'). */
    locale: string;
    /** True after the server confirmed AuthSuccess. */
    authenticated: boolean;
    constructor(url: string, options?: AdaTPOptions);
    /** Switches the SDK language at runtime (one of ADATP_LOCALES). */
    setLocale(locale: string): void;
    on(event: string, callback: EventCallback): void;
    emit(event: string, ...args: any[]): void;
    connect(username?: string, password?: string): Promise<void>;
    protected _handle(data: ArrayBuffer): void;
    protected handlePacket(_p: ParsedPacket, _senderId: string): void;
    protected _send(type: MessageTypeValue, data: string | Uint8Array): void;
    getMyId(): string;
    disconnect(): void;
}
declare class AdaTPChat extends AdaTPBase {
    join(room: string): void;
    say(text: string): void;
    protected handlePacket(p: ParsedPacket, senderId: string): void;
}
/**
 * Realtime game/state client built on the GameState packet (0x0050).
 * State payloads are opaque to the server; this class JSON-encodes them.
 *
 * ```js
 * const game = new AdaTPGame("ws://127.0.0.1:3000/ws", { username, password });
 * game.join("match-42");
 * game.on('state', (state, senderId) => render(state));
 * game.sendState({ v: 1, game: "tictactoe", state: { board, turn } });
 * ```
 */
declare class AdaTPGame extends AdaTPBase {
    join(room: string): void;
    /** Broadcasts a state object (JSON) or raw bytes to the current room. */
    sendState(state: object | Uint8Array): void;
    say(text: string): void;
    protected handlePacket(p: ParsedPacket, senderId: string): void;
}
declare class AdaTpFileTransfer extends AdaTPBase {
    sendFile(file: File): Promise<void>;
}
declare class AdaTPConference extends AdaTPBase {
    private audio;
    private users;
    constructor(url: string, options?: AdaTPOptions);
    get audioCtx(): AudioContext | null;
    get micStream(): MediaStream | null;
    join(room: string): void;
    leave(): void;
    toggleMute(): boolean;
    protected handlePacket(p: ParsedPacket, senderId: string): void;
    startAudio(): Promise<void>;
    stopAudio(): void;
    getUsers(): Set<string>;
}
type CallState = "IDLE" | "DIALING" | "INCOMING" | "CONNECTED";
declare class AdaTPPhone extends AdaTPBase {
    private audio;
    private callState;
    private currentRoom;
    private pendingRoom;
    private signalingRoom;
    private lastPingStart;
    private pingInterval;
    constructor(url: string, options?: AdaTPOptions);
    get audioCtx(): AudioContext | null;
    get micStream(): MediaStream | null;
    ping(): void;
    init(): void;
    call(targetId: string): void;
    answer(): void;
    reject(): void;
    hangup(): void;
    toggleMute(): boolean;
    private _joinAndStart;
    private _reset;
    protected handlePacket(p: ParsedPacket, senderId: string): void;
    startAudio(): Promise<void>;
    stopAudio(): void;
    getCallState(): CallState;
    disconnect(): void;
}

export { ADATP_LOCALES, AdaTPBase, AdaTPChat, AdaTPConference, AdaTPGame, type AdaTPLocale, type AdaTPOptions, AdaTPPhone, AdaTpFileTransfer, MessageType, type MessageTypeValue };
