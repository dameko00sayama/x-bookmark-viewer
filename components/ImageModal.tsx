"use client";

import { useEffect } from "react";

type ImageModalProps = {
  image: { url: string; altText: string | null } | null;
  onClose: () => void;
};

export default function ImageModal({ image, onClose }: ImageModalProps) {
  useEffect(() => {
    if (!image) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, onClose]);

  if (!image) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        className="absolute right-6 top-6 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white"
        type="button"
        onClick={onClose}
      >
        閉じる
      </button>
      <img
        src={image.url}
        alt={image.altText ?? ""}
        className="max-h-full max-w-full rounded-md object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
