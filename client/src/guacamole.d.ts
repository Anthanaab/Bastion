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
  }

  export class Mouse {
    constructor(element: HTMLElement);
    onmousedown: ((state: Mouse.State) => void) | null;
    onmouseup: ((state: Mouse.State) => void) | null;
    onmousemove: ((state: Mouse.State) => void) | null;
  }

  export class Keyboard {
    constructor(element: Document | HTMLElement);
    onkeydown: ((keysym: number) => void) | null;
    onkeyup: ((keysym: number) => void) | null;
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
    sendMouseState(state: Mouse.State, applyDisplayScale?: boolean): void;
    sendKeyEvent(pressed: number, keysym: number): void;
    sendSize(width: number, height: number): void;
  }
}
