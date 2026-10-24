import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Rasterises a report card (inline-attribute SVG) to a PNG at its native 1080 px width. */
export async function svgToPng(svg: SVGSVGElement): Promise<Blob> {
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render image'))), 'image/png'));
}

const blobToBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

export const safeFile = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80);

/**
 * Hands PNGs to the phone's share sheet (WhatsApp, Signal, …). In the Android app via the
 * native share plugin; in a browser via the Web Share API, falling back to downloads.
 */
export async function shareImages(files: { name: string; blob: Blob }[], text?: string) {
  if (Capacitor.isNativePlatform()) {
    const uris: string[] = [];
    for (const f of files) {
      const { uri } = await Filesystem.writeFile({ path: `share/${f.name}`, data: await blobToBase64(f.blob), directory: Directory.Cache, recursive: true });
      uris.push(uri);
    }
    await Share.share({ files: uris, text });
    return;
  }
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: 'image/png' }));
  if (navigator.canShare?.({ files: asFiles })) {
    try {
      await navigator.share({ files: asFiles, text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  for (const f of files) downloadBlob(f.blob, f.name);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
