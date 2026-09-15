"use client";
import { useEffect, useRef } from "react";
export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>("input[autofocus]")?.focus();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialogContent">
        <header className="dialogHeader">
          <h2>{title}</h2>
          <button className="iconButton" aria-label="Sluiten" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
