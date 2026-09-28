import { forwardRef } from "react";

export type OrbState = "idle" | "listen" | "remember" | "speak" | "connect" | "dim" | "still";

/** Concentric hairline rings around ॐ. States and motion follow the Wireframes (1d). */
const Orb = forwardRef<HTMLDivElement, { state: OrbState; className?: string }>(function Orb({ state, className }, ref) {
  return (
    <div ref={ref} className={`orb orb--${state} ${className ?? ""}`} aria-hidden="true">
      <span className="rips">
        <i className="rip" />
        <i className="rip rip--two" />
      </span>
      <i className="rg rg--a" />
      <i className="rg rg--b" />
      <i className="rg rg--c" />
      <i className="rg rg--d" />
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="49.5" fill="none" stroke="#fff" strokeWidth="1" vectorEffect="non-scaling-stroke" pathLength="100" />
      </svg>
      <span className="om" lang="sa">ॐ</span>
    </div>
  );
});

export default Orb;
