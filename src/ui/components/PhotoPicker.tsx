"use client";

import { useRef, useState } from "react";
import { Camera, LoaderCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { isFileId } from "@/domain/files";
import { removePhotoAction } from "@/app/app/close/actions";
import { downscalePhoto, uploadPhoto, type PhotoError } from "@/ui/photo-client";

const MAX = 3;
const btn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3.5 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60";

/**
 * A return's photos: up to 3 thumbnails, each removable, and a button that opens the camera. Each
 * photo is downscaled in the browser and uploaded at once; its id goes into the hidden `name`
 * field (comma-separated) and is attached when the close is saved. Thumbnails load only from a
 * validated file id.
 */
export function PhotoPicker({
  name,
  date,
  photos,
  onChange,
  error,
  photoErrors,
}: {
  name: string;
  date: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  /** The row's error text from the last save, if any. */
  error?: string;
  /** Per-photo error text from the last save (for example an expired photo), by id. */
  photoErrors: Record<string, string | undefined>;
}) {
  const t = useTranslations("close.photo");
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [failed, setFailed] = useState<PhotoError | null>(null);
  const ids = photos.filter(isFileId);
  const full = ids.length + uploading >= MAX;

  async function add(files: FileList | null) {
    if (!files) return;
    const picked = [...files].slice(0, Math.max(0, MAX - ids.length - uploading));
    setFailed(null);
    let current = ids;
    for (const file of picked) {
      setUploading((n) => n + 1);
      try {
        let blob: Blob;
        try {
          blob = await downscalePhoto(file);
        } catch {
          setFailed("unreadable");
          continue;
        }
        const r = await uploadPhoto("return", date, blob);
        if (r.ok) {
          current = [...current, r.id];
          onChange(current);
        } else setFailed(r.error);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  async function remove(id: string) {
    onChange(ids.filter((x) => x !== id));
    await removePhotoAction(id);
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={ids.join(",")} />
      {(ids.length > 0 || uploading > 0) && (
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
          {ids.map((id, i) => (
            <li key={id} className="flex flex-col items-center gap-1">
              <div className={`relative size-[72px] overflow-hidden rounded-[10px] border ${photoErrors[id] ? "border-2 border-alert" : "border-line"}`}>
                {/* A private photo behind the session: never passed through the image optimizer (R61). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/files/${id}`} alt={t("thumbAlt", { n: i + 1 })} width={72} height={72} className="size-full object-cover" />
              </div>
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`${t("remove")} ${i + 1}`}
                title={t("remove")}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-white text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              {photoErrors[id] && <span className="max-w-[120px] text-center text-[12px] font-semibold text-alert">{photoErrors[id]}</span>}
            </li>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up-${i}`} className="flex size-[72px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line text-[12px] text-ink-2" aria-live="polite">
              <LoaderCircle aria-hidden="true" size={18} strokeWidth={2} className="animate-spin" />
              {t("uploading")}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!full && (
          <button type="button" onClick={() => input.current?.click()} className={`${btn} self-start`}>
            <Camera aria-hidden="true" size={18} strokeWidth={2} />
            {t("add")}
          </button>
        )}
        {ids.length > 0 && <span className="text-[13px] text-ink-2">{t("count", { n: ids.length })}</span>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => add(e.target.files)}
      />
      {(failed || error) && (
        <span role="alert" className="text-[13px] font-semibold text-alert">
          {failed ? t(`errors.${failed}`) : error}
        </span>
      )}
    </div>
  );
}
