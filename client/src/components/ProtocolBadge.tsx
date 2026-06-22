import type { Protocol } from "../types";

const config: Record<
  Protocol,
  { label: string; defaultPort: number; className: string }
> = {
  ssh: {
    label: "SSH",
    defaultPort: 22,
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  rdp: {
    label: "RDP",
    defaultPort: 3389,
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  vnc: {
    label: "VNC",
    defaultPort: 5900,
    className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
};

export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  const c = config[protocol];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${c.className}`}
    >
      {c.label}
    </span>
  );
}

export function defaultPort(protocol: Protocol): number {
  return config[protocol].defaultPort;
}

export function protocolIcon(protocol: Protocol): string {
  switch (protocol) {
    case "ssh":
      return "⌘";
    case "rdp":
      return "🖥";
    case "vnc":
      return "◫";
  }
}
