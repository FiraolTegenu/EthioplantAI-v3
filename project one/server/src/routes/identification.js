import { Router } from 'express';
import {
  assertAppwriteConfig,
  getPlantDocumentById,
  buildPreviewUrl,
} from '../config/appwrite.js';
import { identificationFromDocument } from '../services/plantnet.js';

const router = Router();

/**
 * GET /api/identification/:documentId — load stored upload + PlantNet results.
 */
router.get('/:documentId', async (req, res) => {
  try {
    assertAppwriteConfig();
  } catch (configError) {
    res.status(503).json({ success: false, error: configError.message });
    return;
  }

  const { documentId } = req.params;

  try {
    const record = await getPlantDocumentById(documentId);

    if (!record) {
      res.status(404).json({
        success: false,
        error: 'Identification record not found.',
      });
      return;
    }

    const identification = identificationFromDocument(record);

    res.json({
      success: true,
      data: {
        document_id: record.document_id,
        image_id: record.image_id,
        image_url: record.image_url,
        preview_url: record.preview_url || buildPreviewUrl(record.image_id),
        plant_title: record.plant_title,
        location: record.location,
        original_filename: record.original_filename,
        uploaded_at: record.uploaded_at,
        identification,
      },
    });
  } catch (error) {
    const message = error?.response?.message || error?.message || 'Failed to load identification.';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
