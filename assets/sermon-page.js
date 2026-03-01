(function () {
  const slugFromPath = () => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    const last = parts[parts.length - 1];
    if (last.toLowerCase() === 'index.html') {
      return parts[parts.length - 2] || '';
    }
    return last.replace(/\.html$/, '');
  };

  const slug = document.body.dataset.sermonSlug || slugFromPath();
  const sermon = window.SERMON_DATA?.[slug];
  const fallback = document.getElementById('sermon-fallback');

  if (!sermon) {
    if (fallback) fallback.classList.remove('hidden');
    document.title = 'Sermon not found | Harvest House International';
    return;
  }

  document.body.dataset.sermonSlug = slug;
  const youtubeUrl = `https://www.youtube.com/watch?v=${sermon.youtubeId}`;
  const titleEl = document.getElementById('sermon-title');
  const speakerEl = document.getElementById('sermon-speaker');
  const summaryEl = document.getElementById('sermon-summary');
  const dateEl = document.getElementById('sermon-date');
  const videoFrame = document.getElementById('sermon-video');
  const youtubeBtn = document.getElementById('watch-on-youtube');
  const discussionBtn = document.getElementById('discussion-link');
  const shareLink = document.getElementById('share-link');

  document.title = `${sermon.title} | Sermons | Harvest House International`;
  if (titleEl) titleEl.textContent = sermon.title;
  if (speakerEl) speakerEl.textContent = sermon.speaker;
  if (summaryEl) summaryEl.textContent = sermon.summary || 'Watch this message and share it with someone who needs encouragement today.';
  if (sermon.date && dateEl) {
    dateEl.textContent = sermon.date;
    dateEl.classList.remove('hidden');
  } else if (dateEl) {
    dateEl.classList.add('hidden');
  }

  if (videoFrame) {
    videoFrame.src = `https://www.youtube.com/embed/${sermon.youtubeId}?rel=0&modestbranding=1&color=white`;
  }

  if (youtubeBtn) {
    youtubeBtn.href = youtubeUrl;
  }

  if (discussionBtn && sermon.discussionLink) {
    discussionBtn.href = sermon.discussionLink;
  }

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
