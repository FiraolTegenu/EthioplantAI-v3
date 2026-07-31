/**

 * Results page — loads identification from Appwrite via GET /api/identification/:id

 */

(function () {

  function getApiBase() {

    if (typeof window.__APP_CONFIG__ !== 'undefined' && window.__APP_CONFIG__.apiBase != null) {

      return window.__APP_CONFIG__.apiBase;

    }

    return '';

  }



  function isDebug() {

    return typeof window.__APP_CONFIG__ !== 'undefined' && window.__APP_CONFIG__.debug === true;

  }



  function debugLog(...args) {

    if (isDebug()) console.log('[results]', ...args);

  }



  function getDocumentIdFromUrl() {

    const params = new URLSearchParams(window.location.search);

    return params.get('id')?.trim() || '';

  }



  function readCachedIdentification(documentId) {

    try {

      const raw = sessionStorage.getItem(`plantIdentification:${documentId}`);

      return raw ? JSON.parse(raw) : null;

    } catch {

      return null;

    }

  }



  function readCachedImageMeta(documentId) {

    try {

      const raw = sessionStorage.getItem(`plantImageMeta:${documentId}`);

      return raw ? JSON.parse(raw) : null;

    } catch {

      return null;

    }

  }



  function readLocalPreviewUrl(documentId) {

    return sessionStorage.getItem(`plantImageLocal:${documentId}`) || '';

  }



  function mergeIdentification(apiData, cached) {

    if (!cached) return apiData;

    return {

      ...apiData,

      identification: {

        ...(apiData.identification || {}),

        ...cached,

        status: cached.status || apiData.identification?.status,

        message: cached.message || apiData.identification?.message,

      },

    };

  }



  function pickImageUrls(data, documentId) {

    const cached = readCachedImageMeta(documentId);

    const local = readLocalPreviewUrl(documentId);

    const usableLocal = local && !local.startsWith('blob:') ? local : '';



    const viewUrl =

      data.image_url ||

      (data.image_id ? `/api/files/${encodeURIComponent(data.image_id)}/view` : '') ||

      cached?.image_url ||

      '';



    const previewUrl =

      data.preview_url ||

      (data.image_id ? `/api/files/${encodeURIComponent(data.image_id)}/preview` : '') ||

      cached?.preview_url ||

      viewUrl;



    return {

      instant: usableLocal || previewUrl || viewUrl,

      display: previewUrl || viewUrl,

      full: viewUrl || previewUrl,

    };

  }



  function showError(message) {

    document.getElementById('resultsLoading')?.classList.add('hidden');

    document.getElementById('resultsContent')?.classList.add('hidden');

    const el = document.getElementById('resultsError');

    if (el) {

      el.textContent = message;

      el.classList.remove('hidden');

    }

  }



  function setStatusMessage(message, type) {

    const box = document.getElementById('resultStatusMessage');

    if (!box || !message) return;

    box.textContent = message;

    box.classList.remove('hidden', 'results-status--info', 'results-status--warn', 'results-status--error');

    box.classList.add(`results-status--${type || 'info'}`);

  }



  function mountResultImage(data, documentId) {

    const img = document.getElementById('resultUserImage');

    const skeleton = document.getElementById('resultImageSkeleton');

    const errorEl = document.getElementById('resultImageError');

    if (!img) return;



    const urls = pickImageUrls(data, documentId);

    debugLog('Image URLs', urls);



    if (!urls.instant && !urls.display && !urls.full) {

      if (skeleton) skeleton.classList.add('hidden');

      if (errorEl) errorEl.classList.remove('hidden');

      return;

    }



    const display = window.PlantImageDisplay;



    const showFull = () => {

      if (!urls.full || urls.full === urls.instant) return;

      display

        ?.preload(urls.full)

        .then((resolved) => {

          display.loadInto(img, resolved, { skeletonEl: skeleton, errorEl });

        })

        .catch((err) => debugLog('Full image preload skipped', err.message));

    };



    if (display) {

      display.loadInto(img, urls.instant || urls.display, {

        skeletonEl: skeleton,

        errorEl,

        onReady: showFull,

        onFail: () => {

          if (urls.display && urls.display !== urls.instant) {

            display.loadInto(img, urls.display, {

              skeletonEl: skeleton,

              errorEl,

              onReady: showFull,

            });

            return;

          }

          if (urls.full && urls.full !== urls.instant) {

            display.loadInto(img, urls.full, { skeletonEl: skeleton, errorEl });

          }

        },

      });

    } else {

      img.src = urls.instant || urls.display;

      img.classList.remove('hidden');

      if (skeleton) skeleton.classList.add('hidden');

    }



    img.alt = data.plant_title || 'Uploaded plant';

  }



  function renderRelatedImages(urls) {

    const section = document.getElementById('sectionRelated');

    const grid = document.getElementById('relatedImagesGrid');

    if (!section || !grid || !urls?.length) return;



    grid.innerHTML = '';

    urls.forEach((url) => {

      const img = document.createElement('img');

      const resolved = window.PlantImageDisplay?.resolveImageUrl(url) || url;

      img.src = resolved;

      img.alt = 'Related plant reference';

      img.loading = 'lazy';

      img.decoding = 'async';

      img.className = 'w-full aspect-square object-cover rounded-xl border border-gray-100';

      img.onerror = () => {

        img.classList.add('opacity-40');

      };

      grid.appendChild(img);

    });

    section.classList.remove('hidden');

  }



  function renderResults(data, documentId) {

    const id = data.identification || {};

    const status = id.status || 'unknown';



    document.getElementById('resultsLoading')?.classList.add('hidden');

    document.getElementById('resultsError')?.classList.add('hidden');

    document.getElementById('resultsContent')?.classList.remove('hidden');



    mountResultImage(data, documentId);



    const scientific = id.scientific_name || '—';

    const common =

      id.common_name ||

      (Array.isArray(id.common_names) && id.common_names[0]) ||

      data.plant_title ||

      '—';



    document.getElementById('resultTitle').textContent =

      status === 'success' ? scientific : data.plant_title || 'Identification result';

    document.getElementById('resultSubtitle').textContent =

      status === 'success' ? common : '';

    document.getElementById('resultScientific').textContent = scientific;

    document.getElementById('resultCommon').textContent =

      Array.isArray(id.common_names) && id.common_names.length > 1

        ? id.common_names.join(', ')

        : common;

    document.getElementById('resultFamily').textContent = id.family || '—';

    document.getElementById('resultGenus').textContent = id.genus || '—';



    const badge = document.getElementById('confidenceBadge');

    const confVal = document.getElementById('confidenceValue');

    if (id.confidence_percent != null && status === 'success') {

      badge?.classList.remove('hidden');

      if (confVal) confVal.textContent = `${id.confidence_percent}%`;

    } else {

      badge?.classList.add('hidden');

    }



    if (data.location) {

      document.getElementById('resultMetaLocation').textContent = `Location: ${data.location}`;

    }

    if (data.uploaded_at) {

      document.getElementById('resultMetaDate').textContent = `Uploaded ${new Date(data.uploaded_at).toLocaleString()}`;

    }



    if (status === 'success') {

      setStatusMessage('Identified using PlantNet.', 'info');

    } else if (status === 'no_match') {

      setStatusMessage(id.message || 'No confident match found.', 'warn');

    } else if (status === 'rate_limit') {

      setStatusMessage(id.message || 'PlantNet rate limit reached.', 'error');

    } else if (status === 'skipped') {

      setStatusMessage(id.message || 'PlantNet is not configured on the server.', 'warn');

    } else if (status === 'error') {

      setStatusMessage(id.message || 'PlantNet identification failed.', 'error');

    }



    const notes = id.identification_notes || id.message;

    if (notes && status === 'success') {

      document.getElementById('resultNotes').textContent = notes;

      document.getElementById('sectionNotes')?.classList.remove('hidden');

    } else if (notes) {

      document.getElementById('resultNotes').textContent = notes;

      document.getElementById('sectionNotes')?.classList.remove('hidden');

    }



    renderRelatedImages(id.related_images);

    window.PlantChatContext?.publishFromIdentificationData?.(
      { ...data, identification: id, disease: data.disease },
      documentId
    );

  }



  async function loadResults() {

    const documentId = getDocumentIdFromUrl();



    if (!documentId) {

      showError('Missing result ID. Upload a plant image from the home page first.');

      return;

    }



    const cachedMeta = readCachedImageMeta(documentId);

    const localPreview = readLocalPreviewUrl(documentId);

    if (localPreview || cachedMeta) {

      renderResults(

        mergeIdentification(

          {

            document_id: documentId,

            plant_title: '',

            image_url: cachedMeta?.image_url,

            preview_url: cachedMeta?.preview_url,

            identification: readCachedIdentification(documentId) || {},

          },

          readCachedIdentification(documentId)

        ),

        documentId

      );

    }



    try {

      const response = await fetch(

        `${getApiBase()}/api/identification/${encodeURIComponent(documentId)}`,

        { headers: { Accept: 'application/json' } }

      );



      const contentType = response.headers.get('content-type') || '';

      const rawText = await response.text();



      if (contentType.includes('text/html') || rawText.trimStart().startsWith('<!')) {

        if (!localPreview && !cachedMeta) {

          showError(

            'Could not load results. Ensure the backend is running and VITE_API_URL is set for production.'

          );

        }

        return;

      }



      let payload;

      try {

        payload = rawText ? JSON.parse(rawText) : {};

      } catch {

        if (!localPreview && !cachedMeta) {

          showError('Invalid response from identification API.');

        }

        return;

      }



      if (!response.ok || !payload.success) {

        if (!localPreview && !cachedMeta) {

          showError(payload.error || `Could not load results (HTTP ${response.status}).`);

        }

        return;

      }



      const cached = readCachedIdentification(documentId);

      renderResults(mergeIdentification(payload.data, cached), documentId);

    } catch (err) {

      console.error('[results]', err);

      if (!localPreview && !cachedMeta) {

        showError('Network error while loading identification results.');

      }

    }

  }



  document.addEventListener('DOMContentLoaded', loadResults);

})();


