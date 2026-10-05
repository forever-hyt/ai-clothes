import type { Material } from './studio-images';
import type { CopyKey } from './studio-copy';

export function processingBlock(materials: { person: Material | null; clothing: Material | null }, consent: boolean, safetyConsent: boolean): CopyKey | null {
  if (!materials.clothing) return 'needClothing';
  if (!materials.person) return 'needPerson';
  if (!consent) return 'needConsent';
  if (!safetyConsent) return 'needSafety';
  // Local preview trusts only bundled materials. Server approval must never use this flag.
  if (materials.person.source !== 'builtin' || materials.clothing.source !== 'builtin') return 'moderationUnavailable';
  return null;
}
