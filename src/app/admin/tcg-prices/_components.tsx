"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" disabled={pending} type="submit">
      {pending ? pendingText ?? "Traitement..." : children}
    </button>
  );
}

export function SmallSubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button small" disabled={pending} type="submit">
      {pending ? pendingText ?? "..." : children}
    </button>
  );
}
