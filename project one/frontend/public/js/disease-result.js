/**
 * Disease results page — loads detection from GET /api/disease/:id
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
    if (isDebug()) console.log('[disease-result]', ...args);
  }

  function getDocumentIdFromUrl() {
    const pathMatch = window.location.pathname.match(/\/disease-result\/([^/]+)/);
    if (pathMatch) return decodeURIComponent(pathMatch[1]).trim();

    const params = new URLSearchParams(window.location.search);
    return params.get('id')?.trim() || '';
  }

  function readCachedDetection(documentId) {
    try {
      const raw = sessionStorage.getItem(`diseaseDetection:${documentId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readCachedImageMeta(documentId) {
    try {
      const raw = sessionStorage.getItem(`diseaseImageMeta:${documentId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readLocalPreviewUrl(documentId) {
    return sessionStorage.getItem(`diseaseImageLocal:${documentId}`) || '';
  }

  function mergeDetection(apiData, cached) {
    if (!cached) return apiData;
    return {
      ...apiData,
      detection: {
        ...(apiData.detection || {}),
        ...cached,
        status: cached.status || apiData.detection?.status,
        message: cached.message || apiData.detection?.message,
      },
    };
  }

  function pickImageUrls(data, documentId) {
    const cached = readCachedImageMeta(documentId);
    const local = readLocalPreviewUrl(documentId);

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
      instant: local || previewUrl || viewUrl,
      display: previewUrl || viewUrl,
      full: viewUrl || previewUrl,
    };
  }

  function showError(message) {
    document.getElementById('diseaseLoading')?.classList.add('hidden');
    document.getElementById('diseaseContent')?.classList.add('hidden');
    const el = document.getElementById('diseaseError');
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  function setStatusMessage(message, type) {
    const box = document.getElementById('diseaseStatusMessage');
    if (!box || !message) return;
    box.textContent = message;
    box.classList.remove('hidden', 'results-status--info', 'results-status--warn', 'results-status--error');
    box.classList.add(`results-status--${type || 'info'}`);
  }

  function mountResultImage(data, documentId) {
    const img = document.getElementById('diseaseUserImage');
    const skeleton = document.getElementById('diseaseImageSkeleton');
    const errorEl = document.getElementById('diseaseImageError');
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

    img.alt = data.original_filename || 'Uploaded plant image';
  }

  function renderListItems(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el || !items?.length) return;
    el.innerHTML = '';
    items.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      el.appendChild(li);
    });
  }

  function renderSymptoms(symptoms) {
    const section = document.getElementById('sectionSymptoms');
    const list = document.getElementById('symptomsList');
    const tags = document.getElementById('symptomsTags');
    if (!section || !symptoms?.length) return;

    list.innerHTML = '';
    symptoms.forEach((symptom) => {
      const li = document.createElement('li');
      li.textContent = symptom;
      list.appendChild(li);
    });

    if (tags && symptoms.length <= 6) {
      tags.innerHTML = '';
      symptoms.forEach((symptom) => {
        const span = document.createElement('span');
        span.className =
          'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-brand-bgTop text-brand-accent border border-brand-border/60';
        span.textContent = symptom;
        tags.appendChild(span);
      });
      tags.classList.remove('hidden');
    }

    section.classList.remove('hidden');
  }

  function renderRecommendations(recommendations) {
    const section = document.getElementById('sectionRecommendations');
    if (!section || !recommendations) return;

    const hasContent =
      recommendations.prevention?.length ||
      recommendations.treatment?.length ||
      recommendations.monitoring?.length;

    if (!hasContent) return;

    renderListItems('recPrevention', recommendations.prevention);
    renderListItems('recTreatment', recommendations.treatment);
    renderListItems('recMonitoring', recommendations.monitoring);
    section.classList.remove('hidden');
  }

  function renderAlternateResults(alternate) {
    const section = document.getElementById('sectionAlternate');
    const container = document.getElementById('alternateResults');
    if (!section || !container || !alternate?.length) return;

    container.innerHTML = '';
    alternate.forEach((item) => {
      const row = document.createElement('div');
      row.className =
        'flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-brand-bgTop/60 border border-brand-border/40 text-sm';
      const name = item.disease_name || item.eppo_code || 'Unknown';
      const sci = item.scientific_name ? ` (${item.scientific_name})` : '';
      const score =
        item.confidence_score != null
          ? `${Math.round(item.confidence_score * 1000) / 10}%`
          : '—';
      row.innerHTML = `<span class="font-medium text-brand-textDark">${name}${sci}</span><span class="text-gray-500">${score}</span>`;
      container.appendChild(row);
    });
    section.classList.remove('hidden');
  }

  function renderRelatedImages(urls) {
    const section = document.getElementById('sectionDiseaseRelated');
    const grid = document.getElementById('diseaseRelatedGrid');
    if (!section || !grid || !urls?.length) return;

    grid.innerHTML = '';
    urls.forEach((url) => {
      const img = document.createElement('img');
      const resolved = window.PlantImageDisplay?.resolveImageUrl(url) || url;
      img.src = resolved;
      img.alt = 'Related disease reference';
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
    const det = data.detection || {};
    const status = det.status || 'unknown';

    document.getElementById('diseaseLoading')?.classList.add('hidden');
    document.getElementById('diseaseError')?.classList.add('hidden');
    document.getElementById('diseaseContent')?.classList.remove('hidden');

    mountResultImage(data, documentId);

    const diseaseName = det.disease_name || '—';
    const scientific = det.scientific_name || '—';

    document.getElementById('diseaseTitle').textContent =
      status === 'success' ? diseaseName : 'Disease analysis result';
    document.getElementById('diseaseSubtitle').textContent =
      status === 'success' && scientific !== '—' ? scientific : '';
    document.getElementById('diseaseName').textContent = diseaseName;
    document.getElementById('diseaseScientific').textContent = scientific;

    if (det.disease_category) {
      document.getElementById('diseaseCategory').textContent = det.disease_category;
      document.getElementById('diseaseCategoryWrap')?.classList.remove('hidden');
    }

    document.getElementById('diseasePlantName').textContent = det.plant_name || '—';
    document.getElementById('diseasePlantScientific').textContent = det.plant_scientific_name || '—';

    const badge = document.getElementById('diseaseConfidenceBadge');
    const confVal = document.getElementById('diseaseConfidenceValue');
    if (det.confidence_percent != null && status === 'success') {
      badge?.classList.remove('hidden');
      if (confVal) confVal.textContent = `${det.confidence_percent}%`;
    } else {
      badge?.classList.add('hidden');
    }

    if (data.uploaded_at) {
      document.getElementById('diseaseMetaDate').textContent = `Uploaded ${new Date(data.uploaded_at).toLocaleString()}`;
    }

    if (status === 'success') {
      setStatusMessage('Disease detected successfully.', 'info');
    } else if (status === 'no_match') {
      setStatusMessage(det.message || 'No disease could be confidently identified.', 'warn');
    } else if (status === 'rate_limit') {
      setStatusMessage(det.message || 'PlantNet rate limit reached.', 'error');
    } else if (status === 'skipped') {
      setStatusMessage(det.message || 'PlantNet is not configured on the server.', 'warn');
    } else if (status === 'error') {
      setStatusMessage(det.message || 'Disease identification failed.', 'error');
    }

    if (det.disease_description) {
      document.getElementById('diseaseDescription').textContent = det.disease_description;
      document.getElementById('sectionDiseaseDescription')?.classList.remove('hidden');
    }

    renderSymptoms(det.symptoms);
    renderRecommendations(det.recommendations);
    renderAlternateResults(det.alternate_results);
    renderRelatedImages(det.related_images);
  }

  async function loadResults() {
    const documentId = getDocumentIdFromUrl();

    if (!documentId) {
      showError('Missing result ID. Upload an image from the home page using Identify Disease.');
      return;
    }

    const cachedMeta = readCachedImageMeta(documentId);
    const localPreview = readLocalPreviewUrl(documentId);
    if (localPreview || cachedMeta) {
      renderResults(
        mergeDetection(
          {
            document_id: documentId,
            image_url: cachedMeta?.image_url,
            preview_url: cachedMeta?.preview_url,
            detection: readCachedDetection(documentId) || {},
          },
          readCachedDetection(documentId)
        ),
        documentId
      );
    }

    try {
      const response = await fetch(
        `${getApiBase()}/api/disease/${encodeURIComponent(documentId)}`,
        { headers: { Accept: 'application/json' } }
      );

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();

      if (contentType.includes('text/html') || rawText.trimStart().startsWith('<!')) {
        if (!localPreview && !cachedMeta) {
          showError(
            'Could not load disease results. Ensure the backend is running and VITE_API_URL is set for production.'
          );
        }
        return;
      }

      let payload;
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!localPreview && !cachedMeta) {
          showError('Invalid response from disease API.');
        }
        return;
      }

      if (!response.ok || !payload.success) {
        if (!localPreview && !cachedMeta) {
          showError(payload.error || `Could not load results (HTTP ${response.status}).`);
        }
        return;
      }

      const cached = readCachedDetection(documentId);
      renderResults(mergeDetection(payload.data, cached), documentId);
    } catch (err) {
      console.error('[disease-result]', err);
      if (!localPreview && !cachedMeta) {
        showError('Network error while loading disease results.');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', loadResults);
})();
