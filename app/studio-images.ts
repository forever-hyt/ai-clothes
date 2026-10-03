export type Material = { url: string; name: string };
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = url; await image.decode(); return image;
}
export async function readMaterial(file: File): Promise<Material> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('invalid');
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('imageError')); reader.readAsDataURL(file);
  });
  try { const image = await loadImage(url); if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('pixels'); }
  catch (error) { if (error instanceof Error && error.message === 'pixels') throw error; throw new Error('imageError'); }
  return { url, name: file.name };
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
  const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">${body}</svg>`)}`;
  return {
    person: { name: 'Portrait illustration', url: svg('<rect width="600" height="800" fill="#e8eee2"/><circle cx="300" cy="205" r="76" fill="#d9b89b"/><path d="M223 184q-10-105 80-99 91 0 80 109l-26-44-110 0z" fill="#354735"/><path d="M198 314q102-50 204 0l63 237-78 20-28-135v250H239V436l-26 135-78-20z" fill="#f2ede2"/><path d="M239 580h120v176h-50V634h-18v122h-52z" fill="#5f705b"/>') },
    clothing: { name: 'Clothing illustration', url: svg('<rect width="600" height="800" fill="#f6f0e3"/><path d="m213 188-128 80 68 119 64-41v288h166V346l64 41 68-119-128-80q-87 85-174 0z" fill="#708560" stroke="#4b6343" stroke-width="8"/><path d="M257 201q43 42 86 0" fill="none" stroke="#d9e2c8" stroke-width="12"/><path d="M218 583h162" stroke="#b7c6a1" stroke-width="5"/>') },
  };
}
