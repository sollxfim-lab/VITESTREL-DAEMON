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
        d="M5.2 6.5h5.1L16 23.3 21.7 6.5h5.1L18.7 28h-5.4L5.2 6.5Z"
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
