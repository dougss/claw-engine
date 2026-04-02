interface BadgeProps {
  status: string
  pulse?: boolean
  size?: "sm" | "md"
}

const STATUS_MAP: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  completed:     { dot: "bg-status-completed",    text: "text-status-completed",    bg: "bg-status-completed/8",    border: "border-status-completed/20" },
  running:       { dot: "bg-status-running status-pulse",       text: "text-status-running",       bg: "bg-status-running/8",       border: "border-status-running/20" },
  pending:       { dot: "bg-status-pending",       text: "text-status-pending",       bg: "bg-status-pending/8",       border: "border-status-pending/20" },
  failed:        { dot: "bg-status-failed",        text: "text-status-failed",        bg: "bg-status-failed/8",        border: "border-status-failed/20" },
  starting:      { dot: "bg-status-starting status-pulse",      text: "text-status-starting",      bg: "bg-status-starting/8",      border: "border-status-starting/20" },
  provisioning:  { dot: "bg-status-provisioning",  text: "text-status-provisioning",  bg: "bg-status-provisioning/8",  border: "border-status-provisioning/20" },
  checkpointing: { dot: "bg-status-checkpointing", text: "text-status-checkpointing", bg: "bg-status-checkpointing/8", border: "border-status-checkpointing/20" },
  validating:    { dot: "bg-status-validating",    text: "text-status-validating",    bg: "bg-status-validating/8",    border: "border-status-validating/20" },
}

const FALLBACK = { dot: "bg-text-dim", text: "text-text-muted", bg: "bg-surface-3", border: "border-border-3" }

export function StatusBadge({ status, size = "sm" }: BadgeProps) {
  const cfg = STATUS_MAP[status] ?? FALLBACK
  const sizeClass = size === "sm"
    ? "px-2 py-0.5 text-[10px] gap-1.5"
    : "px-2.5 py-1 text-xs gap-2"

  return (
    <span className={`inline-flex items-center rounded-md border font-mono font-medium ${sizeClass} ${cfg.text} ${cfg.bg} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {status}
    </span>
  )
}

export function StatusDot({ status, size = 6 }: { status: string; size?: number }) {
  const cfg = STATUS_MAP[status] ?? FALLBACK
  const s = `${size * 4}px`
  return (
    <span
      className={`rounded-full shrink-0 ${cfg.dot}`}
      style={{ width: s, height: s }}
    />
  )
}
