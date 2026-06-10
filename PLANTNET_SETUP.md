# PlantNet integration setup

PlantNet runs **only on the server**. The API key is never sent to the browser.

## 1. Get an API key

1. Create an account at [my.plantnet.org](https://my.plantnet.org).
2. Open your dashboard and copy your **API key**.

## 2. Configure `server/.env`

```env
PLANTNET_API_KEY=your_private_api_key
PLANTNET_PROJECT=all
```

- `PLANTNET_PROJECT` — flora scope (use `all` or a regional project from PlantNet docs).
- Optional: omit `PLANTNET_API_KEY` to skip identification (uploads still work; status `skipped`).

## 3. Appwrite collection attributes

Add these **optional** attributes to your existing `plant_images` collection (see `server/src/schemas/plant-images.collection.json`):

| Attribute | Type |
|-----------|------|
| `scientific_name` | String (512) |
| `common_names` | String (2048) — JSON array |
| `family` | String (255) |
| `genus` | String (255) |
| `confidence` | Float (0–1, best-match score) |
| `confidence_score` | Float (same as `confidence`, compatibility) |
| `plantnet_status` | String (32) |
| `plantnet_result_images` | String (8192) — JSON URL array |
| `identification_notes` | String (2048) |

Existing attributes (`image_id`, `image_url`, etc.) are unchanged.

## 4. Data flow

```
User upload → Appwrite Storage → PlantNet API → Appwrite Database → results.html
```

## 5. API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload + identify + save (unchanged Appwrite upload) |
| POST | `/api/disease-upload` | Upload + disease identify + save to disease collection |
| GET | `/api/identification/:documentId` | Load stored results for results page |
| GET | `/api/disease/:documentId` | Load stored disease detection results |
| GET | `/api/images` | Gallery list (unchanged) |

## 6. Disease detection collection

Create a `disease_detections` collection in Appwrite using `server/src/schemas/disease-detections.collection.json`, then set:

```env
APPWRITE_DISEASE_COLLECTION_ID=your_disease_collection_id
```

Disease results open at `/disease-result/{documentId}` (redirects to `disease-result.html`).

## 7. Error states on results page

| Status | Meaning |
|--------|---------|
| `success` | Match found with confidence score |
| `no_match` | No confident species match |
| `rate_limit` | PlantNet quota exceeded |
| `error` | API or network failure |
| `skipped` | No `PLANTNET_API_KEY` configured |
