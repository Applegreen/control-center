"use client";

import { useId, useRef, type InputHTMLAttributes } from "react";
import { isManualEditKey } from "@/lib/settings-input";

type Props = InputHTMLAttributes<HTMLInputElement> & { fieldKey?: string };

/** Settings are configuration, not a login form. Only deliberate edits enter state. */
export function SettingsInput({ fieldKey, onChange, onKeyDown, onPaste, onCut,
  onDrop, onCompositionStart, onBlur, onPointerDown, ...props }: Props) {
  const id = useId();
  const editUntil = useRef(0);
  const guarded = !["checkbox", "radio", "range", "button", "submit", "hidden"].includes(props.type || "text");
  const enableEdit = (input: HTMLInputElement) => {
    if (props.readOnly || props.disabled) return;
    editUntil.current = Date.now() + 1_500;
    input.readOnly = false;
  };
  const restore = (input: HTMLInputElement) => {
    input.value = String(props.value ?? props.defaultValue ?? "");
  };
  return <input
    {...props}
    name={`cc-config-${fieldKey || props.name || id.replaceAll(":", "")}`}
    autoComplete={props.type === "password" ? "new-password" : "off"}
    autoCapitalize="none"
    spellCheck={props.spellCheck ?? false}
    data-lpignore="true"
    data-1p-ignore="true"
    data-bwignore="true"
    data-form-type="other"
    readOnly={guarded ? true : props.readOnly}
    onKeyDown={(event) => {
      if (isManualEditKey(event.key, event.ctrlKey || event.metaKey)) enableEdit(event.currentTarget);
      onKeyDown?.(event);
    }}
    onPaste={(event) => { enableEdit(event.currentTarget); onPaste?.(event); }}
    onCut={(event) => { enableEdit(event.currentTarget); onCut?.(event); }}
    onDrop={(event) => { enableEdit(event.currentTarget); onDrop?.(event); }}
    onCompositionStart={(event) => { enableEdit(event.currentTarget); onCompositionStart?.(event); }}
    onPointerDown={(event) => {
      if (["number", "date", "datetime-local", "time", "color"].includes(props.type || "")) enableEdit(event.currentTarget);
      onPointerDown?.(event);
    }}
    onChange={(event) => {
      if (guarded && Date.now() > editUntil.current) { restore(event.currentTarget); return; }
      onChange?.(event);
    }}
    onBlur={(event) => {
      editUntil.current = 0;
      if (guarded) { event.currentTarget.readOnly = true; restore(event.currentTarget); }
      onBlur?.(event);
    }}
  />;
}
