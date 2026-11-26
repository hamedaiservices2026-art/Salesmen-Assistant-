"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { isFileId } from "@/domain/files";
import { removePhotoAction } from "@/app/app/close/actions";
import { downscalePhoto, uploadPhoto, type PhotoError } from "@/ui/photo-client";
import { addPhoto, removePhoto } from "@/ui/photo-list";

const MAX = 3;
const btn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3.5 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60";

/**
 * A return's photos: up to 3 thumbnails, each removable, and a button that opens the camera. Each
 * photo is downscaled in the browser and uploaded, one at a time (a queue), and its id goes into
 * the hidden `name` field (comma-separated); it is attached when the close is saved. The list is
 * changed only through updates applied to its latest value, so uploads finishing in any order and
 * a remove during an upload never overwrite each other (R71). While anything is uploading the add
 * button is hidden and `onBusy` reports the count, so the form can hold its submit. Thumbnails load
 * only from a validated file id.
 */
export function PhotoPicker({
  name,
  date,
  photos,
  onChange,
  onBusy,
  error,
  photoErrors,
}: {
  name: string;
  date: string;
  photos: string[];
  /** Applies an update to the latest list of ids. */
  onChange: (update: (photos: string[]) => string[]) => void;
  /** How many photos are being uploaded right now (0 when done, and on unmount). */
  onBusy: (uploading: number) => void;
  /** The row's error text from the last save, if any. */
  error?: string;
  /** Per-photo error text from the last save (for example an expired photo), by id. */
  photoErrors: Record<string, string | undefined>;
}) {
  const t = useTranslations("close.photo");
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [uploading, setUploading] = useState(0);
  const [failed, setFailed] = useState<PhotoError | "removeFailed" | null>(null);
  const ids = photos.filter(isFileId);

  const busyReport = useRef(onBusy);
  useEffect(() => {
    busyReport.current = onBusy;
  });
  useEffect(() => {
    busyReport.current(uploading);
  }, [uploading]);
  // A row removed mid-upload must not keep the form waiting.
  useEffect(() => () => busyReport.current(0), []);

  async function uploadOne(file: File): Promise<void> {
    try {
      let blob: Blob;
      try {
        blob = await downscalePhoto(file);
      } catch {
        setFailed("unreadable");
        return;
      }
      const r = await uploadPhoto("return", date, blob);
      if (r.ok) onChange((list) => addPhoto(list, r.id, MAX));
      else setFailed(r.error);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  function add(files: FileList | null) {
    if (!files) return;
    const picked = [...files].slice(0, Math.max(0, MAX - ids.length - uploading));
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;
    setFailed(null);
    setUploading((n) => n + picked.length);
    // One upload at a time, in the order picked.
    for (const file of picked) queue.current = queue.current.then(() => uploadOne(file));
  }

  async function remove(id: string) {
    setFailed(null);
    onChange((list) => removePhoto(list, id));
    const r = await removePhotoAction(id).catch(() => ({ ok: false }));
    if (!r.ok) {
      onChange((list) => addPhoto(list, id, MAX));
      setFailed("removeFailed");
    }
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
            <li key={`up-${i}`} className="flex size-[72px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line text-[12px] text-ink-2">
              <LoaderCircle aria-hidden="true" size={18} strokeWidth={2} className="animate-spin" />
              {t("uploading")}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {uploading === 0 && ids.length < MAX && (
          <button type="button" onClick={() => input.current?.click()} className={`${btn} self-start`}>
            <Camera aria-hidden="true" size={18} strokeWidth={2} />
            {t("add")}
          </button>
        )}
        {ids.length > 0 && <span className="text-[13px] text-ink-2">{t("count", { n: ids.length })}</span>}
      </div>
      {/* Always mounted, so "uploading" is announced when a photo starts (final review C7). */}
      <p role="status" className="sr-only">
        {uploading > 0 ? t("uploading") : ""}
      </p>
      {/* Where the photos are kept and who sees them, always in view (R71). */}
      <p className="m-0 text-[12.5px] text-ink-2">{t("hint")}</p>
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
