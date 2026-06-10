import '../loadEnv.js';

import { Router } from 'express';

import {

  assertAppwriteConfig,

  uploadImageToStorage,

  saveImageMetadata,

  deleteStorageFile,

  buildPreviewUrl,

} from '../config/appwrite.js';

import { uploadMiddleware, handleMulterError, isAllowedImage } from '../middleware/validateImage.js';

import { identifyPlant, identificationFromDocument } from '../services/plantnet.js';



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

  } catch (configError) {

    res.status(503).json({

      success: false,

      error: configError.message,

    });

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

    // 1. Appwrite Storage (unchanged workflow)

    const { fileId, imageUrl, previewUrl } = await uploadImageToStorage(

      req.file.buffer,

      req.file.originalname,

      req.file.mimetype

    );

    uploadedFileId = fileId;



    const plantTitle = (req.body.plant_title || req.body.plantTitle || '').trim();

    const location = (req.body.location || '').trim();



    // 2. PlantNet identification (await before saving metadata)
    console.log('[upload] Starting PlantNet identification for', req.file.originalname);

    let identification;

    try {
      identification = await identifyPlant(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      console.log('[upload] PlantNet finished:', identification?.status);
    } catch (plantNetError) {
      console.error('[upload] PlantNet threw:', plantNetError?.message || plantNetError);
      identification = {
        status: 'error',
        message: plantNetError?.message || 'PlantNet identification failed.',
      };
    }



    // 3. Appwrite Database — existing fields + PlantNet metadata

    const document = await saveImageMetadata({

      imageId: fileId,

      imageUrl,

      originalFilename: req.file.originalname,

      plantTitle: plantTitle || undefined,

      location: location || undefined,

      identification,

    });



    const storedIdentification = identificationFromDocument(document);
    const identificationPayload = {
      ...(storedIdentification || {}),
      ...identification,
      status: identification?.status || storedIdentification?.status || 'unknown',
      message: identification?.message || storedIdentification?.message || '',
    };



    res.status(201).json({

      success: true,

      data: {

        image_id: fileId,

        image_url: imageUrl,

        preview_url: previewUrl || buildPreviewUrl(fileId),

        original_filename: req.file.originalname,

        uploaded_at: document.uploaded_at,

        document_id: document.$id,

        plant_title: document.plant_title || plantTitle || req.file.originalname.replace(/\.[^.]+$/, ''),

        location: document.location || location,

        identification: identificationPayload,

        results_url: `/results.html?id=${encodeURIComponent(document.$id)}`,

      },

    });

  } catch (error) {

    if (uploadedFileId) {

      try {

        await deleteStorageFile(uploadedFileId);

      } catch {

        // Best-effort cleanup

      }

    }



    const message = error?.response?.message || error?.message || 'Upload failed.';

    res.status(500).json({ success: false, error: message });

  }

});



export default router;

