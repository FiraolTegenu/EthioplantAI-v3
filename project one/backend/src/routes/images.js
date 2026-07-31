import { Router } from 'express';
import { assertAppwriteConfig, listPlantImages, GALLERY_LIMIT } from '../config/appwrite.js';

const router = Router();
const DEBUG = process.env.DEBUG_GALLERY === '1' || process.env.NODE_ENV === 'development';

router.get('/', async (_req, res) => {
  try {
    assertAppwriteConfig();
    const { images, skipped, limit } = await listPlantImages(GALLERY_LIMIT);

    if (DEBUG) {
      console.log(
        `[gallery] Query: orderDesc("$createdAt"), limit(${limit}) → ${images.length} images, ${skipped.length} skipped`
      );
      images.forEach((img) => {
        console.log('[gallery] record', {
          document_id: img.document_id,
          image_id: img.image_id,
          preview_url: img.preview_url,
          image_url: img.image_url,
        });
      });
      if (skipped.length) console.log('[gallery] Skipped records:', skipped);
    }

    res.json({
      success: true,
      data: images,
      meta: {
        count: images.length,
        limit,
        skipped: skipped.length,
      },
    });
  } catch (error) {
    const message = error?.response?.message || error?.message || 'Failed to load images.';
    const status = message.includes('not configured') ? 503 : 500;

    if (DEBUG) {
      console.error('[gallery] Load failed:', message, error);
    }

    res.status(status).json({ success: false, error: message, data: [] });
  }
});

export default router;
