"use client";

import { useState } from "react";

/** A password input with a Show / Hide toggle. */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span className="sc">{label}</span>
      <span className="field__row">
        <input
          type={shown ? "text" : "password"}
          required
          minLength={8}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="lnk field__toggle"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
