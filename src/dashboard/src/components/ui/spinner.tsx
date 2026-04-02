interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  const sizeMap = { sm: "w-3.5 h-3.5", md: "w-5 h-5", lg: "w-7 h-7" };
  return (
    <span
      className={`inline-block rounded-full border-2 border-accent/20 border-t-accent animate-spin-slow ${sizeMap[size]} ${className}`}
    />
  );
}

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-text-muted text-sm">
      <Spinner size="sm" />
      <span>{message}</span>
    </div>
  );
}
