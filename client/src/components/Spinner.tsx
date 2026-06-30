export default function Spinner({
  className = "h-8 w-8",
}: {
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Chargement"
      className={`animate-spin rounded-full border-2 border-bastion-accent border-t-transparent ${className}`}
    />
  );
}
