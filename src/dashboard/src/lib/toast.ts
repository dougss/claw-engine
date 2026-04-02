type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
}

type Listener = (toasts: Toast[]) => void;

let nextId = 0;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l([...toasts]);
}

function removeToast(id: number) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t));
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 300);
}

export function addToast(
  message: string,
  type: ToastType = "info",
  durationMs = 5000,
) {
  const id = ++nextId;
  toasts = [...toasts, { id, message, type, exiting: false }];
  notify();
  setTimeout(() => removeToast(id), durationMs);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}

export type { Toast, ToastType };
