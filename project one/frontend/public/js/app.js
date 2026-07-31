document.addEventListener('DOMContentLoaded', () => {
  const views = {
    home: document.getElementById('view-home'),
    upload: document.getElementById('view-upload'),
    diseaseUpload: document.getElementById('view-disease-upload'),
  };

  const plantFeedGrid = document.getElementById('plantFeedGrid');
  const feedStatus = document.getElementById('feedStatus');
  const feedEmpty = document.getElementById('feedEmpty');
  const pageUploadForm = document.getElementById('pageUploadForm');
  const plantImageInput = document.getElementById('plantImageInput');
  const uploadPreview = document.getElementById('uploadPreview');
  const uploadPlaceholder = document.getElementById('uploadPlaceholder');
  const submitUploadBtn = document.getElementById('submitUploadBtn');
  const uploadMessage = document.getElementById('uploadMessage');
  const fileHeroUpload = document.getElementById('fileHeroUpload');
  const fileHeroDisease = document.getElementById('fileHeroDisease');
  const uploadPreviewImg = document.getElementById('uploadPreviewImg');
  const diseaseUploadForm = document.getElementById('diseaseUploadForm');
  const diseaseImageInput = document.getElementById('diseaseImageInput');
  const diseasePreview = document.getElementById('diseasePreview');
  const diseasePlaceholder = document.getElementById('diseasePlaceholder');
  const diseasePreviewImg = document.getElementById('diseasePreviewImg');
  const submitDiseaseBtn = document.getElementById('submitDiseaseBtn');
  const diseaseUploadMessage = document.getElementById('diseaseUploadMessage');

  let activePreviewObjectUrl = null;
  let activeDiseasePreviewObjectUrl = null;

  function revokePreviewObjectUrl() {
    if (activePreviewObjectUrl) {
      URL.revokeObjectURL(activePreviewObjectUrl);
      activePreviewObjectUrl = null;
    }
  }

  function revokeDiseasePreviewObjectUrl() {
    if (activeDiseasePreviewObjectUrl) {
      URL.revokeObjectURL(activeDiseasePreviewObjectUrl);
      activeDiseasePreviewObjectUrl = null;
    }
  }

  function navigateTo(viewName) {
    Object.values(views).forEach((view) => {
      view.classList.add('hidden');
      view.classList.remove('flex');
    });
    const target = views[viewName];
    if (!target) return;
    target.classList.remove('hidden');
    target.classList.add('flex');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showUploadMessage(text, isError) {
    if (!uploadMessage) return;
    uploadMessage.textContent = text;
    uploadMessage.classList.remove('hidden', 'msg--success', 'msg--error');
    uploadMessage.classList.add(isError ? 'msg--error' : 'msg--success');
  }

  function clearUploadMessage() {
    if (!uploadMessage) return;
    uploadMessage.textContent = '';
    uploadMessage.classList.add('hidden');
    uploadMessage.classList.remove('msg--success', 'msg--error');
  }

  function showDiseaseUploadMessage(text, isError) {
    if (!diseaseUploadMessage) return;
    diseaseUploadMessage.textContent = text;
    diseaseUploadMessage.classList.remove('hidden', 'msg--success', 'msg--error');
    diseaseUploadMessage.classList.add(isError ? 'msg--error' : 'msg--success');
  }

  function clearDiseaseUploadMessage() {
    if (!diseaseUploadMessage) return;
    diseaseUploadMessage.textContent = '';
    diseaseUploadMessage.classList.add('hidden');
    diseaseUploadMessage.classList.remove('msg--success', 'msg--error');
  }

  function setFeedStatus(message, isError = false) {
    if (!feedStatus) return;
    feedStatus.textContent = message || '';
    feedStatus.classList.toggle('hidden', !message);
    feedStatus.classList.toggle('msg--error', Boolean(message && isError));
    feedStatus.classList.toggle('msg--info', Boolean(message && !isError));
  }

  function applyImagePreview(file) {
    const validation = window.PlantUpload.validateImageFile(file);
    if (!validation.valid) {
      showUploadMessage(validation.error, true);
      return false;
    }
    clearUploadMessage();
    revokePreviewObjectUrl();
    activePreviewObjectUrl = URL.createObjectURL(file);
    if (uploadPreviewImg) {
      uploadPreviewImg.src = activePreviewObjectUrl;
      uploadPreviewImg.classList.remove('hidden');
    }
    uploadPreview.classList.remove('hidden');
    uploadPlaceholder.classList.add('hidden');
    return true;
  }

  function clearImagePreview() {
    revokePreviewObjectUrl();
    if (uploadPreviewImg) {
      uploadPreviewImg.removeAttribute('src');
      uploadPreviewImg.classList.add('hidden');
    }
    uploadPreview.classList.add('hidden');
    uploadPlaceholder.classList.remove('hidden');
  }

  function showGallerySkeleton(count = 8) {
    plantFeedGrid.innerHTML = '';
    if (feedEmpty) feedEmpty.classList.add('hidden');
    for (let i = 0; i < count; i += 1) {
      plantFeedGrid.appendChild(window.PlantGallery.createSkeletonCard());
    }
  }

  function renderGallery(images) {
    plantFeedGrid.innerHTML = '';

    if (!images.length) {
      if (feedEmpty) feedEmpty.classList.remove('hidden');
      return;
    }

    if (feedEmpty) feedEmpty.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    let rendered = 0;

    images.forEach((image) => {
      try {
        fragment.appendChild(window.PlantGallery.createPlantCard(image));
        rendered += 1;
      } catch (cardError) {
        console.warn('[gallery] Skipped card render:', image?.document_id, cardError);
      }
    });

    plantFeedGrid.appendChild(fragment);

    if (rendered === 0) {
      if (feedEmpty) feedEmpty.classList.remove('hidden');
    }
  }

  async function loadGallery({ force = false } = {}) {
    showGallerySkeleton();
    setFeedStatus('Loading community uploads…');

    const result = await window.PlantUpload.fetchImages({ force });

    if (!result.success) {
      plantFeedGrid.innerHTML = '';
      if (feedEmpty) feedEmpty.classList.remove('hidden');
      setFeedStatus(result.error, true);
      console.error('[gallery] Load failed:', result.error);
      return;
    }

    const apiImages = result.data || [];
    const skipped = result.meta?.skipped ?? 0;

    const validImages = window.PlantImageDisplay?.filterLoadableGalleryImages
      ? await window.PlantImageDisplay.filterLoadableGalleryImages(apiImages)
      : apiImages.filter((image) => window.PlantImageDisplay?.isGalleryRecordValid?.(image));

    const filteredOut = apiImages.length - validImages.length;

    if (window.__APP_CONFIG__?.debug) {
      console.log('[gallery] API records:', apiImages.length, 'valid after load check:', validImages.length);
      if (skipped > 0) console.warn('[gallery] Skipped on server:', skipped);
      if (filteredOut > 0) console.warn('[gallery] Skipped after image validation:', filteredOut);
    }

    const count = validImages.length;
    let statusMsg = '';
    if (count === 0) {
      statusMsg = '';
    } else if (count === 1) {
      statusMsg = 'Showing 1 latest upload';
    } else {
      statusMsg = `Showing ${count} latest uploads`;
    }

    setFeedStatus(statusMsg, false);
    renderGallery(validImages);
  }

  function openUploadPicker() {
    if (window.PlantUpload.isUploadInProgress()) {
      showUploadMessage('Please wait for the current upload to finish.', true);
      return;
    }
    fileHeroUpload.click();
  }

  function openDiseasePicker() {
    if (window.PlantUpload.isUploadInProgress()) {
      showDiseaseUploadMessage('Please wait for the current upload to finish.', true);
      return;
    }
    fileHeroDisease.click();
  }

  function applyDiseaseImagePreview(file) {
    const validation = window.PlantUpload.validateImageFile(file);
    if (!validation.valid) {
      showDiseaseUploadMessage(validation.error, true);
      return false;
    }
    clearDiseaseUploadMessage();
    revokeDiseasePreviewObjectUrl();
    activeDiseasePreviewObjectUrl = URL.createObjectURL(file);
    if (diseasePreviewImg) {
      diseasePreviewImg.src = activeDiseasePreviewObjectUrl;
      diseasePreviewImg.classList.remove('hidden');
    }
    diseasePreview.classList.remove('hidden');
    diseasePlaceholder.classList.add('hidden');
    return true;
  }

  function clearDiseaseImagePreview() {
    revokeDiseasePreviewObjectUrl();
    if (diseasePreviewImg) {
      diseasePreviewImg.removeAttribute('src');
      diseasePreviewImg.classList.add('hidden');
    }
    diseasePreview.classList.add('hidden');
    diseasePlaceholder.classList.remove('hidden');
  }

  document.querySelectorAll('.nav-home').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      clearUploadMessage();
      navigateTo('home');
    });
  });

  document.querySelectorAll('[data-action="upload"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openUploadPicker();
    });
  });

  document.querySelectorAll('[data-action="disease"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openDiseasePicker();
    });
  });

  plantImageInput.addEventListener('change', function onPick() {
    if (this.files?.[0] && !applyImagePreview(this.files[0])) {
      this.value = '';
    }
  });

  fileHeroUpload.addEventListener('change', function onHeroPick() {
    const file = this.files?.[0];
    if (!file) return;

    if (!applyImagePreview(file)) {
      this.value = '';
      return;
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    plantImageInput.files = dt.files;
    navigateTo('upload');
  });

  diseaseImageInput?.addEventListener('change', function onDiseasePick() {
    if (this.files?.[0] && !applyDiseaseImagePreview(this.files[0])) {
      this.value = '';
    }
  });

  fileHeroDisease?.addEventListener('change', function onHeroDiseasePick() {
    const file = this.files?.[0];
    if (!file) return;

    if (!applyDiseaseImagePreview(file)) {
      this.value = '';
      return;
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    diseaseImageInput.files = dt.files;
    navigateTo('diseaseUpload');
  });

  pageUploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearUploadMessage();

    if (window.PlantUpload.isUploadInProgress()) {
      showUploadMessage('Please wait for the current upload to finish.', true);
      return;
    }

    const file = plantImageInput.files?.[0];
    const validation = window.PlantUpload.validateImageFile(file);
    if (!validation.valid) {
      showUploadMessage(validation.error, true);
      return;
    }

    const originalHTML = submitUploadBtn.innerHTML;
    submitUploadBtn.disabled = true;
    plantImageInput.disabled = true;
    submitUploadBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Uploading…</span>';

    const plantTitle = document.getElementById('uploadName').value.trim() || 'Unknown Species';
    const location = document.getElementById('uploadLocation').value.trim();

    submitUploadBtn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span><span>Uploading &amp; identifying…</span>';

    const result = await window.PlantUpload.uploadImage(file, { plantTitle, location });

    if (!result.success) {
      showUploadMessage(result.error, true);
      submitUploadBtn.innerHTML = originalHTML;
      submitUploadBtn.disabled = false;
      plantImageInput.disabled = false;
      return;
    }

    window.PlantUpload.invalidateImagesCache();

    const resultsUrl =
      result.data?.results_url ||
      (result.data?.document_id
        ? `results.html?id=${encodeURIComponent(result.data.document_id)}`
        : null);

    if (resultsUrl) {
      const docId = result.data?.document_id;
      if (docId) {
        try {
          if (result.data?.identification) {
            sessionStorage.setItem(
              `plantIdentification:${docId}`,
              JSON.stringify(result.data.identification)
            );
          }
          if (result.data?.image_url || result.data?.preview_url) {
            sessionStorage.setItem(
              `plantImageMeta:${docId}`,
              JSON.stringify({
                image_url: result.data.image_url,
                preview_url: result.data.preview_url,
                image_id: result.data.image_id,
              })
            );
          }
          if (activePreviewObjectUrl) {
            sessionStorage.setItem(`plantImageLocal:${docId}`, activePreviewObjectUrl);
          }
        } catch {
          /* ignore quota errors */
        }
      }
      showUploadMessage('Upload complete. Opening identification results…', false);
      window.location.href = resultsUrl;
      return;
    }

    showUploadMessage('Image uploaded successfully.', false);
    submitUploadBtn.innerHTML = originalHTML;
    submitUploadBtn.disabled = false;
    plantImageInput.disabled = false;
    pageUploadForm.reset();
    clearImagePreview();
    fileHeroUpload.value = '';

    await loadGallery({ force: true });
    navigateTo('home');
  });

  diseaseUploadForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearDiseaseUploadMessage();

    if (window.PlantUpload.isUploadInProgress()) {
      showDiseaseUploadMessage('Please wait for the current upload to finish.', true);
      return;
    }

    const file = diseaseImageInput.files?.[0];
    const validation = window.PlantUpload.validateImageFile(file);
    if (!validation.valid) {
      showDiseaseUploadMessage(validation.error, true);
      return;
    }

    const originalHTML = submitDiseaseBtn.innerHTML;
    submitDiseaseBtn.disabled = true;
    diseaseImageInput.disabled = true;
    submitDiseaseBtn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span><span>Analyzing image…</span>';

    const result = await window.PlantUpload.uploadDiseaseImage(file);

    if (!result.success) {
      showDiseaseUploadMessage(result.error, true);
      submitDiseaseBtn.innerHTML = originalHTML;
      submitDiseaseBtn.disabled = false;
      diseaseImageInput.disabled = false;
      return;
    }

    const docId = result.data?.document_id;
    const resultsUrl =
      result.data?.results_url ||
      (docId ? `/disease-result.html?id=${encodeURIComponent(docId)}` : null);

    if (docId) {
      try {
        if (result.data?.detection) {
          sessionStorage.setItem(
            `diseaseDetection:${docId}`,
            JSON.stringify(result.data.detection)
          );
        }
        if (result.data?.image_url || result.data?.preview_url) {
          sessionStorage.setItem(
            `diseaseImageMeta:${docId}`,
            JSON.stringify({
              image_url: result.data.image_url,
              preview_url: result.data.preview_url,
              image_id: result.data.image_id,
            })
          );
        }
        if (activeDiseasePreviewObjectUrl) {
          sessionStorage.setItem(`diseaseImageLocal:${docId}`, activeDiseasePreviewObjectUrl);
        }
      } catch {
        /* ignore quota errors */
      }
    }

    const status = result.data?.detection?.status;
    const successMsg =
      status === 'success'
        ? 'Disease detected successfully. Opening results…'
        : status === 'no_match'
          ? 'Analysis complete. Opening results…'
          : 'Upload complete. Opening results…';
    showDiseaseUploadMessage(successMsg, false);

    if (resultsUrl) {
      window.location.href = resultsUrl;
      return;
    }

    showDiseaseUploadMessage('Image analyzed successfully.', false);
    submitDiseaseBtn.innerHTML = originalHTML;
    submitDiseaseBtn.disabled = false;
    diseaseImageInput.disabled = false;
    diseaseUploadForm.reset();
    clearDiseaseImagePreview();
    fileHeroDisease.value = '';
    navigateTo('home');
  });

  loadGallery();
  navigateTo('home');

  const urlMode = new URLSearchParams(window.location.search).get('mode');
  if (urlMode === 'upload') {
    window.history.replaceState({}, '', 'index.html');
    openUploadPicker();
  } else if (urlMode === 'disease') {
    window.history.replaceState({}, '', 'index.html');
    openDiseasePicker();
  }
});
