import type { HTMLAttributes } from "react";

type IconProps = HTMLAttributes<HTMLElement> & {
  name: string;
  solid?: boolean;
  brand?: boolean;
};

/** Font Awesome icon wrapper. Decorative by default; add aria-label when meaningful. */
export function Icon({ name, solid = true, brand = false, className = "", ...rest }: IconProps) {
  const prefix = brand ? "fa-brands" : solid ? "fa-solid" : "fa-regular";
  return <i className={`${prefix} fa-${name} ${className}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M6 26V6h4.4L16 17.2 21.6 6H26v20h-4.3V13.6L16.9 24h-1.8L10.3 13.6V26H6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <IconMark />
    </span>
  );
}

/** Isometric block crest used above the sign-in form. */
export function AuthEmblem({ className = "" }: { className?: string }) {
  return (
    <span className={`auth-emblem-art ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 96 96" fill="none">
        <defs>
          <linearGradient id="authEmblemTop" x1="20" y1="22" x2="76" y2="50" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a9edff" />
            <stop offset=".55" stopColor="#56c8f8" />
            <stop offset="1" stopColor="#238cc6" />
          </linearGradient>
          <linearGradient id="authEmblemLeft" x1="18" y1="40" x2="48" y2="82" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1d3a54" />
            <stop offset="1" stopColor="#0a1725" />
          </linearGradient>
          <linearGradient id="authEmblemRight" x1="78" y1="38" x2="48" y2="82" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2a6288" />
            <stop offset="1" stopColor="#10283e" />
          </linearGradient>
          <linearGradient id="authEmblemRing" x1="12" y1="48" x2="84" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#43b8f5" stopOpacity=".08" />
            <stop offset=".5" stopColor="#8fe1ff" stopOpacity=".9" />
            <stop offset="1" stopColor="#aa9bf5" stopOpacity=".08" />
          </linearGradient>
          <radialGradient id="authEmblemHalo" cx="0" cy="0" r="1" gradientTransform="translate(48 48) rotate(90) scale(42)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#43b8f5" stopOpacity=".3" />
            <stop offset="1" stopColor="#43b8f5" stopOpacity="0" />
          </radialGradient>
          <filter id="authEmblemGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <circle cx="48" cy="48" r="42" fill="url(#authEmblemHalo)" />
        <ellipse
          cx="48"
          cy="48"
          rx="42"
          ry="17"
          transform="rotate(-24 48 48)"
          stroke="url(#authEmblemRing)"
          strokeWidth="1.15"
          strokeDasharray="3 5"
        />
        <circle cx="12.5" cy="63" r="2" fill="#8fe1ff" />
        <circle cx="83" cy="33" r="1.7" fill="#aa9bf5" />

        <g filter="url(#authEmblemGlow)" opacity=".55">
          <path d="M48 19 77 34 48 49 19 34 48 19Z" fill="#43b8f5" />
        </g>

        <path d="M48 18 79 34.5 48 51 17 34.5 48 18Z" fill="url(#authEmblemTop)" />
        <path d="M17 34.5 48 51v31L17 65.5v-31Z" fill="url(#authEmblemLeft)" />
        <path d="M79 34.5 48 51v31l31-16.5v-31Z" fill="url(#authEmblemRight)" />

        <path d="M48 18 79 34.5 48 51 17 34.5 48 18Z" stroke="#b9efff" strokeOpacity=".55" strokeWidth=".8" />
        <path d="M17 34.5 48 51l31-16.5M48 51v31" stroke="#8fe1ff" strokeOpacity=".35" strokeWidth=".8" />

        <path d="M34.5 56.5 48 76l13.5-19.5" stroke="#04131f" strokeOpacity=".55" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 1.5)" />
        <path d="M34.5 56.5 48 76l13.5-19.5" stroke="#ddf7ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />

        <path d="M29 40.5 40 35M56 29.5 67 24" stroke="#e2f9ff" strokeOpacity=".45" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="18" cy="34" r="1.6" fill="#b9efff" />
        <circle cx="78" cy="34" r="1.6" fill="#b9efff" />
        <circle cx="48" cy="82.5" r="1.3" fill="#8fe1ff" opacity=".7" />
      </svg>
    </span>
  );
}
