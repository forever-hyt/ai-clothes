/**
 * Detect near-uniform or fully transparent images, not garment identity or nudity.
 * Composite transparency against white so invisible RGB data cannot bypass checks.
 * @param {ArrayLike<number>} pixels RGBA pixel data
 */
export function isBlankPixels(pixels) {
  if (!pixels.length || pixels.length % 4) return true;
  const sums = [0, 0, 0], squares = [0, 0, 0];
  const count = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[index + channel] * alpha + 255 * (1 - alpha);
      sums[channel] += value;
      squares[channel] += value * value;
    }
  }
  return sums.every((sum, channel) => squares[channel] / count - (sum / count) ** 2 <= 9);
}
