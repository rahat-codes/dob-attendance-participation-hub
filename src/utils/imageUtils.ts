/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Processes any uploaded profile photo:
 * 1. Accepts any image file size (from tiny icons to 50MB+ camera shots).
 * 2. Automatically center-crops (aspect-cover) into a 1:1 square so the subject is well-placed and centered without distortion.
 * 3. Scales down to crisp avatar dimensions (default 256x256).
 * 4. Compresses to JPEG (~20-40KB) ensuring it easily fits Firestore's 1MB document limit.
 */
export async function processProfilePhoto(
  source: File | string,
  targetSize = 256,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrlToRevoke: string | null = null;

    img.onload = () => {
      try {
        if (objectUrlToRevoke) {
          URL.revokeObjectURL(objectUrlToRevoke);
        }

        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        if (!naturalWidth || !naturalHeight) {
          reject(new Error('Invalid image dimensions'));
          return;
        }

        // Automatic center crop: choose the smallest dimension to form a 1:1 square
        const sSize = Math.min(naturalWidth, naturalHeight);
        const sx = (naturalWidth - sSize) / 2;
        const sy = (naturalHeight - sSize) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        // High quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw centered square crop
        ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, targetSize, targetSize);

        // Convert to high-efficiency JPEG
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
      reject(new Error('Failed to load image for processing'));
    };

    if (source instanceof File) {
      objectUrlToRevoke = URL.createObjectURL(source);
      img.src = objectUrlToRevoke;
    } else if (typeof source === 'string') {
      img.crossOrigin = 'anonymous';
      img.src = source;
    } else {
      reject(new Error('Invalid image source'));
    }
  });
}
