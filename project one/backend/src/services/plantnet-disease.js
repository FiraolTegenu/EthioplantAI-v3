/**
 * PlantNet API v2 — disease identification (server-side only).
 * @see https://my.plantnet.org/doc/api/diseases
 */

import { File } from 'node:buffer';
import { getPlantNetConfig } from './plantnet.js';

const MIN_CONFIDENCE_SCORE = 0.05;
const DEBUG = process.env.DEBUG_PLANTNET === '1' || process.env.NODE_ENV === 'development';

function diseaseLog(...args) {
  if (DEBUG) console.log('[PlantNet Disease]', ...args);
}

function extractRelatedImageUrls(images = []) {
  const urls = [];
  for (const img of images) {
    const url = img?.url?.m || img?.url?.o || img?.url?.s;
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 12);
}

/** Split "Scientific name - common label" descriptions from PlantNet. */
function parseDiseaseDescription(description = '') {
  const text = String(description).trim();
  if (!text) {
    return { disease_name: '', scientific_name: '', label: '' };
  }

  const dashIdx = text.indexOf(' - ');
  if (dashIdx > 0) {
    return {
      scientific_name: text.slice(0, dashIdx).trim(),
      label: text.slice(dashIdx + 3).trim(),
      disease_name: text.slice(dashIdx + 3).trim() || text.slice(0, dashIdx).trim(),
    };
  }

  return {
    scientific_name: text,
    disease_name: text,
    label: text,
  };
}

function buildDefaultRecommendations(diseaseName) {
  const name = diseaseName || 'this condition';
  return {
    prevention: [
      'Inspect plants regularly for early signs of stress or infection.',
      'Maintain proper spacing and airflow to reduce humidity around foliage.',
      'Use clean tools and avoid working with wet plants.',
      'Remove and dispose of fallen debris near susceptible plants.',
    ],
    treatment: [
      `Consult a local agricultural extension or plant pathologist for treatments suited to ${name}.`,
      'Prune and remove severely affected tissue; do not compost infected material.',
      'Follow label directions if applying fungicides, bactericides, or insecticides.',
    ],
    monitoring: [
      'Recheck affected plants weekly and photograph changes for comparison.',
      'Watch neighboring plants for spread of similar symptoms.',
      'Record weather conditions that may worsen the outbreak.',
    ],
  };
}

function extractSymptoms(result, parsedDescription) {
  const symptoms = [];

  if (Array.isArray(result?.symptoms)) {
    for (const item of result.symptoms) {
      if (typeof item === 'string' && item.trim()) symptoms.push(item.trim());
    }
  }

  if (result?.symptom && typeof result.symptom === 'string') {
    symptoms.push(result.symptom.trim());
  }

  const categories = Array.isArray(result?.categories) ? result.categories : [];
  for (const cat of categories) {
    if (typeof cat === 'string' && cat.trim()) {
      symptoms.push(`Category: ${cat.trim()}`);
    }
  }

  if (!symptoms.length && parsedDescription.label) {
    symptoms.push(`Observed condition: ${parsedDescription.label}`);
  }

  return [...new Set(symptoms)];
}

/**
 * Normalize PlantNet disease JSON into a stable shape for Appwrite + frontend.
 */
export function parseDiseaseResponse(apiJson) {
  const results = Array.isArray(apiJson?.results) ? apiJson.results : [];

  if (!results.length) {
    return {
      status: 'no_match',
      message: 'No disease could be confidently identified.',
      detection_type: 'disease',
    };
  }

  const top = results[0];
  const score = typeof top.score === 'number' ? top.score : 0;

  if (score < MIN_CONFIDENCE_SCORE) {
    return {
      status: 'no_match',
      message: 'No disease could be confidently identified. Try a clearer photo of affected leaves or stems.',
      confidence_score: score,
      detection_type: 'disease',
      eppo_code: top.name || '',
    };
  }

  const parsedDesc = parseDiseaseDescription(top.description || '');
  const categories = Array.isArray(top.categories) ? top.categories : [];
  const diseaseCategory = categories[0] || '';
  const symptoms = extractSymptoms(top, parsedDesc);
  const recommendations = buildDefaultRecommendations(parsedDesc.disease_name || parsedDesc.scientific_name);
  const relatedImages = extractRelatedImageUrls(top.images || []);

  const plantName =
    top.plant?.commonNames?.[0] ||
    top.plant?.label ||
    top.host?.label ||
    top.host?.name ||
    '';

  const plantScientific =
    top.plant?.scientificName ||
    top.plant?.scientificNameWithoutAuthor ||
    top.host?.scientificName ||
    '';

  const alternateResults = results.slice(1, 4).map((r) => {
    const d = parseDiseaseDescription(r.description || '');
    return {
      eppo_code: r.name || '',
      disease_name: d.disease_name || r.name || '',
      scientific_name: d.scientific_name || '',
      confidence_score: typeof r.score === 'number' ? r.score : null,
    };
  });

  return {
    status: 'success',
    detection_type: 'disease',
    disease_name: parsedDesc.disease_name || top.name || '',
    scientific_name: parsedDesc.scientific_name || '',
    eppo_code: top.name || '',
    confidence_score: score,
    confidence_percent: Math.round(score * 1000) / 10,
    plant_name: plantName,
    plant_scientific_name: plantScientific,
    disease_description: top.description || parsedDesc.label || '',
    disease_category: diseaseCategory,
    symptoms,
    recommendations,
    related_images: relatedImages,
    alternate_results: alternateResults,
    api_version: apiJson?.version || '',
    remaining_requests: apiJson?.remainingIdentificationRequests ?? null,
  };
}

