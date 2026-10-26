"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";

const PHOTO_SIZE = 320;

/**
 * Crops a chosen photo to a centred square and shrinks it to a small JPEG,
 * so uploads are quick even on a phone's camera photos.
 */
export async function resizePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPEG, PNG or WebP)");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't open that photo. Try a JPEG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      PHOTO_SIZE,
      PHOTO_SIZE,
    );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Each photo is fetched once per version and shared by every avatar showing it.
const loaded = new Map<string, Promise<string | null>>();

/**
 * The address of an employee's photo, or null while loading or when they have
 * none. Photos need the login token, so they are fetched rather than linked.
 */
export function usePhoto(employeeId?: string, version?: string) {
  const key = employeeId && version ? `${employeeId}@${version}` : null;
  const [shown, setShown] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let photo = loaded.get(key);
    if (!photo) {
      photo = apiFetch(`/employees/${employeeId}/photo?v=${encodeURIComponent(version!)}`)
        .then((res) => (res.ok ? res.blob().then((b) => URL.createObjectURL(b)) : null))
        .catch(() => null);
      loaded.set(key, photo);
    }
    let live = true;
    void photo.then((url) => live && setShown({ key, url }));
    return () => {
      live = false;
    };
  }, [key, employeeId, version]);

  return shown?.key === key ? shown.url : null;
}
