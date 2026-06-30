type Variant = "success" | "error" | "info";

const styles: Record<Variant, string> = {
  success: "alert-success",
  error: "alert-error",
  info: "alert-info",
};

export default function InlineAlert({
  variant,
  children,
  className = "",
}: {
  variant: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles[variant]} ${className}`.trim()} role="alert">
      {children}
    </div>
  );
}
