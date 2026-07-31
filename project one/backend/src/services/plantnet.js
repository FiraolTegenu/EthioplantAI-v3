/**

 * PlantNet API v2 — server-side identification only (API key never sent to browser).

 * @see https://my.plantnet.org/doc/api/identify

 */



import { File } from 'node:buffer';



const DEFAULT_API_BASE = 'https://my-api.plantnet.org/v2';

const MIN_CONFIDENCE_SCORE = 0.05;

const DEBUG = process.env.DEBUG_PLANTNET === '1' || process.env.NODE_ENV === 'development';



function plantNetLog(...args) {

  if (DEBUG) console.log('[PlantNet]', ...args);

}



export function getPlantNetConfig() {

  const apiKey = process.env.PLANTNET_API_KEY?.trim();

  const project = process.env.PLANTNET_PROJECT?.trim() || 'all';

  const apiBase = (process.env.PLANTNET_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');

  return { apiKey, project, apiBase };

}



/**

 * Extract display URLs from PlantNet result image objects.

 */

function extractRelatedImageUrls(images = []) {

  const urls = [];

  for (const img of images) {

    const url = img?.url?.m || img?.url?.o || img?.url?.s;

    if (url && !urls.includes(url)) urls.push(url);

  }

  return urls.slice(0, 12);

}



/**

 * Normalize PlantNet JSON into a stable shape for Appwrite + frontend.

 */

export function parsePlantNetResponse(apiJson) {

  const results = Array.isArray(apiJson?.results) ? apiJson.results : [];



  if (!results.length) {

    return {

      status: 'no_match',

      message: 'PlantNet could not find a matching species for this image.',

      best_match: apiJson?.bestMatch || null,

    };

  }



  const top = results[0];

  const score = typeof top.score === 'number' ? top.score : 0;



  if (score < MIN_CONFIDENCE_SCORE) {

    return {

      status: 'no_match',

      message: 'No confident plant match was found. Try a clearer photo of leaves or flowers.',

      best_match: apiJson?.bestMatch || null,

      confidence_score: score,

    };

  }



  const species = top.species || {};

  const scientificName =

    species.scientificName ||

    species.scientificNameWithoutAuthor ||

    apiJson?.bestMatch ||

    '';

  const commonNames = Array.isArray(species.commonNames) ? species.commonNames : [];

  const family =

    species.family?.scientificNameWithoutAuthor ||

    species.family?.scientificName ||

    '';

  const genus =

    species.genus?.scientificNameWithoutAuthor ||

    species.genus?.scientificName ||

    '';



  const relatedImages = extractRelatedImageUrls(top.images || []);



  const notes = [];

  if (apiJson?.bestMatch && apiJson.bestMatch !== scientificName) {

    notes.push(`Best match label: ${apiJson.bestMatch}`);

  }

  if (species.scientificNameAuthorship) {

    notes.push(`Authority: ${species.scientificNameAuthorship}`);

  }



  return {

    status: 'success',

    scientific_name: scientificName,

    common_names: commonNames,

    common_name: commonNames[0] || '',

    family,

    genus,

    confidence_score: score,

    confidence_percent: Math.round(score * 1000) / 10,

    related_images: relatedImages,

    identification_notes: notes.join(' · ') || '',

    raw_best_match: apiJson?.bestMatch || null,

  };

}



/**

 * Identify a plant image via PlantNet identify endpoint.

 */

export async function identifyPlant(buffer, filename, mimeType = 'image/jpeg') {

  const { apiKey, project, apiBase } = getPlantNetConfig();



  if (!apiKey) {

    plantNetLog('Skipped — PLANTNET_API_KEY not set in backend/.env');

    return {

      status: 'skipped',

      message: 'PlantNet is not configured. Add PLANTNET_API_KEY to backend/.env.',

    };

  }



  const safeMime =

    mimeType && mimeType !== 'image/jpg' ? mimeType : 'image/jpeg';

  const safeName = filename || 'plant.jpg';



  const params = new URLSearchParams({

    'api-key': apiKey,

    'include-related-images': 'true',

    lang: 'en',

  });



  const formData = new FormData();

  const file = new File([buffer], safeName, { type: safeMime });

  formData.append('images', file);

  formData.append('organs', 'auto');



  const url = `${apiBase}/identify/${encodeURIComponent(project)}?${params}`;

  plantNetLog('POST', `${apiBase}/identify/${project}`, 'file:', safeName, safeMime, 'bytes:', buffer.length);



  let response;

  try {

    response = await fetch(url, { method: 'POST', body: formData });

  } catch (networkError) {

    console.error('[PlantNet] Network error:', networkError.message);

    return {

      status: 'error',

      message: 'Could not reach PlantNet. Check your internet connection and try again.',

      detail: networkError.message,

    };

  }



  plantNetLog('Response HTTP', response.status);



  if (response.status === 429) {

    return {

      status: 'rate_limit',

      message: 'PlantNet rate limit reached. Please wait a few minutes and try again.',

    };

  }



  if (response.status === 401 || response.status === 403) {

    console.error('[PlantNet] Auth failed HTTP', response.status);

    return {

      status: 'error',

      message: 'PlantNet API key is invalid or not authorized.',

    };

  }



  let json;

  const rawText = await response.text();

  try {

    json = rawText ? JSON.parse(rawText) : {};

  } catch {

    console.error('[PlantNet] Non-JSON response:', rawText.slice(0, 200));

    return {

      status: 'error',

      message: 'PlantNet returned an unexpected response.',

    };

  }



  if (!response.ok) {

    const errMsg =

      json?.message || json?.error || `PlantNet request failed (HTTP ${response.status}).`;

    if (response.status === 404) {

      plantNetLog('No species match:', errMsg);

      return {

        status: 'no_match',

        message: errMsg || 'PlantNet could not find a matching species for this image.',

      };

    }

    console.error('[PlantNet] API error:', errMsg, json);

    return { status: 'error', message: errMsg };

  }



  const parsed = parsePlantNetResponse(json);

  plantNetLog('Parsed status:', parsed.status, parsed.scientific_name || parsed.message);

  return parsed;

}



/**

 * Map stored Appwrite fields back to identification object for API responses.

 */

export function identificationFromDocument(doc) {

  if (!doc) return null;



  let commonNames = [];

  let relatedImages = [];



  try {

    if (doc.common_names) commonNames = JSON.parse(doc.common_names);

  } catch {

    commonNames = doc.common_names ? [doc.common_names] : [];

  }



  try {

    if (doc.plantnet_result_images) relatedImages = JSON.parse(doc.plantnet_result_images);

  } catch {

    relatedImages = [];

  }



  const score =
    doc.confidence != null
      ? Number(doc.confidence)
      : doc.confidence_score != null
        ? Number(doc.confidence_score)
        : null;

  const status = doc.plantnet_status || 'unknown';

  const notes = doc.identification_notes || '';



  return {

    status,

    scientific_name: doc.scientific_name || '',

    common_name: commonNames[0] || doc.plant_title || '',

    common_names: commonNames,

    family: doc.family || '',

    genus: doc.genus || '',

    confidence_score: score,

    confidence_percent: score != null ? Math.round(score * 1000) / 10 : null,

    related_images: relatedImages,

    identification_notes: notes,

    message: status === 'success' ? '' : notes,

  };

}


