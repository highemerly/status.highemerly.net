/**
 * セクションの見出し。
 * どのセクションも同じ見え方にしたいので 1 か所に寄せてある。
 */
export function SectionHeading({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-xs font-medium uppercase tracking-wide text-fg-subtle ${className}`}
    >
      {children}
    </h2>
  );
}
