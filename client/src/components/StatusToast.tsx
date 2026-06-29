import type { StatusNotification } from "../types";

interface StatusToastProps {
  items: StatusNotification[];
  onDismiss: (id: string) => void;
}

export default function StatusToast({ items, onDismiss }: StatusToastProps) {
  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            item.online
              ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
              : "border-red-500/40 bg-red-950/90 text-red-100"
          }`}
        >
          <div>
            <p className="font-medium">{item.hostName}</p>
            <p className="text-xs opacity-80">
              {item.online ? "En ligne" : "Hors ligne"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            className="text-xs opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
