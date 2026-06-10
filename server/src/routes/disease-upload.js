import '../loadEnv.js';

import { Router } from 'express';
import {
  assertAppwriteConfig,
  assertDiseaseCollectionConfig,
  uploadImageToStorage,
  saveDiseaseDetection,
  deleteStorageFile,
  buildPreviewUrl,
} from '../config/appwrite.js';
import { uploadMiddleware, handleMulterError, isAllowedImage } from '../middleware/validateImage.js';
import { identifyDisease, diseaseFromDocument } from '../services/plantnet-disease.js';

const router = Router();

router.post('/', (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    if (err) {
      handleMulterError(err, req, res, next);
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    assertAppwriteConfig();
    assertDiseaseCollectionConfig();
  } catch (configError) {
    res.status(503).json({ success: false, error: configError.message });
    return;
  }

  if (!req.file) {
    res.status(400).json({ success: false, error: 'No image file provided.' });
    return;
  }

  if (!isAllowedImage(req.file)) {
    res.status(400).json({
      success: false,
      error: 'Only JPG, JPEG, PNG, and WEBP images up to 10MB are allowed.',
    });
    return;
  }

  let uploadedFileId = null;

  try {
    const { fileId, imageUrl, previewUrl } = await uploadImageToStorage(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    uploadedFileId = fileId;

    console.log('[disease-upload] Incoming file:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferPresent: Boolean(req.file.buffer?.length),
      bufferBytes: req.file.buffer?.length ?? 0,
      reqFiles: req.files ? Object.keys(req.files) : null,
    });

    console.log('[disease-upload] Starting PlantNet disease identification for', req.file.originalname);

    let detection;
    try {
      detection = await identifyDisease(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      console.log('[disease-upload] PlantNet disease finished:', detection?.status);
    } catch (plantNetError) {
      console.error('[disease-upload] PlantNet threw:', plantNetError?.message || plantNetError);
      detection = {
        status: 'error',
        message: plantNetError?.message || 'Disease identification failed.',
        detection_type: 'disease',
      };
    }

    const document = await saveDiseaseDetection({
      imageId: fileId,
      imagePath: imageUrl,
      originalFilename: req.file.originalname,
      detection,
    });

    const storedDetection = diseaseFromDocument(document);
    const detectionPayload = {
      ...(storedDetection || {}),
      ...detection,
      status: detection?.status || storedDetection?.status || 'unknown',
      message: detection?.message || storedDetection?.message || '',
    };

    // Omit raw API response from client payload (stored in DB only)
    delete detectionPayload.raw_api_response;

    const documentId = document.$id;
    const resultsUrl = `/disease-result/${encodeURIComponent(documentId)}`;

    res.status(201).json({
      success: true,
      data: {
        image_id: fileId,
        image_url: imageUrl,
        preview_url: previewUrl || buildPreviewUrl(fileId),
        original_filename: req.file.originalname,
        uploaded_at: document.uploaded_at,
        document_id: documentId,
        detection_type: 'disease',
        detection: detectionPayload,
        results_url: resultsUrl,
      },
    });
  } catch (error) {
    if (uploadedFileId) {
      try {
        await deleteStorageFile(uploadedFileId);
      } catch {
        /* best-effort cleanup */
      }
    }

    console.error('[disease-upload] Save failed — full error:', {
      message: error?.message,
      code: error?.code,
      type: error?.type,
      response: error?.response,
    });
    if (error?.response) {
      try {
        console.error(
          '[disease-upload] Save failed — response JSON:',
          JSON.stringify(error.response, null, 2)
        );
      } catch {
        /* ignore */
      }
    }

    const raw = error?.response?.message || error?.message || 'Disease upload failed.';
    const isAppwrite =
      /collection|attribute|document|appwrite|disease_detections|unknown attribute/i.test(
        String(raw)
      );
    const message = isAppwrite
      ? `Could not save disease results to Appwrite: ${raw}`
      : raw;
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
