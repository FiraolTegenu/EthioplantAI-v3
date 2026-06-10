# Appwrite setup for plant image uploads

This project uploads images through a **Node.js server** so your Appwrite API key never appears in the browser.

## 1. Install dependencies

```bash
cd server
npm install
```

## 2. Environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `APPWRITE_ENDPOINT` | `https://sgp.cloud.appwrite.io/v1` for Singapore region projects |
| `APPWRITE_PROJECT_ID` | Project ID from Appwrite Console → Settings |
| `APPWRITE_API_KEY` | Server API key with **Storage** and **Databases** scopes |
| `APPWRITE_BUCKET_ID` | Storage bucket ID |
| `APPWRITE_DATABASE_ID` | Database ID |
| `APPWRITE_COLLECTION_ID` | Collection ID (e.g. `plant_images`) |
| `PORT` | Local server port (default `3000`) |
| `CLIENT_ORIGIN` | Frontend origin for CORS (default `http://localhost:3000`) |

**Never** put `APPWRITE_API_KEY` in `index.html` or any frontend file.

## 3. Storage bucket

1. Appwrite Console → **Storage** → create a bucket (e.g. `plant-images`).
2. Note the **Bucket ID** for `APPWRITE_BUCKET_ID`.

### Bucket permissions (public viewing)

For uploaded images to be viewable via the public file URL:

- **Create**: leave default or restrict to your API key usage (uploads use the server API key).
- **Read**: add **`Any`** (guest) read permission on the bucket **or** set read permission on each file at upload time (the server already sets `read("any")` on each file).

Recommended bucket settings:

| Permission | Role |
|------------|------|
| Read | Any |
| Create | Users (optional; server uses API key) |
| Update | None (for anonymous uploads) |
| Delete | None (for anonymous uploads) |

Enable **File security** if you rely on per-file `read("any")` permissions from the server.

Allowed file extensions in the bucket (optional): `jpg`, `jpeg`, `png`, `webp`  
Max file size: **10 MB** (match app validation).

## 4. Database collection

1. **Databases** → create a database → note `APPWRITE_DATABASE_ID`.
2. Create a collection (e.g. `plant_images`) → note `APPWRITE_COLLECTION_ID`.
3. Add these **attributes** (see `server/src/schemas/plant-images.collection.json`):

| Attribute | Type | Size | Required |
|-----------|------|------|----------|
| `image_id` | String | 36 | Yes |
| `image_url` | String | 2048 | Yes |
| `original_filename` | String | 255 | Yes |
| `uploaded_at` | DateTime | — | Yes |
| `plant_title` | String | 255 | No (recommended for gallery labels) |
| `location` | String | 512 | No |

4. **Collection permissions** (for server API key writes):

| Permission | Role |
|------------|------|
| Create | Any *or* restrict to API key only via document security off and server key |
| Read | Any (if you want public metadata reads later) |

With `documentSecurity: false`, the API key can create documents when it has the **databases.write** scope.

5. Optional index: `uploaded_at` DESC for sorting feeds later.

## 5. API key

Console → **API Keys** → create key with scopes:

- `files.read`, `files.write` (Storage)
- `databases.read`, `databases.write` (Databases)

## 6. Run the app

```bash
cd server
npm start
```

Open **http://localhost:3000** (not `file://`). Pick an image and submit **Upload & identify**. You are redirected to `results.html` with PlantNet details. Refresh the home page — uploads still appear via `GET /api/images`.

For PlantNet configuration, see [PLANTNET_SETUP.md](./PLANTNET_SETUP.md).

## 7. Verify

- File appears in Storage with a unique ID.
- Document appears in the collection with `image_id`, `image_url`, `original_filename`, `uploaded_at`.
- Opening `image_url` in a browser shows the image.

## Troubleshooting

| Issue | Check |
|-------|--------|
| 503 “Appwrite is not configured” | `server/.env` exists and all variables are set |
| 401 / 403 from Appwrite | API key scopes and bucket/collection permissions |
| Image URL 404 | Bucket/file read permission for `Any` |
| CORS error | `CLIENT_ORIGIN` matches the URL you use to open the site |
