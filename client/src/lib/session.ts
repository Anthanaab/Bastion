export interface RdpTools {
  toggleFullscreen: () => void;
  sendCtrlAltDel: () => void;
  pasteClipboard: () => Promise<void>;
  pasteText: (text: string) => void;
}

export interface SessionControl {
  connected: boolean;
  disconnect: () => void;
  rdp?: RdpTools;
}