/**
 * Identify plant disease from an image via PlantNet /v2/diseases/identify.
 */
export async function identifyDisease(buffer, filename, mimeType = 'image/jpeg') {
  const { apiKey, apiBase } = getPlantNetConfig();

  if (!apiKey) {
    diseaseLog('Skipped — PLANTNET_API_KEY not set');
    return {
      status: 'skipped',
      message: 'PlantNet is not configured. Add PLANTNET_API_KEY to backend/.env.',
      detection_type: 'disease',
    };
  }

  const safeMime = mimeType === 'image/jpg' || mimeType === 'image/pjpeg' ? 'image/jpeg' : mimeType;
  const safeName = filename || 'disease.jpg';

  const params = new URLSearchParams({
    'api-key': apiKey,
    'include-related-images': 'true',
    lang: 'en',
  });

  const formData = new FormData();
  const file = new File([buffer], safeName, { type: safeMime || 'image/jpeg' });
  // PlantNet disease API expects "images" (plural), same as /v2/identify — not "image"
  formData.append('images', file);
  formData.append('organs', 'auto');

  const url = `${apiBase}/diseases/identify?${params}`;

  const outboundFields = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File || (typeof Blob !== 'undefined' && value instanceof Blob)) {
      outboundFields.push({
        field: key,
        filename: value.name,
        type: value.type,
        size: value.size,
      });
    } else {
      outboundFields.push({ field: key, value: String(value) });
    }
  }

  console.log('[PlantNet Disease] Outbound request:', {
    method: 'POST',
    url: `${apiBase}/diseases/identify?api-key=…&include-related-images=true&lang=en`,
    formFields: outboundFields,
    bufferBytes: buffer.length,
    filename: safeName,
    mimeType: safeMime,
  });
  diseaseLog('POST', `${apiBase}/diseases/identify`, 'file:', safeName, safeMime, 'bytes:', buffer.length);

  let response;
  try {
    response = await fetch(url, { method: 'POST', body: formData });
  } catch (networkError) {
    console.error('[PlantNet Disease] Network error:', networkError.message);
    return {
      status: 'error',
      message: 'Could not reach PlantNet. Check your internet connection and try again.',
      detail: networkError.message,
      detection_type: 'disease',
    };
  }

  diseaseLog('Response HTTP', response.status);

  if (response.status === 429) {
    return {
      status: 'rate_limit',
      message: 'PlantNet rate limit reached. Please wait a few minutes and try again.',
      detection_type: 'disease',
    };
  }

  if (response.status === 401 || response.status === 403) {
    console.error('[PlantNet Disease] Auth failed HTTP', response.status);
    return {
      status: 'error',
      message: 'PlantNet API key is invalid or not authorized.',
      detection_type: 'disease',
    };
  }

  const rawText = await response.text();
  let json;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    console.error('[PlantNet Disease] Non-JSON response:', rawText.slice(0, 200));
    return {
      status: 'error',
      message: 'PlantNet returned an unexpected response.',
      detection_type: 'disease',
    };
  }

  if (!response.ok) {
    const errMsg =
      json?.message || json?.error || `PlantNet disease request failed (HTTP ${response.status}).`;
    console.error('[PlantNet Disease] API error response:', {
      httpStatus: response.status,
      message: errMsg,
      body: json,
    });
    if (response.status === 404) {
      return {
        status: 'no_match',
        message: errMsg || 'No disease could be confidently identified.',
        detection_type: 'disease',
      };
    }
    return { status: 'error', message: errMsg, detection_type: 'disease' };
  }

  const parsed = parseDiseaseResponse(json);
  parsed.raw_api_response = json;
  diseaseLog('Parsed status:', parsed.status, parsed.disease_name || parsed.message);
  return parsed;
}

/**
 * Map stored Appwrite disease document back to API response shape.
 */
export function diseaseFromDocument(doc) {
  if (!doc) return null;

  let symptoms = [];
  let recommendations = { prevention: [], treatment: [], monitoring: [] };
  let relatedImages = [];
  let alternateResults = [];

  try {
    if (doc.symptoms) symptoms = JSON.parse(doc.symptoms);
  } catch {
    symptoms = doc.symptoms ? [doc.symptoms] : [];
  }

  try {
    if (doc.recommendations) recommendations = JSON.parse(doc.recommendations);
  } catch {
    recommendations = { prevention: [], treatment: [], monitoring: [] };
  }

  try {
    if (doc.related_images) relatedImages = JSON.parse(doc.related_images);
  } catch {
    relatedImages = [];
  }

  try {
    if (doc.alternate_results) alternateResults = JSON.parse(doc.alternate_results);
  } catch {
    alternateResults = [];
  }

  const score = doc.confidence_score != null ? Number(doc.confidence_score) : null;
  const status = doc.plantnet_status || 'unknown';
  const notes = doc.identification_notes || '';

  return {
    status,
    detection_type: doc.detection_type || 'disease',
    disease_name: doc.disease_name || '',
    scientific_name: doc.scientific_name || '',
    eppo_code: doc.eppo_code || '',
    confidence_score: score,
    confidence_percent: score != null ? Math.round(score * 1000) / 10 : null,
    plant_name: doc.plant_name || '',
    plant_scientific_name: doc.plant_scientific_name || '',
    disease_description: doc.disease_description || '',
    disease_category: doc.disease_category || '',
    symptoms,
    recommendations,
    related_images: relatedImages,
    alternate_results: alternateResults,
    identification_notes: notes,
    message: status === 'success' ? '' : notes || doc.disease_description || '',
  };
}
