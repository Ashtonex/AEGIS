"use client";

/** Numeric input that keeps what the user is typing ("0.", "1,2") and only
 *  reports a value once it parses; invalid text is shown as invalid, never
 *  silently turned into 0. */
import React, { useEffect, useState } from "react";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
}

export function NumberField({ value, onValueChange, min = 0, className, ...rest }: Props) {
  const [text, setText] = useState(String(value ?? 0));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const parsed = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(String(value ?? 0));
      setInvalid(false);
    }
    // re-sync only when the value changes from outside (undo, server load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      inputMode="decimal"
      aria-invalid={invalid}
      className={`${className ?? ""} ${invalid ? "!border-danger" : ""}`}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const cleaned = next.replace(/,/g, "").trim();
        const parsed = cleaned === "" ? 0 : Number(cleaned);
        const ok = Number.isFinite(parsed) && parsed >= min && !/\.$/.test(cleaned);
        setInvalid(!Number.isFinite(parsed) || parsed < min);
        if (ok && parsed !== value) onValueChange(parsed);
      }}
      onBlur={(e) => {
        if (invalid) {
          setText(String(value ?? 0));
          setInvalid(false);
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
