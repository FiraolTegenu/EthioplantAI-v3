/**
 * Client API: validation, upload, and gallery fetch.
 */
(function () {
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ]);
  const ALLOWED_EXTENSION = /\.(jpe?g|png|webp)$/i;

  let uploadInProgress = false;
  let imagesCache = null;
  let imagesCacheAt = 0;
  const CACHE_TTL_MS = 30_000;

  function isDebug() {
    return typeof window.__APP_CONFIG__ !== 'undefined' && window.__APP_CONFIG__.debug === true;
  }

  function debugLog(...args) {
    if (isDebug()) console.log('[PlantUpload]', ...args);
  }

  function getApiBase() {
    if (typeof window.__APP_CONFIG__ !== 'undefined' && window.__APP_CONFIG__.apiBase != null) {
      return window.__APP_CONFIG__.apiBase;
    }
    return '';
  }

  function validateImageFile(file) {
    if (!file) {
      return { valid: false, error: 'Please select an image to upload.' };
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { valid: false, error: 'Only JPG, JPEG, PNG, and WEBP images are allowed.' };
    }
    if (!ALLOWED_EXTENSION.test(file.name)) {
      return { valid: false, error: 'Only JPG, JPEG, PNG, and WEBP images are allowed.' };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: 'Image must be 10MB or smaller.' };
    }
    return { valid: true };
  }

  function isUploadInProgress() {
    return uploadInProgress;
  }

  function invalidateImagesCache() {
    imagesCache = null;
    imagesCacheAt = 0;
  }

  function normalizeGalleryPayload(payload, response) {
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        error: `Gallery API returned an invalid response (HTTP ${response.status}).`,
        data: [],
      };
    }

    if (payload.success === true) {
      const data = Array.isArray(payload.data) ? payload.data : [];
      return { ok: true, data, meta: payload.meta || null };
    }

    if (Array.isArray(payload.data) && payload.success !== false) {
      return { ok: true, data: payload.data, meta: payload.meta || null };
    }

    return {
      ok: false,
      error: payload.error || `Gallery API reported failure (HTTP ${response.status}).`,
      data: [],
    };
  }

  async function parseGalleryResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    debugLog('GET /api/images', {
      status: response.status,
      contentType,
      bodyPreview: rawText.slice(0, 120),
    });

    if (contentType.includes('text/html') || rawText.trimStart().startsWith('<!')) {
      return {
        ok: false,
        error:
          'Gallery API returned the web page instead of JSON. Start the backend with "npm start" in the server folder and open http://localhost:3000 (not Live Server or file://).',
        data: [],
      };
    }

    let payload;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      debugLog('JSON parse error', parseError);
      return {
        ok: false,
        error: `Gallery API returned non-JSON data (HTTP ${response.status}). Check server logs.`,
        data: [],
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error || `Gallery request failed (HTTP ${response.status}).`,
        data: [],
      };
    }

    return normalizeGalleryPayload(payload, response);
  }

  async function fetchImages({ force = false } = {}) {
    const now = Date.now();
    if (!force && imagesCache && now - imagesCacheAt < CACHE_TTL_MS) {
      return { success: true, data: imagesCache };
    }

    try {
      const response = await fetch(`${getApiBase()}/api/images`, {
        headers: { Accept: 'application/json' },
      });

      const parsed = await parseGalleryResponse(response);

      if (!parsed.ok) {
        return { success: false, error: parsed.error, data: [] };
      }

      imagesCache = parsed.data;
      imagesCacheAt = now;
      return { success: true, data: imagesCache, meta: parsed.meta };
    } catch (networkError) {
      debugLog('Network error', networkError);
      return {
        success: false,
        error: 'Could not reach the server. Run "npm start" in the server folder, then open http://localhost:3000.',
        data: [],
      };
    }
  }

  async function uploadDiseaseImage(file) {
    if (uploadInProgress) {
      return { success: false, error: 'An upload is already in progress.' };
    }

    const validation = validateImageFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    uploadInProgress = true;

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${getApiBase()}/api/disease-upload`, {
        method: 'POST',
        body: formData,
      });

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      let payload = {};

      if (contentType.includes('application/json')) {
        try {
          payload = rawText ? JSON.parse(rawText) : {};
        } catch {
          payload = {};
        }
      }

      if (!response.ok || payload.success !== true) {
        if (contentType.includes('text/html')) {
          return {
            success: false,
            error: 'Disease API unavailable. Use "npm start" in the server folder at http://localhost:3000.',
          };
        }
        return {
          success: false,
          error: payload.error || `Disease upload failed (HTTP ${response.status}).`,
        };
      }

      debugLog('Disease upload success', {
        document_id: payload.data?.document_id,
        results_url: payload.data?.results_url,
        status: payload.data?.detection?.status,
      });
      return { success: true, data: payload.data };
    } catch {
      return {
        success: false,
        error: 'Could not reach the upload server. Start the server with npm start in the server folder.',
      };
    } finally {
      uploadInProgress = false;
    }
  }

  async function uploadImage(file, metadata = {}) {
    if (uploadInProgress) {
      return { success: false, error: 'An upload is already in progress.' };
    }

    const validation = validateImageFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    uploadInProgress = true;

    try {
      const formData = new FormData();
      formData.append('image', file);
      if (metadata.plantTitle) formData.append('plant_title', metadata.plantTitle);
      if (metadata.location) formData.append('location', metadata.location);

      const response = await fetch(`${getApiBase()}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      let payload = {};

      if (contentType.includes('application/json')) {
        try {
          payload = rawText ? JSON.parse(rawText) : {};
        } catch {
          payload = {};
        }
      }

      if (!response.ok || payload.success !== true) {
        if (contentType.includes('text/html')) {
          return {
            success: false,
            error: 'Upload API unavailable. Use "npm start" in the server folder at http://localhost:3000.',
          };
        }
        return {
          success: false,
          error: payload.error || `Upload failed (HTTP ${response.status}).`,
        };
      }

      invalidateImagesCache();
      debugLog('Upload success', {
        document_id: payload.data?.document_id,
        results_url: payload.data?.results_url,
        plantnet_status: payload.data?.identification?.status,
      });
      return { success: true, data: payload.data };
    } catch {
      return {
        success: false,
        error: 'Could not reach the upload server. Start the server with npm start in the server folder.',
      };
    } finally {
      uploadInProgress = false;
    }
  }

  window.PlantUpload = {
    validateImageFile,
    uploadImage,
    uploadDiseaseImage,
    fetchImages,
    isUploadInProgress,
    invalidateImagesCache,
  };
})();
