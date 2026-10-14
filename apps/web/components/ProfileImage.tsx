"use client";
import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { giphyProfileMediaPattern } from "@animesoul/contracts";
import { getProfileGiphy, giphyRendition } from "../lib/profile-giphy";

export function ProfileImage({
  value,
  cover = false,
  fallback = null,
  ...props
}: {
  value: string | null;
  cover?: boolean;
  fallback?: ReactNode;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const [resolved, setResolved] = useState<{ value: string; src: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const id = value && giphyProfileMediaPattern.exec(value)?.[1];
  useEffect(() => {
    if (!id || !value) return;
    const abort = new AbortController();
    void getProfileGiphy(id)
      .then((gif) => {
        if (!abort.signal.aborted) setResolved({ value, src: giphyRendition(gif, cover) });
      })
      .catch(() => {
        if (!abort.signal.aborted) setResolved({ value, src: null });
      });
    return () => abort.abort();
  }, [id, value, cover]);
  const src = id ? (resolved?.value === value ? resolved.src : null) : value;
  if (!src || src === failed) return <>{fallback}</>;
  return (
    <img
      {...props}
      src={src}
      referrerPolicy="no-referrer"
      onError={(event) => {
        setFailed(src);
        props.onError?.(event);
      }}
    />
  );
}
