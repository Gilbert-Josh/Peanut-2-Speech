const API_BASES = ['http://127.0.0.1:3000', 'http://localhost:3000'];
const MAX_CHARS = 3800;
const HIGHLIGHT_NAME = 'peanut-2-speech';

const els = {
  readPage: document.querySelector('#readPage'),
  readSelection: document.querySelector('#readSelection'),
  stop: document.querySelector('#stop'),
  previous: document.querySelector('#previous'),
  next: document.querySelector('#next'),
  playPause: document.querySelector('#playPause'),
  speed: document.querySelector('#speed'),
  speedValue: document.querySelector('#speedValue'),
  voice: document.querySelector('#voice'),
  style: document.querySelector('#style'),
  sourceTitle: document.querySelector('#sourceTitle'),
  progressText: document.querySelector('#progressText'),
  sentencePreview: document.querySelector('#sentencePreview'),
  state: document.querySelector('#state'),
  statusDot: document.querySelector('#statusDot'),
  connectionText: document.querySelector('#connectionText'),
  retryHealth: document.querySelector('#retryHealth')
};

const state = {
  apiBase: API_BASES[0],
  chunks: [],
  audioUrls: [],
  index: 0,
  audio: null,
  playing: false,
  loading: false,
  title: '',
  sourceTabId: null,
  generation: 0
};

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const matches = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) || [normalized];
  const sentences = matches.map(s => s.trim()).filter(Boolean);
  const chunks = [];

  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHARS) {
      chunks.push(sentence);
      continue;
    }

    const words = sentence.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if ((current + ' ' + word).length <= MAX_CHARS) {
        current += ' ' + word;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

async function findApi() {
  for (const base of API_BASES) {
    try {
      const response = await fetch(base + '/api/health', { method: 'GET' });
      if (response.ok) {
        state.apiBase = base;
        els.statusDot.className = 'status-dot online';
        els.connectionText.textContent = 'Local Kokoro connected';
        return true;
      }
    } catch {}
  }

  els.statusDot.className = 'status-dot offline';
  els.connectionText.textContent = 'Start Text-to-speech on port 3000';
  return false;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function extractPage() {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active browser tab.');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll(
        'script, style, noscript, nav, footer, header, aside, form, dialog, [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"]'
      ).forEach(node => node.remove());

      const candidates = [
        ...clone.querySelectorAll('article'),
        ...clone.querySelectorAll('main'),
        ...clone.querySelectorAll('[role="main"]')
      ];

      const best = candidates
        .map(node => ({ text: node.innerText || '', length: (node.innerText || '').length }))
        .sort((a, b) => b.length - a.length)[0];

      const text = best?.length > 300 ? best.text : (clone.innerText || '');
      return {
        title: document.title || 'Web page',
        text,
        url: location.href
      };
    }
  });

  return { tab, ...(results[0]?.result || {}) };
}

async function extractSelection() {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active browser tab.');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title || 'Selection',
      text: window.getSelection()?.toString() || '',
      url: location.href
    })
  });

  return { tab, ...(results[0]?.result || {}) };
}

