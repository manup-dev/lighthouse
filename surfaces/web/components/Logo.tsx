import clsx from "clsx";

export interface LogoProps {
  size?: number;
  className?: string;
  /** Render the beacon beam. Disable for tight nav use. */
  beam?: boolean;
  title?: string;
}

/**
 * Lighthouse mark — tower silhouette + lantern + light arcs.
 * Stroke uses currentColor; the lantern lamp picks up `--beacon`.
 */
export default function Logo({
  size = 28,
  className,
  beam = true,
  title = "Lighthouse",
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={clsx("shrink-0", className)}
    >
      <title>{title}</title>

      {beam && (
        <>
          <path
            d="M16 14 L8 7"
            stroke="var(--beacon)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.55"
          />
          <path
            d="M16 14 L24 7"
            stroke="var(--beacon)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.55"
          />
          <path
            d="M16 14 L5 14"
            stroke="var(--beacon)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M16 14 L27 14"
            stroke="var(--beacon)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.35"
          />
        </>
      )}

      {/* lantern lamp */}
      <circle cx="16" cy="14" r="2.2" fill="var(--beacon)" />

      {/* tower body — tapered trapezoid */}
      <path
        d="M13 17 L19 17 L20.5 28 L11.5 28 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* platform under lantern */}
      <path
        d="M12 17 L20 17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* lantern cage (open top) */}
      <path
        d="M13.5 17 L13.5 12 L18.5 12 L18.5 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* roof cap */}
      <path
        d="M12.5 12 L19.5 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 12 L16 9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
