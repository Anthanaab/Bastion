declare module "guacamole-common-js" {
  export class Status {
    static Code: {
      SUCCESS: number;
      UPSTREAM_TIMEOUT: number;
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

  export abstract class Tunnel {
    static State: {
      CONNECTING: number;
      OPEN: number;
      CLOSED: number;
    };
    state: number;
    oninstruction: ((instruction: string) => void) | null;
    onstatechange: ((state: number) => void) | null;
    onerror: ((status: Status) => void) | null;
    setState(state: number): void;
    connect(data?: string): void;
    disconnect(): void;
    sendMessage(elements: string[]): void;
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
  }
}
