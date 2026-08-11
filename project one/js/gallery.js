/**

 * Gallery rendering with lazy-loaded images and skeleton placeholders.

 */

(function () {

  function escapeHtml(text) {

    const div = document.createElement('div');

    div.textContent = text ?? '';

    return div.innerHTML;

  }



  function isDebug() {

    return typeof window.__APP_CONFIG__ !== 'undefined' && window.__APP_CONFIG__.debug === true;

  }



  function debugLog(...args) {

    if (isDebug()) console.log('[gallery]', ...args);

  }



  function formatDate(iso) {

    if (!iso) return '';

    try {

      return new Date(iso).toLocaleDateString(undefined, {

        month: 'short',

        day: 'numeric',

        year: 'numeric',

      });

    } catch {

      return '';

    }

  }



  function createSkeletonCard() {

    const article = document.createElement('article');

    article.className = 'plant-card plant-card--skeleton';

    article.innerHTML = `

      <div class="plant-card__media skeleton"></div>

      <div class="plant-card__body">

        <div class="skeleton skeleton-line skeleton-line--title"></div>

        <div class="skeleton skeleton-line skeleton-line--short"></div>

        <div class="skeleton skeleton-line skeleton-line--badge"></div>

      </div>

    `;

    return article;

  }



  function createPlantCard(image) {

    const identified = image.plantnet_status === 'success' && image.scientific_name;

    const title = identified ? image.scientific_name : image.plant_title || 'Unknown Species';

    const subtitle = identified ? image.plant_title || '' : '';

    const location = image.location || 'Location not specified';

    const dateLabel = formatDate(image.uploaded_at);

    const alt = image.plant_title || image.original_filename || 'Plant image';

    const badgeLabel = identified ? 'Identified' : 'Pending ID';

    const badgeClass = identified

      ? 'plant-card__badge plant-card__badge--identified'

      : 'plant-card__badge';

    const resultsHref = image.document_id

      ? `results.html?id=${encodeURIComponent(image.document_id)}`

      : '';



    const article = document.createElement('article');

    article.className = 'plant-card';

    if (resultsHref) {

      article.classList.add('plant-card--clickable');

      article.tabIndex = 0;

      article.setAttribute('role', 'link');

      article.setAttribute('aria-label', `View identification for ${title}`);

    }

    article.dataset.documentId = image.document_id || '';

    article.dataset.imageId = image.image_id || '';



    const media = document.createElement('div');

    media.className = 'plant-card__media';



    const loader = document.createElement('div');

    loader.className = 'plant-card__loader skeleton';

    loader.setAttribute('aria-hidden', 'true');



    const img = document.createElement('img');

    img.alt = alt;

    img.loading = 'lazy';

    img.decoding = 'async';

    img.className = 'plant-card__img';



    media.appendChild(loader);

    media.appendChild(img);



    const body = document.createElement('div');

    body.className = 'plant-card__body';

    body.innerHTML = `

      <h3 class="plant-card__title">${escapeHtml(title)}</h3>

      ${subtitle ? `<p class="text-xs text-gray-500">${escapeHtml(subtitle)}</p>` : ''}

      <p class="plant-card__location">${escapeHtml(location)}</p>

      <div class="plant-card__footer">

        <span class="plant-card__date">${escapeHtml(dateLabel)}</span>

        <span class="${badgeClass}">${escapeHtml(badgeLabel)}</span>

      </div>

    `;



    article.appendChild(media);

    article.appendChild(body);



    if (resultsHref) {

      const go = () => {

        window.location.href = resultsHref;

      };

      article.addEventListener('click', go);

      article.addEventListener('keydown', (e) => {

        if (e.key === 'Enter' || e.key === ' ') {

          e.preventDefault();

          go();

        }

      });

    }



    if (window.PlantImageDisplay?.loadGalleryImage) {

      window.PlantImageDisplay.loadGalleryImage(img, image, {

        loaderEl: loader,

        onFail: (record) => {

          debugLog('removing card after load failure', record?.document_id, record?.image_id);

          article.remove();

        },

      });

    } else {

      const urls = window.PlantImageDisplay?.galleryUrlsForRecord?.(image) || {};

      img.src = urls.thumb || urls.full || '';

      img.addEventListener('load', () => loader.classList.add('is-hidden'), { once: true });

      img.addEventListener('error', () => {

        debugLog('removing card after load failure', image?.document_id);

        article.remove();

      }, { once: true });

    }



    return article;

  }



  window.PlantGallery = {

    createSkeletonCard,

    createPlantCard,

    formatDate,

  };

})();


