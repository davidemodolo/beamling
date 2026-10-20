"use client";

import { useState } from "react";
import { Icon } from "./ui/icon";

interface SecretKeyInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  invalid?: boolean;
}

/** A masked API-key field with a show/hide toggle. */
export function SecretKeyInput({ id, value, onChange, placeholder, invalid }: SecretKeyInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        id={id}
        className="input mono"
        type={show ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
      />
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm input-action"
        onClick={() => setShow((shown) => !shown)}
        aria-label={show ? "Hide key" : "Show key"}
        aria-controls={id}
      >
        <Icon name={show ? "eye-off" : "eye"} size={14} />
      </button>
    </div>
  );
}
