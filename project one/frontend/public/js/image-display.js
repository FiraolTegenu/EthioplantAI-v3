/**
 * Shared image URL helpers and progressive loading for gallery/results.
 */
(function () {
  const API_UNAVAILABLE_MSG =
    'Could not reach the API server. Ensure the backend is running and VITE_API_URL is set for production.';

  function detectApiBase() {
    if (window.__APP_CONFIG__?.apiBase != null) {
      return window.__APP_CONFIG__.apiBase;
    }
    return '';
  }

  function isDebug() {
    return window.__APP_CONFIG__?.debug === true;
  }

  function debugLog(...args) {
    if (isDebug()) console.log('[PlantImage]', ...args);
  }

  function resolveImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) {
      return url;
    }
    const base = detectApiBase().replace(/\/$/, '');
    return `${base}${url.startsWith('/') ? url : `/${url}`}`;
  }

  function galleryUrlsForRecord(image) {
    const fileId = image?.image_id;
    if (!fileId) {
      return {
        thumb: resolveImageUrl(image?.preview_url || image?.image_url || ''),
        full: resolveImageUrl(image?.image_url || image?.preview_url || ''),
      };
    }

    const thumbPath = `/api/files/${encodeURIComponent(fileId)}/preview?width=480&height=360&quality=82`;
    const viewPath = `/api/files/${encodeURIComponent(fileId)}/view`;

    return {
      thumb: resolveImageUrl(image?.preview_url || thumbPath),
      full: resolveImageUrl(image?.image_url || viewPath),
      view: resolveImageUrl(viewPath),
    };
  }

  function loadInto(img, url, options = {}) {
    const { skeletonEl, errorEl, onReady, onFail } = options;
    const resolved = resolveImageUrl(url);

    if (!img || !resolved) {
      if (errorEl) errorEl.classList.remove('hidden');
      if (skeletonEl) skeletonEl.classList.add('hidden');
      onFail?.();
      return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    if (skeletonEl) skeletonEl.classList.remove('hidden');
    img.classList.remove('hidden');

    const finishOk = () => {
      if (skeletonEl) skeletonEl.classList.add('hidden');
      img.classList.add('is-loaded');
      onReady?.();
    };

    const finishErr = () => {
      if (skeletonEl) skeletonEl.classList.add('hidden');
      img.classList.remove('is-loaded');
      if (errorEl) errorEl.classList.remove('hidden');
      onFail?.();
    };

    img.onload = () => finishOk();
    img.onerror = () => finishErr();

    if (img.complete && img.naturalWidth > 0 && img.src === resolved) {
      finishOk();
      return;
    }

    img.src = resolved;
  }

  function loadGalleryImage(img, image, options = {}) {
    const { loaderEl, onFail } = options;
    const urls = galleryUrlsForRecord(image);

    debugLog('gallery load', {
      document_id: image?.document_id,
      image_id: image?.image_id,
      thumb: urls.thumb,
      full: urls.full,
    });

    if (!urls.thumb && !urls.full) {
      onFail?.(image);
      return;
    }

    const hideLoader = () => loaderEl?.classList.add('is-hidden');
    const showLoader = () => loaderEl?.classList.remove('is-hidden');

    const trySrc = (src, next) => {
      if (!src) {
        next();
        return;
      }
      showLoader();
      img.classList.remove('plant-card__img--error');
      img.onload = () => {
        hideLoader();
        img.classList.add('is-loaded');
      };
      img.onerror = () => {
        debugLog('gallery image failed', src);
        next();
      };
      img.src = src;
    };

    trySrc(urls.thumb, () => {
      trySrc(urls.full, () => {
        trySrc(urls.view, () => {
          hideLoader();
          img.classList.add('plant-card__img--error');
          img.removeAttribute('src');
          onFail?.(image);
        });
      });
    });
  }

  function preload(url) {
    const resolved = resolveImageUrl(url);
    if (!resolved) return Promise.reject(new Error('empty url'));
    return new Promise((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve(resolved);
      probe.onerror = () => reject(new Error(`failed: ${resolved}`));
      probe.src = resolved;
    });
  }

  const invalidGalleryFileIds = new Set();

  function isGalleryRecordValid(image) {
    if (!image || typeof image !== 'object') return false;
    const fileId = String(image.image_id || '').trim();
    if (!fileId || invalidGalleryFileIds.has(fileId)) return false;
    const imageUrl = String(image.image_url || '').trim();
    const previewUrl = String(image.preview_url || '').trim();
    if (!imageUrl && !previewUrl) return false;
    return true;
  }

  async function canLoadGalleryImage(image) {
    if (!isGalleryRecordValid(image)) return false;
    const fileId = String(image.image_id).trim();
    const urls = galleryUrlsForRecord(image);
    const candidates = [urls.thumb, urls.full, urls.view].filter(Boolean);
    if (!candidates.length) {
      invalidGalleryFileIds.add(fileId);
      return false;
    }

    for (const url of candidates) {
      try {
        await preload(url);
        return true;
      } catch {
        debugLog('preload failed', url);
      }
    }

    invalidGalleryFileIds.add(fileId);
    return false;
  }

  async function filterLoadableGalleryImages(images) {
    if (!Array.isArray(images) || !images.length) return [];
    const checked = await Promise.all(
      images.map(async (image) => ((await canLoadGalleryImage(image)) ? image : null))
    );
    return checked.filter(Boolean);
  }

  window.PlantImageDisplay = {
    detectApiBase,
    resolveImageUrl,
    galleryUrlsForRecord,
    loadInto,
    loadGalleryImage,
    preload,
    isGalleryRecordValid,
    filterLoadableGalleryImages,
    API_UNAVAILABLE_MSG,
  };
})();
