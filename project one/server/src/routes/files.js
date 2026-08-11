import { Router } from 'express';
import { assertAppwriteConfig, getStorage, getAppwriteIds } from '../config/appwrite.js';

const router = Router();

/**
 * Stream Appwrite storage files through the server so the browser never needs
 * direct (401) access to Appwrite URLs.
 */
router.get('/:fileId/view', async (req, res) => {
  await streamFile(req, res, 'view');
});

router.get('/:fileId/preview', async (req, res) => {
  await streamFile(req, res, 'preview');
});

async function streamFile(req, res, mode) {
  try {
    assertAppwriteConfig();
  } catch (configError) {
    res.status(503).json({ success: false, error: configError.message });
    return;
  }

  const { fileId } = req.params;
  if (!fileId?.trim()) {
    res.status(400).json({ success: false, error: 'Missing file id.' });
    return;
  }

  const storage = getStorage();
  const { bucketId } = getAppwriteIds();

  try {
    const meta = await storage.getFile(bucketId, fileId);
    let buffer;

    if (mode === 'preview') {
      const width = Math.min(Number(req.query.width) || 480, 1920);
      const height = Math.min(Number(req.query.height) || 360, 1920);
      const quality = Math.min(Number(req.query.quality) || 82, 100);
      try {
        buffer = await storage.getFilePreview(bucketId, fileId, width, height, undefined, quality);
        res.set('Content-Type', 'image/webp');
      } catch (previewError) {
        console.warn(`[files] preview failed for ${fileId}, using view:`, previewError?.message);
        buffer = await storage.getFileView(bucketId, fileId);
        res.set('Content-Type', meta.mimeType || 'application/octet-stream');
      }
    } else {
      buffer = await storage.getFileView(bucketId, fileId);
      res.set('Content-Type', meta.mimeType || 'application/octet-stream');
    }

    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (error) {
    const message = error?.response?.message || error?.message || 'Image not found.';
    console.error(`[files] ${mode} ${fileId} failed:`, message);
    res.status(error?.code === 404 ? 404 : 500).json({ success: false, error: message });
  }
}

export default router;
