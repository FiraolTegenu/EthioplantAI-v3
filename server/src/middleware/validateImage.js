import multer from 'multer';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function getExtension(filename = '') {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot).toLowerCase();
}

export function isAllowedImage(file) {
  if (!file) return false;
  const ext = getExtension(file.originalname);
  return ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext);
}

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!isAllowedImage(file)) {
      cb(new Error('Only JPG, JPEG, PNG, and WEBP images up to 10MB are allowed.'));
      return;
    }
    cb(null, true);
  },
}).single('image');

export function handleMulterError(err, _req, res, next) {
  if (!err) {
    next();
    return;
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ success: false, error: 'Image must be 10MB or smaller.' });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  res.status(400).json({ success: false, error: err.message || 'Invalid upload.' });
}
