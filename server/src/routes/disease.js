import { Router } from 'express';
import {
  assertAppwriteConfig,
  assertDiseaseCollectionConfig,
  getDiseaseDocumentById,
  buildPreviewUrl,
} from '../config/appwrite.js';
import { diseaseFromDocument } from '../services/plantnet-disease.js';

const router = Router();

/**
 * GET /api/disease/:documentId — load stored disease detection results.
 */
router.get('/:documentId', async (req, res) => {
  try {
    assertAppwriteConfig();
    assertDiseaseCollectionConfig();
  } catch (configError) {
    res.status(503).json({ success: false, error: configError.message });
    return;
  }

  const { documentId } = req.params;

  try {
    const record = await getDiseaseDocumentById(documentId);

    if (!record) {
      res.status(404).json({
        success: false,
        error: 'Disease detection record not found.',
      });
      return;
    }

    const detection = diseaseFromDocument(record);

    res.json({
      success: true,
      data: {
        document_id: record.document_id,
        image_id: record.image_id,
        image_url: record.image_url,
        preview_url: record.preview_url || buildPreviewUrl(record.image_id),
        original_filename: record.original_filename,
        uploaded_at: record.uploaded_at,
        detection_type: record.detection_type,
        detection,
      },
    });
  } catch (error) {
    const message = error?.response?.message || error?.message || 'Failed to load disease results.';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
