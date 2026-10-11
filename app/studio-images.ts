import { isBlankPixels } from './image-validation.mjs';
import { personSvgBody, clothingSvgBody, svgDataUrl } from './sample-art';
export type Material = { url: string; name: string; source?: 'builtin' };
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = url; await image.decode(); return image;
}
export async function readMaterial(file: File, kind: 'person' | 'clothing' = 'person'): Promise<Material> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('invalid');
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('imageError')); reader.readAsDataURL(file);
  });
  let image: HTMLImageElement;
  try { image = await loadImage(url); }
  catch { throw new Error('imageError'); }
  if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('pixels');
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('imageError');
  if (kind === 'clothing') {
    const sample = document.createElement('canvas'); sample.width = 128; sample.height = 128;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('imageError');
    ctx.drawImage(image, 0, 0, 128, 128);
    if (isBlankPixels(ctx.getImageData(0, 0, 128, 128).data)) throw new Error('blankClothing');
  }
  // Canvas re-encoding strips source EXIF/GPS before any future server submission.
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('imageError');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const sanitized = canvas.toDataURL('image/webp', 0.9);
  if (sanitized.length * 0.75 > 5 * 1024 * 1024) throw new Error('invalid');
  return { url: sanitized, name: file.name };
}
function fit(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}
export async function makePreviews(person: string, clothing: string) {
  const [portrait, garment] = await Promise.all([loadImage(person), loadImage(clothing)]);
  const original = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(portrait.naturalWidth, portrait.naturalHeight));
  original.width = Math.round(portrait.naturalWidth * scale); original.height = Math.round(portrait.naturalHeight * scale);
  const originalContext = original.getContext('2d'); if (!originalContext) throw new Error('exportError');
  originalContext.drawImage(portrait, 0, 0, original.width, original.height);
  const board = document.createElement('canvas'); board.width = 1400; board.height = 1050;
  const ctx = board.getContext('2d'); if (!ctx) throw new Error('exportError');
  ctx.fillStyle = '#f5f6ef'; ctx.fillRect(0, 0, 1400, 1050);
  ctx.fillStyle = '#244e3d'; ctx.font = '600 38px sans-serif'; ctx.fillText('STYLE MUSE / INSPIRATION BOARD', 55, 80);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(45, 120, 810, 810); ctx.fillRect(885, 120, 470, 810);
  fit(ctx, portrait, 65, 140, 770, 770); fit(ctx, garment, 905, 140, 430, 770);
  ctx.fillStyle = '#53634e'; ctx.font = '24px sans-serif'; ctx.fillText('01 / PORTRAIT', 55, 980); ctx.fillText('02 / CLOTHING', 895, 980);
  ctx.font = '18px sans-serif'; ctx.fillText('MATERIAL COMPARISON · NO AI TRY-ON APPLIED', 55, 1020);
  return { board: board.toDataURL('image/png'), original: original.toDataURL('image/png') };
}
export function sampleMaterials(): Record<'person' | 'clothing', Material> {
  // 素材 SVG 本体在 sample-art.ts,与服务器演示提供方共用同一份插画。
  return {
    person: { name: 'Portrait illustration', source: 'builtin', url: svgDataUrl(personSvgBody) },
    clothing: { name: 'Clothing illustration', source: 'builtin', url: svgDataUrl(clothingSvgBody) },
  };
}
