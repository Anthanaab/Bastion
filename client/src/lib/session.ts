export interface RdpTools {
  toggleFullscreen: () => void;
  sendCtrlAltDel: () => void;
  pasteClipboard: () => Promise<void>;
}

export interface SessionControl {
  connected: boolean;
  disconnect: () => void;
  rdp?: RdpTools;
}