async function highlightInPage(tabId, text) {
  if (!tabId || !text) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetText, highlightName) => {
        if (!('CSS' in window) || !CSS.highlights) return;

        CSS.highlights.delete(highlightName);

        const styleId = 'peanut-2-speech-highlight-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `::highlight(${highlightName}) {
            background: #ffe66d;
            color: #111318;
            text-decoration: underline;
            text-decoration-thickness: 2px;
            text-decoration-color: #e3b341;
          }`;
          document.documentElement.appendChild(style);
        }

        const normalize = value => String(value || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();

        const wanted = normalize(targetText);
        if (!wanted) return;

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const tag = parent.tagName.toLowerCase();
              if (['script', 'style', 'noscript', 'textarea', 'input', 'select'].includes(tag)) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        const nodes = [];
        let combined = '';
        let node;

        while ((node = walker.nextNode())) {
          const raw = node.nodeValue || '';
          if (!raw.trim()) continue;

          let normalized = '';
          let lastWasSpace = false;
          for (let i = 0; i < raw.length; i++) {
            const char = raw[i];
            if (/\\s/.test(char)) {
              if (!lastWasSpace) {
                normalized += ' ';
                lastWasSpace = true;
              }
            } else {
              normalized += char;
              lastWasSpace = false;
            }
          }

          if (combined && normalized && !combined.endsWith(' ')) {
            combined += ' ';
          }

          nodes.push({ node, start: combined.length, normalized });
          combined += normalized;
        }

        const start = combined.indexOf(wanted);
        if (start < 0) return;
        const end = start + wanted.length;

        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;

        for (const item of nodes) {
          const itemEnd = item.start + item.normalized.length;
          if (!startNode && start >= item.start && start <= itemEnd) {
            startNode = item.node;
            startOffset = Math.min(item.node.nodeValue.length, start - item.start);
          }
          if (end >= item.start && end <= itemEnd) {
            endNode = item.node;
            endOffset = Math.min(item.node.nodeValue.length, end - item.start);
            break;
          }
        }

        if (!startNode || !endNode) return;

        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        const highlight = new Highlight(range);
        CSS.highlights.set(highlightName, highlight);

        const rect = range.getBoundingClientRect();
        if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
          range.startContainer.parentElement?.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      },
      args: [text, HIGHLIGHT_NAME]
    });
  } catch {
    // Some browser pages (for example chrome:// pages) do not allow scripting.
  }
}

async function clearHighlight(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (highlightName) => {
        if ('CSS' in window && CSS.highlights) CSS.highlights.delete(highlightName);
      },
      args: [HIGHLIGHT_NAME]
    });
  } catch {}
}

function resetAudio() {
  if (state.audio) {
    state.audio.pause();
    state.audio.src = '';
  }
  state.audioUrls.forEach(url => URL.revokeObjectURL(url));
  state.audioUrls = [];
  state.audio = null;
  state.playing = false;
  state.generation += 1;
}

function updateUi() {
  const total = state.chunks.length;
  els.progressText.textContent = total ? `${state.index + 1} / ${total}` : '0 / 0';
  els.sentencePreview.textContent = state.chunks[state.index] || 'Select text or read this page.';
  els.playPause.textContent = state.playing ? '⏸' : '▶';
  els.playPause.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  els.previous.disabled = !total || state.index <= 0;
  els.next.disabled = !total || state.index >= total - 1;
}

async function generateAudio(index) {
  if (!state.chunks[index]) return null;

  const response = await fetch(state.apiBase + '/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: state.chunks[index],
      voice: els.voice.value,
      speakingStyle: els.style.value
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `TTS request failed (${response.status})`);
  }

  const binary = Uint8Array.from(atob(payload.audioBase64), c => c.charCodeAt(0));
  const blob = new Blob([binary], { type: payload.mimeType || 'audio/wav' });
  const url = URL.createObjectURL(blob);
  state.audioUrls[index] = url;
  return url;
}

async function prefetch(index, generation) {
  if (
    index >= state.chunks.length ||
    state.audioUrls[index] ||
    generation !== state.generation
  ) {
    return;
  }

  try {
    await generateAudio(index);
  } catch {
    // The current chunk will surface any TTS error when it is played.
  }
}

async function playIndex(index) {
  if (!state.chunks[index]) return;

  const generation = state.generation;
  state.loading = true;
  state.index = index;
  updateUi();
  els.state.textContent = 'Generating speech…';

  await highlightInPage(state.sourceTabId, state.chunks[index]);

  try {
    const url = state.audioUrls[index] || await generateAudio(index);

    if (generation !== state.generation) return;

    const audio = new Audio(url);
    audio.playbackRate = Number(els.speed.value);

    audio.onended = async () => {
      if (generation !== state.generation) return;

      if (state.index < state.chunks.length - 1) {
        await playIndex(state.index + 1);
      } else {
        state.playing = false;
        els.state.textContent = 'Finished';
        updateUi();
      }
    };

    audio.onerror = () => {
      if (generation !== state.generation) return;
      state.playing = false;
      els.state.textContent = 'Audio error';
      updateUi();
    };

    if (state.audio) state.audio.pause();
    state.audio = audio;
    state.loading = false;
    state.playing = true;
    els.state.textContent = 'Playing';
    updateUi();

    // Generate the next chunk while this one is playing.
    prefetch(index + 1, generation);

    await audio.play();
  } catch (error) {
    if (generation !== state.generation) return;
    state.loading = false;
    state.playing = false;
    els.state.textContent = error.message;
    updateUi();
  }
}

async function loadText(title, text, tabId) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    els.state.textContent = 'No readable text found.';
    return;
  }

  resetAudio();
  state.chunks = splitSentences(cleaned);
  state.index = 0;
  state.title = title || 'Web page';
  state.sourceTabId = tabId || null;
  els.sourceTitle.textContent = state.title;
  els.state.textContent = `${state.chunks.length} reading chunks ready`;
  updateUi();
  await playIndex(0);
}

els.readPage.addEventListener('click', async () => {
  try {
    els.state.textContent = 'Extracting page…';
    const result = await extractPage();
    await loadText(result.title, result.text, result.tab.id);
  } catch (error) {
    els.state.textContent = error.message;
  }
});

els.readSelection.addEventListener('click', async () => {
  try {
    els.state.textContent = 'Reading selection…';
    const result = await extractSelection();
    await loadText(result.title, result.text, result.tab.id);
  } catch (error) {
    els.state.textContent = error.message;
  }
});

els.stop.addEventListener('click', async () => {
  const tabId = state.sourceTabId;
  resetAudio();
  await clearHighlight(tabId);
  els.state.textContent = 'Stopped';
  updateUi();
});

els.playPause.addEventListener('click', async () => {
  if (!state.chunks.length) return;

  if (state.playing && state.audio) {
    state.audio.pause();
    state.playing = false;
    els.state.textContent = 'Paused';
    updateUi();
    return;
  }

  if (state.audio && state.audio.src && state.audio.currentTime > 0 && !state.audio.ended) {
    state.playing = true;
    els.state.textContent = 'Playing';
    updateUi();
    await state.audio.play();
    return;
  }

  await playIndex(state.index);
});

els.previous.addEventListener('click', () => {
  if (state.index > 0) playIndex(state.index - 1);
});

els.next.addEventListener('click', () => {
  if (state.index < state.chunks.length - 1) playIndex(state.index + 1);
});

els.speed.addEventListener('input', () => {
  const value = Number(els.speed.value);
  els.speedValue.textContent = value.toFixed(2) + '×';
  if (state.audio) state.audio.playbackRate = value;
  chrome.storage.local.set({ speed: value });
});

for (const key of ['voice', 'style']) {
  els[key].addEventListener('change', () => {
    chrome.storage.local.set({ [key]: els[key].value });
    state.audioUrls.forEach(url => URL.revokeObjectURL(url));
    state.audioUrls = [];
  });
}

els.retryHealth.addEventListener('click', findApi);

async function restoreSettings() {
  const saved = await chrome.storage.local.get(['voice', 'style', 'speed']);
  if (saved.voice) els.voice.value = saved.voice;
  if (saved.style) els.style.value = saved.style;
  if (saved.speed) {
    els.speed.value = String(saved.speed);
    els.speedValue.textContent = Number(saved.speed).toFixed(2) + '×';
  }
}

async function consumePendingSelection() {
  const { pendingSelection } = await chrome.storage.session.get('pendingSelection');
  if (!pendingSelection) return;
  await chrome.storage.session.remove('pendingSelection');
  const result = await activeTab();
  await loadText('Selected text', pendingSelection, result?.id);
}

await restoreSettings();
await findApi();
await consumePendingSelection();
updateUi();
