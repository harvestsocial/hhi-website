(function () {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const videoId = params.get('v') || params.get('id') || hashParams.get('v') || hashParams.get('id');
  const passedTitle = params.get('t') || hashParams.get('t');
  const passedSpeaker = params.get('s') || hashParams.get('s');
  const API_KEY = window.HHI_YT_API_KEY || '';
  const fallback = document.getElementById('sermon-fallback');

  const titleEl = document.getElementById('sermon-title');
  const speakerEl = document.getElementById('sermon-speaker');
  const summaryEl = document.getElementById('sermon-summary');
  const dateEl = document.getElementById('sermon-date');
  const videoFrame = document.getElementById('sermon-video');
  const youtubeBtn = document.getElementById('watch-on-youtube');
  const subscribeBtn = document.getElementById('subscribe-btn');
  const discussionBtn = document.getElementById('discussion-link');
  const shareLink = document.getElementById('share-link');

  const applyBasics = (title, speaker, summary) => {
    if (titleEl && title) titleEl.textContent = title;
    if (speakerEl && speaker) speakerEl.textContent = speaker;
    if (summaryEl && summary) summaryEl.textContent = summary;
  };

  if (!videoId) {
    if (fallback) {
      fallback.textContent = 'No video was provided. Please go back and pick a sermon.';
      fallback.classList.remove('hidden');
    }
    document.title = 'Sermon not found | Harvest House International';
    return;
  }

  if (videoFrame) {
    videoFrame.src = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&color=white`;
  }
  if (youtubeBtn) youtubeBtn.href = `https://www.youtube.com/watch?v=${videoId}`;
  if (subscribeBtn) subscribeBtn.href = 'https://www.youtube.com/channel/UCslATpJxjEqoQY37itH8h0w?sub_confirmation=1';
  if (discussionBtn) discussionBtn.href = 'sermons.html';

  applyBasics(passedTitle, passedSpeaker, 'Watch this message and share it with someone who needs encouragement today.');
  document.title = `${passedTitle || 'Sermon'} | Sermons | Harvest House International`;

  const fillFromApi = async () => {
    if (!API_KEY) return;
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const item = data.items?.[0];
      if (!item) return;
      const snippet = item.snippet || {};
      const title = snippet.title || passedTitle;
      const speaker = snippet.channelTitle || passedSpeaker;
      const description = snippet.description || '';
      applyBasics(title, speaker, description);
      if (dateEl && snippet.publishedAt) {
        const date = new Date(snippet.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        dateEl.textContent = date;
        dateEl.classList.remove('hidden');
      }
      document.title = `${title || 'Sermon'} | Sermons | Harvest House International`;
    } catch (err) {
      console.error('Could not fetch video details', err);
    }
  };

  fillFromApi();

  if (shareLink) {
    shareLink.addEventListener('click', () => {
      const link = window.location.href;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(() => {
          shareLink.textContent = 'Link copied!';
          setTimeout(() => (shareLink.textContent = 'Share link'), 1400);
        });
      } else {
        window.prompt('Copy this link', link);
      }
    });
  }
})();
