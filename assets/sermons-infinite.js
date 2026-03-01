(function () {
  const API_KEY = window.HHI_YT_API_KEY || '';
  const DEFAULT_CHANNEL_ID = 'UCslATpJxjEqoQY37itH8h0w';
  const CHANNEL_HANDLE = window.HHI_YT_CHANNEL_HANDLE || '@harvesthouseint';
  const AUTO_REFRESH_MS = Number(window.HHI_SERMONS_REFRESH_MS || 180000);
  const grid = document.getElementById('sermon-grid');
  const empty = document.getElementById('sermon-empty');
  const errorEl = document.getElementById('sermon-error');
  const loadingEl = document.getElementById('sermon-loading');
  const sentinel = document.getElementById('sermon-sentinel');
  const searchInput = document.getElementById('sermon-search');
  const sortSelect = document.getElementById('sermon-sort');
  const durationSelect = document.getElementById('sermon-duration');
  const liveToggle = document.getElementById('sermon-live-toggle');
  const filterPanel = document.getElementById('sermon-filter-panel');
  const filterToggle = document.getElementById('filter-toggle');
  const filterClose = document.getElementById('filter-close');
  const filterReset = document.getElementById('filter-reset');
  const liveLabelOn = liveToggle?.querySelector('[data-live-label-on]');
  const liveLabelOff = liveToggle?.querySelector('[data-live-label-off]');

  if (!grid) return;

  if (!API_KEY) {
    if (errorEl) {
      errorEl.textContent = 'Add your YouTube Data API key in assets/youtube-config.js to load sermons automatically.';
      errorEl.classList.remove('hidden');
    }
    loadingEl?.classList.add('hidden');
    sentinel?.remove();
    return;
  }

  let channelId = DEFAULT_CHANNEL_ID;
  let nextPageToken = '';
  let loading = false;
  let finished = false;
  let refreshTimer = null;
  const state = { items: [], query: '', sort: 'newest', duration: 'all', liveOnly: false };

  const normalize = (text) => (text || '').toLowerCase();

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const buildCard = (videoId, title, speaker, thumb, { liveNow, published, durationSeconds }) => {
    const card = document.createElement('a');
    const targetHref = `sermons/watch/?v=${encodeURIComponent(videoId)}&t=${encodeURIComponent(title || '')}&s=${encodeURIComponent(speaker || '')}`;
    card.href = targetHref;
    card.className = 'sermon-card rounded-3xl overflow-hidden group block';
    const dateText = !liveNow ? formatDate(published) : '';
    const durationText = !liveNow ? formatDuration(durationSeconds) : '';
    card.innerHTML = `
      <div class="relative aspect-[16/9] overflow-hidden">
        <img src="${thumb}" alt="${title}" class="w-full h-full object-cover transition duration-500 group-hover:scale-105">
        <div class="absolute top-3 left-3 flex flex-wrap gap-2">
          ${liveNow ? '<span class="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide">● Live</span>' : ''}
          ${!liveNow && dateText ? `<span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">${dateText}</span>` : ''}
          ${!liveNow && durationText ? `<span class="inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold">${durationText}</span>` : ''}
        </div>
      </div>
      <div class="p-5">
        <h3 class="text-lg font-semibold">${title}</h3>
        <p class="text-white/60 text-sm">${speaker || ''}</p>
      </div>
    `;
    return card;
  };

  const renderItems = (items) => {
    grid.innerHTML = '';
    if (!items.length) empty?.classList.remove('hidden');
    else empty?.classList.add('hidden');
    items.forEach((item) => {
      grid.appendChild(buildCard(item.videoId, item.title, item.speaker, item.thumb, {
        liveNow: item.liveNow,
        published: item.published,
        durationSeconds: item.durationSeconds
      }));
    });
  };

  const applyFilters = () => {
    let list = [...state.items];
    if (state.query) {
      const q = normalize(state.query);
      list = list.filter((item) => normalize(item.title + ' ' + item.speaker).includes(q));
    }
    if (state.duration !== 'all') {
      list = list.filter((item) => {
        const dur = item.durationSeconds || 0;
        if (state.duration === 'shorts') return dur > 0 && dur <= 90;
        if (state.duration === 'long') return dur >= 600;
        return true;
      });
    }
    list.sort((a, b) => {
      if (!a.published || !b.published) return 0;
      return state.sort === 'oldest' ? a.published - b.published : b.published - a.published;
    });
    renderItems(list);
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.sort !== 'newest') params.set('sort', state.sort);
    if (state.duration !== 'all') params.set('dur', state.duration);
    if (state.liveOnly) params.set('live', '1');
    const newUrl = `${window.location.pathname}?${params.toString()}`.replace(/\?$/, '');
    window.history.replaceState({}, '', newUrl);
  };

  const loadDurations = async (ids) => {
    if (!ids.length) return {};
    const chunks = [];
    for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
    const result = {};
    for (const chunk of chunks) {
      const params = new URLSearchParams({
        key: API_KEY,
        part: 'contentDetails,snippet',
        id: chunk.join(',')
      });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`);
      if (!res.ok) continue;
      const data = await res.json();
      (data.items || []).forEach((item) => {
        const durISO = item.contentDetails?.duration;
        const liveFlag = item.liveBroadcastContent === 'live' || item.snippet?.liveBroadcastContent === 'live';
        let seconds = 0;
        if (durISO) {
          const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(durISO);
          if (match) {
            const h = parseInt(match[1] || '0', 10);
            const m = parseInt(match[2] || '0', 10);
            const s = parseInt(match[3] || '0', 10);
            seconds = h * 3600 + m * 60 + s;
          }
        }
        result[item.id] = { durationSeconds: seconds, liveNow: liveFlag };
      });
    }
    return result;
  };

  const resetAndReload = () => {
    state.items = [];
    nextPageToken = '';
    finished = false;
    grid.innerHTML = '';
    empty?.classList.add('hidden');
    sentinel?.classList.remove('hidden');
    loadMore(true);
  };

  const resolveChannelId = async () => {
    if (!API_KEY || !CHANNEL_HANDLE) return channelId;
    try {
      const params = new URLSearchParams({
        key: API_KEY,
        part: 'id',
        forHandle: CHANNEL_HANDLE.replace(/^@/, '')
      });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
      if (!res.ok) return channelId;
      const data = await res.json();
      const resolved = data.items?.[0]?.id;
      if (resolved) channelId = resolved;
    } catch (err) {
      console.warn('Unable to resolve channel by handle, using default channel id.', err);
    }
    return channelId;
  };

  const loadMore = async (isFresh = false) => {
    if (loading || finished) return;
    loading = true;
    loadingEl?.classList.remove('hidden');
    try {
      const params = new URLSearchParams({
        key: API_KEY,
        part: 'snippet',
        channelId: channelId,
        order: 'date',
        type: 'video',
        maxResults: '12'
      });
      if (state.liveOnly) params.set('eventType', 'live');
      if (nextPageToken) params.set('pageToken', nextPageToken);
      const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Unable to load sermons');
      const data = await res.json();
      const mapped = (data.items || []).map((item) => {
        const snippet = item.snippet || {};
        const published = Date.parse(snippet.publishedAt || snippet.publishTime || '') || 0;
        const thumb = (snippet.thumbnails?.high || snippet.thumbnails?.medium || snippet.thumbnails?.default || {}).url || '';
        return {
          videoId: item.id?.videoId,
          title: snippet.title,
          speaker: snippet.channelTitle,
          thumb,
          published,
          durationSeconds: 0,
          liveNow: snippet.liveBroadcastContent === 'live'
        };
      }).filter((v) => v.videoId && v.title);
      const durationMap = await loadDurations(mapped.map((m) => m.videoId));
      mapped.forEach((m) => {
        if (durationMap[m.videoId]) {
          m.durationSeconds = durationMap[m.videoId].durationSeconds;
          m.liveNow = m.liveNow || durationMap[m.videoId].liveNow;
        }
      });
      if (isFresh) state.items = mapped;
      else state.items.push(...mapped);
      applyFilters();
      nextPageToken = data.nextPageToken || '';
      finished = !nextPageToken;
      if (finished) sentinel?.classList.add('hidden');
    } catch (err) {
      console.error(err);
      if (errorEl) {
        errorEl.textContent = 'We had trouble loading more sermons. Please try again later.';
        errorEl.classList.remove('hidden');
      }
      finished = true;
      sentinel?.classList.add('hidden');
    } finally {
      loading = false;
      loadingEl?.classList.add('hidden');
    }
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) loadMore();
    });
  });
  if (sentinel) observer.observe(sentinel);

  searchInput?.addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    applyFilters();
  });

  sortSelect?.addEventListener('change', (e) => {
    state.sort = e.target.value;
    applyFilters();
  });

  durationSelect?.addEventListener('change', (e) => {
    state.duration = e.target.value;
    applyFilters();
  });

  const updateLiveToggleLabel = () => {
    if (!liveLabelOn || !liveLabelOff) return;
    if (state.liveOnly) {
      liveLabelOn.classList.remove('hidden');
      liveLabelOff.classList.add('hidden');
      liveToggle?.classList.add('border-red-400', 'text-red-100');
    } else {
      liveLabelOn.classList.add('hidden');
      liveLabelOff.classList.remove('hidden');
      liveToggle?.classList.remove('border-red-400', 'text-red-100');
    }
  };

  liveToggle?.addEventListener('click', () => {
    state.liveOnly = !state.liveOnly;
    updateLiveToggleLabel();
    resetAndReload();
  });

  filterToggle?.addEventListener('click', () => {
    filterPanel?.classList.toggle('hidden');
  });
  filterClose?.addEventListener('click', () => filterPanel?.classList.add('hidden'));
  filterReset?.addEventListener('click', () => {
    state.query = '';
    state.sort = 'newest';
    state.duration = 'all';
    state.liveOnly = false;
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'newest';
    if (durationSelect) durationSelect.value = 'all';
    updateLiveToggleLabel();
    applyFilters();
  });

  // hydrate from URL
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('q') || '';
  const sort = urlParams.get('sort') || 'newest';
  const dur = urlParams.get('dur') || 'all';
  const live = urlParams.get('live') === '1';
  state.query = q;
  state.sort = sort;
  state.duration = dur;
  state.liveOnly = live;
  if (searchInput) searchInput.value = q;
  if (sortSelect) sortSelect.value = sort;
  if (durationSelect) durationSelect.value = dur;
  updateLiveToggleLabel();

  const startAutoRefresh = () => {
    if (!Number.isFinite(AUTO_REFRESH_MS) || AUTO_REFRESH_MS < 60000) return;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        resetAndReload();
      }
    }, AUTO_REFRESH_MS);
  };

  resolveChannelId().finally(() => {
    loadMore(true);
    startAutoRefresh();
  });
})();
