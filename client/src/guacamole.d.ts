declare module "guacamole-common-js" {
  export class Status {
    static Code: {
      SUCCESS: number;
      SERVER_ERROR: number;
      UPSTREAM_TIMEOUT: number;
      UPSTREAM_NOT_FOUND: number;
      [key: string]: number;
    };
    constructor(code?: number, message?: string);
    code: number;
    message: string;
  }

  export class Display {
    getElement(): HTMLElement;
    getWidth(): number;
    getHeight(): number;
    scale(factor: number): void;
    showCursor(show: boolean): void;
  }

  export namespace Mouse {
    interface State {
      x: number;
      y: number;
      left: boolean;
      middle: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
    }

    interface Event {
      state: State;
    }

    interface EventTarget {
      onEach(types: string[], listener: (event: Event) => void): void;
      offEach(types: string[], listener: (event: Event) => void): void;
    }

    class Touchscreen implements EventTarget {
      constructor(element: HTMLElement);
      onEach(types: string[], listener: (event: Event) => void): void;
      offEach(types: string[], listener: (event: Event) => void): void;
    }
  }

  export class Mouse implements Mouse.EventTarget {
    constructor(element: HTMLElement);
    onmousedown: ((state: Mouse.State) => void) | null;
    onmouseup: ((state: Mouse.State) => void) | null;
    onmousemove: ((state: Mouse.State) => void) | null;
    onEach(types: string[], listener: (event: Mouse.Event) => void): void;
    offEach(types: string[], listener: (event: Mouse.Event) => void): void;
  }

  export class Keyboard {
    constructor(element: Document | HTMLElement);
    onkeydown: ((keysym: number) => void) | null;
    onkeyup: ((keysym: number) => void) | null;
  }

  export class InputSink {
    focus(): void;
    getElement(): HTMLTextAreaElement;
  }

  export class InputStream {
    index: number;
  }

  export class OutputStream {
    index: number;
  }

  export class StringReader {
    constructor(stream: InputStream);
    ontext: ((text: string) => void) | null;
    onend: (() => void) | null;
  }

  export class StringWriter {
    constructor(stream: OutputStream);
    sendText(text: string): void;
    sendEnd(): void;
  }

  export abstract class Tunnel {
    static State: {
      CONNECTING: number;
      OPEN: number;
      CLOSED: number;
      UNSTABLE: number;
    };
    static INTERNAL_DATA_OPCODE: string;
    state: number;
    uuid: string | null;
    receiveTimeout: number;
    unstableThreshold: number;
    oninstruction: ((opcode: string, parameters: string[]) => void) | null;
    onstatechange: ((state: number) => void) | null;
    onerror: ((status: Status) => void) | null;
    setState(state: number): void;
    setUUID(uuid: string): void;
    isConnected(): boolean;
    connect(data?: string): void;
    disconnect(): void;
    sendMessage(...elements: string[]): void;
  }

  export class WebSocketTunnel extends Tunnel {
    constructor(tunnelURL: string);
  }

  export class Client {
    static State: {
      IDLE: number;
      CONNECTING: number;
      WAITING: number;
      CONNECTED: number;
      DISCONNECTING: number;
      DISCONNECTED: number;
    };
    constructor(tunnel: Tunnel);
    getDisplay(): Display;
    connect(data?: string): void;
    disconnect(): void;
    onstatechange: ((state: number) => void) | null;
    onerror: ((status: Status) => void) | null;
    onsync: ((timestamp: number, frames: number) => void) | null;
    onclipboard:
      | ((stream: InputStream, mimetype: string) => void)
      | null;
    createClipboardStream(mimetype: string): OutputStream;
    sendMouseState(state: Mouse.State, applyDisplayScale?: boolean): void;
    sendKeyEvent(pressed: number, keysym: number): void;
    sendSize(width: number, height: number): void;
  }
}
