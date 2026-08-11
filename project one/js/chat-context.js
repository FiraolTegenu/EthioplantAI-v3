/**
 * Gathers plant/disease context for the farming assistant (no API keys).
 */
(function () {
  const STORAGE_PREFIX = 'plantChatContext:';

  function getDocumentIdFromUrl() {
    return new URLSearchParams(window.location.search).get('id')?.trim() || '';
  }

  function readJson(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function parseCommonNames(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return typeof raw === 'string' && raw.trim() ? [raw.trim()] : [];
    }
  }

  function buildPlantFromData(data, identification) {
    const id = identification || data?.identification || {};
    const commonNames = parseCommonNames(id.common_names || data?.common_names);
    const score = id.confidence_score ?? data?.confidence_score;
    const confidencePercent =
      id.confidence_percent != null
        ? id.confidence_percent
        : score != null && !Number.isNaN(Number(score))
          ? Math.round(Number(score) * 1000) / 10
          : null;

    const plant = {
      scientific_name: id.scientific_name || data?.scientific_name || '',
      common_name:
        id.common_name || commonNames[0] || data?.common_name || data?.plant_title || '',
      family: id.family || data?.family || '',
      genus: id.genus || data?.genus || '',
      confidence_score: score,
      confidence_percent: confidencePercent,
      location: data?.location || '',
    };

    const hasPlant = Object.values(plant).some((v) => v != null && v !== '');
    return hasPlant ? plant : null;
  }

  function buildFromPage() {
    if (window.__CHAT_PLANT_CONTEXT__) {
      return { ...window.__CHAT_PLANT_CONTEXT__ };
    }

    const documentId = getDocumentIdFromUrl();
    if (!documentId) return {};

    const stored = readJson(`${STORAGE_PREFIX}${documentId}`);
    if (stored) return stored;

    const cachedId = readJson(`plantIdentification:${documentId}`);
    const plant = buildPlantFromData({}, cachedId);
    if (plant) {
      return { plant, document_id: documentId };
    }

    return { document_id: documentId };
  }

  function publishContext(context) {
    if (!context || typeof context !== 'object') return;
    window.__CHAT_PLANT_CONTEXT__ = context;
    const docId = context.document_id;
    if (docId) {
      try {
        sessionStorage.setItem(`${STORAGE_PREFIX}${docId}`, JSON.stringify(context));
      } catch {
        /* quota */
      }
    }
    window.dispatchEvent(new CustomEvent('plantchat:context', { detail: context }));
  }

  function publishFromIdentificationData(data, documentId) {
    const plant = buildPlantFromData(data, data?.identification);
    const context = {
      document_id: documentId || data?.document_id || getDocumentIdFromUrl(),
    };
    if (plant) context.plant = plant;
    if (data?.disease) context.disease = data.disease;
    publishContext(context);
  }

  window.PlantChatContext = {
    get: buildFromPage,
    publish: publishContext,
    publishFromIdentificationData,
    getDocumentId: getDocumentIdFromUrl,
  };
})();
