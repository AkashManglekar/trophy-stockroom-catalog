import { supabase } from "@/integrations/supabase/client";

export const MAX_PHOTOS = 6;

/** Storage path of the small copy made at upload. */
export const thumbPath = (path: string) => path.replace(/\.jpg$/, ".t.jpg");
/** Paths plus their small copies, for deleting both. */
export const withThumbs = (paths: string[]) => paths.flatMap((p) => [p, thumbPath(p)]);
/** Cached, stable photo address. `thumb` serves the small copy (falls back to the full photo). */
export const photoUrl = (path: string | null | undefined, thumb = true) =>
  path ? `/media/${path}${thumb ? "?w=t" : ""}` : undefined;

/** Downscales an image to ≤maxSide px JPEG. Falls back to the original file. */
export async function shrinkImage(file: Blob, maxSide = 1400, quality = 0.84): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * sc);
    cv.height = Math.round(bmp.height * sc);
    cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise((res) => cv.toBlob((b) => res(b ?? file), "image/jpeg", quality));
  } catch {
    return file;
  }
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(b);
  });
}

export async function uploadProductPhotos(
  productId: string,
  files: File[],
  existingCount: number,
): Promise<number> {
  const room = MAX_PHOTOS - existingCount;
  if (room <= 0) throw new Error(`Up to ${MAX_PHOTOS} photos per product — remove one first`);
  const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
  if (!imgs.length) throw new Error("Choose image files");
  let n = 0;
  for (const f of imgs) {
    const [blob, small] = await Promise.all([shrinkImage(f), shrinkImage(f, 480, 0.78)]);
    const path = `products/${productId}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage
      .from("media")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw new Error(up.error.message);
    // Small copy for grids and thumbnails; the full photo is only fetched when opened.
    await supabase.storage
      .from("media")
      .upload(thumbPath(path), small, { contentType: "image/jpeg", upsert: true });
    const ins = await supabase.from("product_photos").insert({
      product_id: productId,
      url: path,
      path,
      is_main: existingCount + n === 0,
      sort: existingCount + n,
    });
    if (ins.error) throw new Error(ins.error.message);
    n++;
  }
  return n;
}

export async function setMainPhoto(productId: string, photoId: string) {
  const a = await supabase
    .from("product_photos")
    .update({ is_main: false })
    .eq("product_id", productId);
  if (a.error) throw new Error(a.error.message);
  const b = await supabase.from("product_photos").update({ is_main: true }).eq("id", photoId);
  if (b.error) throw new Error(b.error.message);
}

export async function removePhoto(photo: {
  id: string;
  path: string | null;
  product_id: string;
  is_main: boolean;
}) {
  const d = await supabase.from("product_photos").delete().eq("id", photo.id);
  if (d.error) throw new Error(d.error.message);
  if (photo.path) await supabase.storage.from("media").remove(withThumbs([photo.path]));
  if (photo.is_main) {
    const { data } = await supabase
      .from("product_photos")
      .select("id")
      .eq("product_id", photo.product_id)
      .order("sort")
      .limit(1);
    if (data?.[0])
      await supabase.from("product_photos").update({ is_main: true }).eq("id", data[0].id);
  }
}
