/**
 * AI Farming Assistant — floating chat UI (talks to POST /api/chat only).
 */
(function () {
  const MAX_HISTORY = 40;
  const HISTORY_KEY = 'farmChatHistory';

  function getApiBase() {
    if (window.__APP_CONFIG__?.apiBase != null) return window.__APP_CONFIG__.apiBase;
    return '';
  }

  /** Map backend error codes to accurate user messages (server was reached). */
  function resolveChatError(body, response) {
    if (body?.error) return body.error;
    const code = body?.code;
    if (code === 'auth_failed') {
      return 'Invalid Groq API key. Check GROQ_API_KEY in server/.env';
    }
    if (code === 'not_configured') {
      return 'The farming assistant is not configured. Set GROQ_API_KEY in server/.env';
    }
    if (code === 'rate_limit') {
      return 'Groq API rate limit reached. Please wait a moment and try again.';
    }
    if (response && !response.ok) {
      return `The server responded with an error (HTTP ${response.status}). Please try again.`;
    }
    return 'The farming assistant could not respond. Please try again.';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
  }

  /** Format assistant text: headings, bullets, numbered lists, paragraphs. */
  function formatAssistantHtml(text) {
    const lines = String(text || '').split('\n');
    const parts = [];
    let listType = null;
    let listItems = [];

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      parts.push(
        `<${tag} class="chat-formatted__list">${listItems.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</${tag}>`
      );
      listItems = [];
      listType = null;
    }

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flushList();
        continue;
      }

      const headingMatch = line.match(/^(.{2,80}):$/);
      if (headingMatch && !line.startsWith('http')) {
        flushList();
        parts.push(`<h4 class="chat-formatted__heading">${escapeHtml(headingMatch[1])}</h4>`);
        continue;
      }

      const numMatch = line.match(/^\d+[.)]\s+(.+)$/);
      if (numMatch) {
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listItems.push(numMatch[1]);
        continue;
      }

      const bulletMatch = line.match(/^[•\-*]\s+(.+)$/);
      if (bulletMatch) {
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listItems.push(bulletMatch[1]);
        continue;
      }

      flushList();
      parts.push(`<p class="chat-formatted__p">${escapeHtml(line)}</p>`);
    }

    flushList();
    return parts.join('') || `<p class="chat-formatted__p">${escapeHtml(text)}</p>`;
  }

  function createWidget() {
    const root = document.createElement('div');
    root.id = 'farmChatRoot';
    root.className = 'farm-chat';
    root.innerHTML = `
      <button type="button" id="farmChatToggle" class="farm-chat__fab" aria-expanded="false" aria-controls="farmChatPanel" title="Farming Assistant">
        <svg class="farm-chat__fab-icon farm-chat__fab-icon--open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4z"></path>
        </svg>
        <svg class="farm-chat__fab-icon farm-chat__fab-icon--close hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        <span class="sr-only">Open farming assistant</span>
      </button>

      <div id="farmChatPanel" class="farm-chat__panel hidden" role="dialog" aria-label="AI Farming Assistant">
        <header class="farm-chat__header">
          <div>
            <h2 class="farm-chat__title">Farming Assistant</h2>
            <p class="farm-chat__subtitle">Crop care, pests, soil &amp; plant health</p>
          </div>
          <button type="button" id="farmChatClose" class="farm-chat__icon-btn" aria-label="Close chat">&times;</button>
        </header>

        <div id="farmChatContext" class="farm-chat__context hidden" aria-live="polite"></div>

        <div id="farmChatMessages" class="farm-chat__messages" aria-live="polite"></div>

        <div id="farmChatTyping" class="farm-chat__typing hidden" aria-hidden="true">
          <span class="farm-chat__typing-dot"></span>
          <span class="farm-chat__typing-dot"></span>
          <span class="farm-chat__typing-dot"></span>
          <span class="farm-chat__typing-label">Assistant is typing…</span>
        </div>

        <div id="farmChatError" class="farm-chat__error hidden" role="alert">
          <p id="farmChatErrorText"></p>
          <button type="button" id="farmChatRetry" class="farm-chat__retry-btn">Try again</button>
        </div>

        <footer class="farm-chat__footer">
          <textarea id="farmChatInput" class="farm-chat__input" rows="2" placeholder="Ask about crops, pests, irrigation…" maxlength="4000"></textarea>
          <button type="button" id="farmChatSend" class="farm-chat__send" aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.6l17.2-8.6L3.4 3.4l2.9 6.3 7.5 1.1-7.5 1.1-2.9 6.3z"></path></svg>
          </button>
        </footer>

        <div class="farm-chat__toolbar">
          <button type="button" id="farmChatClear" class="farm-chat__toolbar-btn">Clear chat</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function init() {
    createWidget();

    const toggle = document.getElementById('farmChatToggle');
    const panel = document.getElementById('farmChatPanel');
    const closeBtn = document.getElementById('farmChatClose');
    const messagesEl = document.getElementById('farmChatMessages');
    const input = document.getElementById('farmChatInput');
    const sendBtn = document.getElementById('farmChatSend');
    const typingEl = document.getElementById('farmChatTyping');
    const errorBox = document.getElementById('farmChatError');
    const errorText = document.getElementById('farmChatErrorText');
    const retryBtn = document.getElementById('farmChatRetry');
    const clearBtn = document.getElementById('farmChatClear');
    const contextEl = document.getElementById('farmChatContext');
    const fabOpen = toggle.querySelector('.farm-chat__fab-icon--open');
    const fabClose = toggle.querySelector('.farm-chat__fab-icon--close');

    function loadSessionHistory() {
      try {
        const raw = sessionStorage.getItem(HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
      } catch {
        return [];
      }
    }

    function saveSessionHistory() {
      try {
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
      } catch {
        /* quota */
      }
    }

    const state = {
      open: false,
      history: loadSessionHistory(),
      loading: false,
      lastUserMessage: '',
    };

    function setOpen(open) {
      state.open = open;
      panel.classList.toggle('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      fabOpen.classList.toggle('hidden', open);
      fabClose.classList.toggle('hidden', !open);
      if (open) {
        input.focus();
        scrollToBottom();
      }
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderContextBanner() {
      const ctx = window.PlantChatContext?.get?.() || {};
      const plant = ctx.plant;
      if (!plant?.scientific_name && !plant?.common_name) {
        contextEl.classList.add('hidden');
        contextEl.innerHTML = '';
        return;
      }
      const bits = [];
      if (plant.scientific_name) bits.push(plant.scientific_name);
      if (plant.common_name) bits.push(plant.common_name);
      if (plant.confidence_percent != null) bits.push(`${plant.confidence_percent}% match`);
      contextEl.innerHTML = `<span class="farm-chat__context-label">Context:</span> ${escapeHtml(bits.join(' · '))}`;
      contextEl.classList.remove('hidden');
    }

    function appendMessage(role, content, options = {}) {
      const row = document.createElement('div');
      row.className = `farm-chat__row farm-chat__row--${role}`;

      const bubble = document.createElement('div');
      bubble.className = `farm-chat__bubble farm-chat__bubble--${role}`;

      if (role === 'assistant') {
        bubble.innerHTML = formatAssistantHtml(content);
        if (options.copyable !== false) {
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'farm-chat__copy';
          copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(content);
              copyBtn.textContent = 'Copied!';
              setTimeout(() => {
                copyBtn.textContent = 'Copy';
              }, 1500);
            } catch {
              copyBtn.textContent = 'Copy failed';
            }
          });
          bubble.appendChild(copyBtn);
        }
      } else {
        bubble.textContent = content;
      }

      row.appendChild(bubble);
      messagesEl.appendChild(row);
      scrollToBottom();
    }

    function renderHistory() {
      messagesEl.innerHTML = '';
      if (!state.history.length) {
        const welcome = document.createElement('div');
        welcome.className = 'farm-chat__welcome';
        welcome.innerHTML =
          '<p><strong>Hello!</strong> I can help with plant diseases, fertilizers, irrigation, pests, and crop care.</p><p>Ask a question or open a plant result page for context-aware advice.</p>';
        messagesEl.appendChild(welcome);
        return;
      }
      state.history.forEach((entry) => {
        appendMessage(entry.role, entry.content, { copyable: entry.role === 'assistant' });
      });
    }

    function hideError() {
      errorBox.classList.add('hidden');
    }

    function showError(message) {
      errorText.textContent =
        message || 'Something went wrong. Please try again.';
      errorBox.classList.remove('hidden');
    }

    function setLoading(on) {
      state.loading = on;
      typingEl.classList.toggle('hidden', !on);
      sendBtn.disabled = on;
      input.disabled = on;
      if (on) scrollToBottom();
    }

    async function sendMessage(text) {
      const message = String(text || '').trim();
      if (!message || state.loading) return;

      hideError();
      state.lastUserMessage = message;
      state.history.push({ role: 'user', content: message });
      if (state.history.length > MAX_HISTORY) {
        state.history = state.history.slice(-MAX_HISTORY);
      }
      saveSessionHistory();
      renderHistory();
      input.value = '';
      setLoading(true);

      const ctx = window.PlantChatContext?.get?.() || {};
      const payload = {
        message,
        history: state.history.slice(0, -1).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        context: {
          plant: ctx.plant,
          disease: ctx.disease,
        },
        document_id: ctx.document_id || window.PlantChatContext?.getDocumentId?.() || undefined,
      };

      try {
        const response = await fetch(`${getApiBase()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });

        const raw = await response.text();
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = {};
        }

        if (!response.ok || !body.success) {
          showError(resolveChatError(body, response));
          return;
        }

        const reply = body.data?.reply || '';
        state.history.push({ role: 'assistant', content: reply });
        saveSessionHistory();
        renderHistory();
      } catch (networkErr) {
        console.error('[farm-chat] Network failure (request never completed):', networkErr);
        showError(
          'Could not reach the server. Start the app with npm start in the server folder and open http://localhost:3000'
        );
      } finally {
        setLoading(false);
      }
    }

    toggle.addEventListener('click', () => setOpen(!state.open));
    closeBtn.addEventListener('click', () => setOpen(false));
    sendBtn.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });

    retryBtn.addEventListener('click', () => {
      hideError();
      if (!state.lastUserMessage) return;
      const last = state.history[state.history.length - 1];
      if (last?.role === 'user' && last.content === state.lastUserMessage) {
        state.history.pop();
        saveSessionHistory();
      }
      sendMessage(state.lastUserMessage);
    });

    clearBtn.addEventListener('click', () => {
      state.history = [];
      state.lastUserMessage = '';
      try {
        sessionStorage.removeItem(HISTORY_KEY);
      } catch {
        /* ignore */
      }
      hideError();
      renderHistory();
      input.focus();
    });

    window.addEventListener('plantchat:context', () => {
      renderContextBanner();
    });

    renderContextBanner();
    renderHistory();

    if (!state.history.length) {
      /* session-only; no persistence required */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
