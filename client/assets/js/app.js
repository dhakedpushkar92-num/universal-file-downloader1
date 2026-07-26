/**
 * app.js
 * ------------------------------------------------------------
 * Vanilla JS controller for the Fetchr frontend. No frameworks,
 * no build step — just DOM APIs, fetch, and localStorage.
 * ------------------------------------------------------------
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Config & element references
  // ---------------------------------------------------------------------
  const API_BASE = window.__API_BASE_URL__ || 'http://localhost:5000';
  const HISTORY_KEY = 'fetchr.history.v1';
  const MAX_HISTORY_ITEMS = 50;

  const el = {
    urlInput: document.getElementById('url-input'),
    clearInputBtn: document.getElementById('clear-input-btn'),
    pasteBtn: document.getElementById('paste-btn'),
    copyBtn: document.getElementById('copy-btn'),
    clearBtn: document.getElementById('clear-btn'),
    downloadBtn: document.getElementById('download-btn'),

    infoCard: document.getElementById('info-card'),
    infoFilename: document.getElementById('info-filename'),
    infoStatus: document.getElementById('info-status'),
    infoExt: document.getElementById('info-ext'),
    infoSize: document.getElementById('info-size'),
    infoType: document.getElementById('info-type'),

    ringFill: document.getElementById('ring-progress'),
    ringPercent: document.getElementById('ring-percent'),

    progressWrap: document.getElementById('progress-wrap'),
    progressBar: document.getElementById('progress-bar'),
    progressLabel: document.getElementById('progress-label'),
    progressBytes: document.getElementById('progress-bytes'),

    historyToggle: document.getElementById('history-toggle'),
    historyPanel: document.getElementById('history-panel'),
    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),

    toastContainer: document.getElementById('toast-container'),
  };

  const RING_CIRCUMFERENCE = 150.8; // 2 * PI * r(24), matches CSS

  // ---------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const icons = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="shrink-0 mt-0.5">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------
  function isPlausibleUrl(value) {
    try {
      const u = new URL(value.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return 'Unknown';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  // ---------------------------------------------------------------------
  // Ring progress (indeterminate spin while checking, determinate during DL)
  // ---------------------------------------------------------------------
  function ringSetIndeterminate(on) {
    el.ringFill.classList.toggle('spin', on);
    if (on) el.ringPercent.textContent = '';
  }

  function ringSetProgress(pct) {
    ringSetIndeterminate(false);
    const clamped = Math.max(0, Math.min(100, pct));
    const offset = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE;
    el.ringFill.style.strokeDashoffset = String(offset);
    el.ringPercent.textContent = `${Math.round(clamped)}%`;
  }

  // ---------------------------------------------------------------------
  // Input toolbar behavior
  // ---------------------------------------------------------------------
  function syncClearButtonVisibility() {
    el.clearInputBtn.classList.toggle('hidden', el.urlInput.value.trim().length === 0);
  }

  el.urlInput.addEventListener('input', syncClearButtonVisibility);

  el.clearInputBtn.addEventListener('click', () => {
    el.urlInput.value = '';
    syncClearButtonVisibility();
    el.urlInput.focus();
  });

  el.clearBtn.addEventListener('click', () => {
    el.urlInput.value = '';
    syncClearButtonVisibility();
    hideInfoCard();
  });

  el.pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showToast('Clipboard is empty.', 'info');
        return;
      }
      el.urlInput.value = text.trim();
      syncClearButtonVisibility();
      showToast('Pasted from clipboard.', 'success');
    } catch {
      showToast('Clipboard access was denied. Paste manually instead.', 'error');
    }
  });

  el.copyBtn.addEventListener('click', async () => {
    const value = el.urlInput.value.trim();
    if (!value) {
      showToast('Nothing to copy yet.', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast('URL copied to clipboard.', 'success');
    } catch {
      showToast('Could not copy automatically. Select and copy manually.', 'error');
    }
  });

  // ---------------------------------------------------------------------
  // Info card rendering
  // ---------------------------------------------------------------------
  function hideInfoCard() {
    el.infoCard.classList.add('hidden');
    el.progressWrap.classList.add('hidden');
  }

  function renderInfo(meta, statusText) {
    el.infoCard.classList.remove('hidden');
    el.infoFilename.textContent = meta.filename || 'Unknown file';
    el.infoStatus.textContent =
      meta.source === 'mediafire' ? `${statusText} · resolved via MediaFire` : statusText;
    el.infoExt.textContent = meta.extension ? `.${meta.extension}` : '—';
    el.infoSize.textContent = meta.sizeHuman || 'Unknown';
    el.infoType.textContent = meta.contentType || 'Unknown';
  }

  // ---------------------------------------------------------------------
  // Core flow: check info, then stream download
  // ---------------------------------------------------------------------
  async function fetchInfo(url) {
    const res = await fetch(`${API_BASE}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      throw new Error(body.error || 'Failed to fetch file information.');
    }
    return body.data;
  }

  async function downloadWithProgress(url, meta) {
    const res = await fetch(`${API_BASE}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      let message = 'Download failed.';
      try {
        const body = await res.json();
        message = body.error || message;
      } catch {
        /* response wasn't JSON — keep default message */
      }
      throw new Error(message);
    }

    const totalHeader = res.headers.get('Content-Length');
    const total = totalHeader ? parseInt(totalHeader, 10) : meta.sizeBytes || 0;
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const nameMatch = contentDisposition.match(/filename="?([^"; ]+)"?/i);
    const filename = nameMatch ? nameMatch[1] : meta.filename;

    el.progressWrap.classList.remove('hidden');
    el.progressLabel.textContent = 'Downloading…';

    if (!res.body || !res.body.getReader) {
      // Streaming not supported by this browser — fall back to a single blob read.
      const blob = await res.blob();
      triggerBrowserSave(blob, filename);
      ringSetProgress(100);
      return { filename, bytes: blob.size };
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (total) {
        const pct = (received / total) * 100;
        el.progressBar.style.width = `${pct}%`;
        ringSetProgress(pct);
      } else {
        // Unknown total size — show indeterminate motion on the bar only.
        el.progressBar.style.width = '100%';
      }
      el.progressBytes.textContent = `${formatBytes(received)} / ${total ? formatBytes(total) : 'Unknown'}`;
    }

    const blob = new Blob(chunks);
    triggerBrowserSave(blob, filename);
    ringSetProgress(100);
    return { filename, bytes: received };
  }

  function triggerBrowserSave(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'downloaded-file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }

  async function handleDownloadClick() {
    const rawUrl = el.urlInput.value.trim();

    if (!rawUrl) {
      showToast('Paste a file URL first.', 'error');
      return;
    }
    if (!isPlausibleUrl(rawUrl)) {
      showToast('That does not look like a valid http(s) URL.', 'error');
      return;
    }

    setBusy(true);
    hideInfoCard();
    el.infoCard.classList.remove('hidden');
    el.infoFilename.textContent = 'Checking file…';
    el.infoStatus.textContent = 'Contacting remote server…';
    el.infoExt.textContent = '—';
    el.infoSize.textContent = '—';
    el.infoType.textContent = '—';
    ringSetIndeterminate(true);

    let meta;
    try {
      meta = await fetchInfo(rawUrl);
      renderInfo(meta, 'Ready to download');
      ringSetProgress(0);
    } catch (err) {
      ringSetIndeterminate(false);
      el.infoStatus.textContent = 'Failed';
      showToast(err.message, 'error');
      addHistoryEntry({ url: rawUrl, filename: '—', status: 'failed' });
      setBusy(false);
      return;
    }

    try {
      const result = await downloadWithProgress(rawUrl, meta);
      el.infoStatus.textContent = 'Download complete';
      el.progressLabel.textContent = 'Complete';
      showToast(`Downloaded "${result.filename}".`, 'success');
      addHistoryEntry({ url: rawUrl, filename: result.filename, status: 'success' });
    } catch (err) {
      el.infoStatus.textContent = 'Download failed';
      showToast(err.message, 'error');
      addHistoryEntry({ url: rawUrl, filename: meta.filename || '—', status: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    el.downloadBtn.disabled = isBusy;
    el.downloadBtn.querySelector('span').textContent = isBusy ? 'Working…' : 'Get';
  }

  el.downloadBtn.addEventListener('click', handleDownloadClick);
  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleDownloadClick();
  });

  // ---------------------------------------------------------------------
  // History (persisted to localStorage)
  // ---------------------------------------------------------------------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  }

  function addHistoryEntry({ url, filename, status }) {
    const items = loadHistory();
    items.unshift({
      url,
      filename,
      status, // 'success' | 'failed'
      date: new Date().toISOString(),
    });
    saveHistory(items);
    renderHistory();
  }

  function renderHistory() {
    const items = loadHistory();
    el.historyList.innerHTML = '';
    el.historyEmpty.classList.toggle('hidden', items.length > 0);

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const statusColor = item.status === 'success' ? '#34d399' : '#fb7185';
      const dateLabel = new Date(item.date).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      li.innerHTML = `
        <span class="shrink-0 w-1.5 h-1.5 rounded-full" style="background:${statusColor}"></span>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-slate-200 truncate">${escapeHtml(item.filename || 'Unknown file')}</p>
          <p class="text-[10px] font-mono text-slate-500 truncate">${escapeHtml(item.url)}</p>
        </div>
        <span class="text-[10px] font-mono text-slate-500 shrink-0">${dateLabel}</span>
      `;
      el.historyList.appendChild(li);
    });
  }

  el.historyToggle.addEventListener('click', () => {
    el.historyPanel.classList.toggle('hidden');
    if (!el.historyPanel.classList.contains('hidden')) {
      renderHistory();
      el.historyPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  el.clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    showToast('Download history cleared.', 'info');
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  syncClearButtonVisibility();
  renderHistory();
})();
