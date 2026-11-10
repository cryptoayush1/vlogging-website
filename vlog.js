// Field Notes — Dedicated Reading Journal Logic
(function() {
  'use strict';

  // Live Date and Day Script
  function updateLiveHeaderDate() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = days[now.getDay()];
    const dayNum = now.getDate();
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();

    const dayEl = document.querySelector('#liveDayText');
    const dateEl = document.querySelector('#liveDateText');
    const clockEl = document.querySelector('#liveClockText');

    if (dayEl) dayEl.textContent = dayName;
    if (dateEl) dateEl.textContent = `${dayNum} ${monthName} ${year}`;
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: true });
  }
  updateLiveHeaderDate();
  setInterval(updateLiveHeaderDate, 1000);

  // Reading Progress Bar
  window.addEventListener('scroll', () => {
    const doc = document.documentElement;
    const total = doc.scrollHeight - doc.clientHeight;
    const pct = total > 0 ? (window.scrollY / total) * 100 : 0;
    const bar = document.querySelector('#readingProgressBar');
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  });

  let currentVlog = null;
  let allVlogs = [];
  let feedbackPollTimer = null;

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'Recent';
    try {
      const safe = String(dateStr).replace(' ', 'T');
      const d = new Date(safe);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
      }
    } catch(e) {}
    return String(dateStr).split(' ')[0] || 'Recent';
  }

  function sanitizeRichHtml(html) {
    if (!html) return '';
    // Strip malicious script tags, iframes, styles, embed, object
    let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    clean = clean.replace(/<\/?(iframe|object|embed|form|input|button|textarea|select)\b[^>]*>/gi, '');
    // Strip inline JavaScript handlers (onclick, onload, onerror, etc.)
    clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
    // Strip javascript: pseudo-protocols in src/href
    clean = clean.replace(/\s+(href|src)\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*"|javascript:[^\s>]+)/gi, '');
    return clean;
  }

  function formatBodyText(text, fallbackExcerpt = '') {
    const content = (text && text.trim()) ? text : (fallbackExcerpt && fallbackExcerpt.trim() ? fallbackExcerpt : '');
    if (!content) return '<p class="muted">No written content available for this film.</p>';
    
    // Check if content already contains rich HTML markup (tags like <p>, <div>, <b>, <i>, <u>, <img>, <ul>, etc.)
    if (/<[a-z][\s\S]*>/i.test(content)) {
      return sanitizeRichHtml(content);
    }

    // Normalize line breaks and split plain text paragraphs
    const rawParagraphs = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n+/);
    const cleanParagraphs = rawParagraphs.map(p => p.trim()).filter(Boolean);
    
    if (!cleanParagraphs.length) {
      return `<p>${esc(content)}</p>`;
    }
    return cleanParagraphs.map(p => `<p>${esc(p)}</p>`).join('');
  }

  async function loadVlogContent() {
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');

    // 1. Instant load from sessionStorage or localStorage if passed from public site
    try {
      const cachedStr = sessionStorage.getItem('field_notes_selected_vlog') || localStorage.getItem('field_notes_selected_vlog');
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (!requestedId || String(cached.id) === requestedId || String(cached.title).toLowerCase() === decodeURIComponent(requestedId).toLowerCase()) {
          currentVlog = cached;
          renderVlogDetails(currentVlog);
          loadFeedbackList(currentVlog);
          startFeedbackPolling();
        }
      }
    } catch(e) {}

    // 2. Fetch fresh data from backend
    try {
      const res = await fetch(`/api/vlogs?t=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to fetch vlogs from server');
      allVlogs = await res.json();

      if (!Array.isArray(allVlogs) || !allVlogs.length) {
        if (!currentVlog) {
          const titleEl = document.querySelector('#heroVlogTitle');
          const bodyEl = document.querySelector('#articleBodyContainer');
          if (titleEl) titleEl.textContent = 'No published films found.';
          if (bodyEl) bodyEl.innerHTML = '<p class="muted">There are currently no published films available.</p>';
        }
        return;
      }

      // Find the matching vlog
      let matched = null;
      if (requestedId) {
        matched = allVlogs.find(v => String(v.id) === requestedId || String(v.title).toLowerCase() === decodeURIComponent(requestedId).toLowerCase());
      }
      if (!matched) {
        matched = allVlogs[0];
      }

      currentVlog = matched;
      try {
        sessionStorage.setItem('field_notes_selected_vlog', JSON.stringify(matched));
        localStorage.setItem('field_notes_selected_vlog', JSON.stringify(matched));
      } catch(e) {}

      renderVlogDetails(currentVlog);
      renderMoreFilms(currentVlog, allVlogs);
      loadFeedbackList(currentVlog);
      startFeedbackPolling();

      // Track click / view event
      try {
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'vlog_click',
            vlog_id: typeof currentVlog.id === 'number' ? currentVlog.id : null,
            vlog_title: currentVlog.title || ''
          })
        }).catch(() => {});
      } catch(e) {}
    } catch (err) {
      console.error('Error fetching vlog:', err);
      // Fallback: If network fetch failed but we have cached vlog, it is already rendered.
      if (!currentVlog) {
        const bodyEl = document.querySelector('#articleBodyContainer');
        if (bodyEl) {
          bodyEl.innerHTML = '<p class="muted">Unable to load vlog text at this moment. Please refresh the page to retry.</p>';
        }
      }
    }
  }

  function renderVlogDetails(v) {
    if (!v) return;
    document.title = `${v.title || 'Journal'} — Field Notes`;
    
    const titleEl = document.querySelector('#heroVlogTitle');
    const excerptEl = document.querySelector('#heroVlogExcerpt');
    const bcCategory = document.querySelector('#bcCategoryText');
    const bcTitle = document.querySelector('#bcTitleText');
    const kicker = document.querySelector('#heroCategoryKicker');
    const catBadge = document.querySelector('#heroCategoryBadge');
    const catTag = document.querySelector('#articleCategoryTag');
    
    if (titleEl) titleEl.textContent = v.title || 'Untitled';
    if (excerptEl) excerptEl.textContent = v.excerpt || '';
    if (bcCategory) bcCategory.textContent = v.category || 'Journal';
    if (bcTitle) bcTitle.textContent = v.title || 'Story';
    if (kicker) kicker.textContent = `✦ ${v.category || 'Published Film'}`;
    if (catBadge) catBadge.textContent = v.category || 'Places';
    if (catTag) catTag.textContent = v.category || 'Journal';

    // Author details
    const authorName = v.author || 'Field Notes';
    const authorInitials = authorName.split(' ').map(s=>s[0]).join('').slice(0, 2).toUpperCase() || 'FN';
    const heroAuthorName = document.querySelector('#heroAuthorName');
    const heroAuthorBio = document.querySelector('#heroAuthorBio');
    const heroAuthorAvatar = document.querySelector('#heroAuthorAvatar');
    const heroPublishedMeta = document.querySelector('#heroPublishedMeta');

    if (heroAuthorName) heroAuthorName.textContent = authorName;
    if (heroAuthorBio) {
      heroAuthorBio.textContent = v.author_bio || 'Contributor to the Field Notes archive of film & visual storytelling.';
    }

    const formattedPubDate = formatDate(v.created_at);
    if (heroPublishedMeta) {
      heroPublishedMeta.textContent = `Published on ${formattedPubDate} · Field Notes Journal`;
    }

    // Author Picture
    if (v.author_image_filename) {
      const imgUrl = `/uploads/${encodeURIComponent(v.author_image_filename)}`;
      if (heroAuthorAvatar) {
        heroAuthorAvatar.style.backgroundImage = `url('${imgUrl}')`;
        heroAuthorAvatar.textContent = '';
      }
    } else {
      if (heroAuthorAvatar) {
        heroAuthorAvatar.style.backgroundImage = 'none';
        heroAuthorAvatar.textContent = authorInitials;
      }
    }

    // Featured Visual / Thumbnail Image
    const visualThumb = document.querySelector('#heroVisualThumb');
    if (visualThumb) {
      if (v.thumbnail_filename) {
        visualThumb.style.backgroundImage = `url('/uploads/${encodeURIComponent(v.thumbnail_filename)}')`;
      } else {
        visualThumb.style.background = 'linear-gradient(135deg, #76806a, #b4a37e 48%, #383e33)';
      }
    }

    // Word count, Reading Length, Publication Date
    const wc = v.word_count || (v.body_text ? v.body_text.trim().split(/\s+/).length : 1);
    const mins = Math.max(1, Math.ceil(wc / 200));
    const rtText = document.querySelector('#articleReadingTimeText');
    const wcText = document.querySelector('#articleWordCountText');
    const pdText = document.querySelector('#articlePublishDateText');
    const durationMeta = document.querySelector('#heroDurationMeta');

    if (rtText) rtText.textContent = `~${mins} min read`;
    if (wcText) wcText.textContent = `${wc.toLocaleString()} words`;
    if (pdText) pdText.textContent = formattedPubDate;
    if (durationMeta) durationMeta.textContent = `~${mins} min read (${wc.toLocaleString()} words)`;

    // Article Full Content
    const bodyContainer = document.querySelector('#articleBodyContainer');
    if (bodyContainer) {
      bodyContainer.innerHTML = formatBodyText(v.body_text, v.excerpt);
    }

    // Attached Document
    const docCard = document.querySelector('#attachedDocCard');
    const docName = document.querySelector('#attachedDocName');
    const docLink = document.querySelector('#attachedDocLink');
    if (v.filename) {
      if (docCard) docCard.style.display = 'flex';
      if (docName) docName.textContent = v.filename;
      if (docLink) docLink.href = `/uploads/${encodeURIComponent(v.filename)}`;
    } else {
      if (docCard) docCard.style.display = 'none';
    }
  }

  function renderMoreFilms(current, list) {
    const grid = document.querySelector('#moreFilmsGrid');
    if (!grid) return;
    const others = list.filter(v => v.id !== current.id).slice(0, 3);
    if (!others.length) {
      grid.innerHTML = '<p class="muted">No other published films in the archive yet.</p>';
      return;
    }
    grid.innerHTML = others.map(v => {
      const thumbStyle = v.thumbnail_filename
        ? `style="background-image:url('/uploads/${encodeURIComponent(v.thumbnail_filename)}')"`
        : 'style="background:linear-gradient(135deg,#76806a,#b4a37e)"';
      return `
        <a class="more-vlog-item" href="/vlog.html?id=${v.id}">
          <div class="more-vlog-thumb" ${thumbStyle}></div>
          <div class="more-vlog-meta">
            <span>${esc(v.category || 'Film')}</span>
            <span>${formatDate(v.created_at)}</span>
          </div>
          <h4 class="more-vlog-title">${esc(v.title)}</h4>
          <p class="more-vlog-excerpt">${esc(v.excerpt)}</p>
        </a>
      `;
    }).join('');
  }

  async function loadFeedbackList(vlog) {
    if (!vlog) return;
    const listEl = document.querySelector('#reflectionsListContainer');
    const countTag = document.querySelector('#reflectionsCountTag');
    if (!listEl) return;

    try {
      const q = vlog.id ? `vlog_id=${encodeURIComponent(vlog.id)}` : `vlog_title=${encodeURIComponent(vlog.title)}`;
      const res = await fetch(`/api/feedback?${q}&t=${Date.now()}`);
      if (!res.ok) return;
      const items = await res.json();
      const count = items.length;

      if (countTag) {
        countTag.textContent = `${count} ${count === 1 ? 'Reflection' : 'Reflections'}`;
      }

      if (!items || !items.length) {
        listEl.innerHTML = '<p class="muted" style="text-align:center;padding:20px 0;">No reader reflections submitted yet. Be the first to share your thoughts.</p>';
        return;
      }

      listEl.innerHTML = items.map(fb => `
        <div class="reflection-card-item">
          <div class="reflection-card-meta">
            <strong>${esc(fb.author_name)}</strong>
            <small>${esc(formatDate(fb.created_at))}</small>
          </div>
          <p class="reflection-card-comment">${esc(fb.comment)}</p>
        </div>
      `).join('');
    } catch(e) {}
  }

  function startFeedbackPolling() {
    stopFeedbackPolling();
    feedbackPollTimer = setInterval(() => {
      if (currentVlog && !document.hidden) {
        loadFeedbackList(currentVlog);
      }
    }, 2000);
  }

  function stopFeedbackPolling() {
    if (feedbackPollTimer) {
      clearInterval(feedbackPollTimer);
      feedbackPollTimer = null;
    }
  }

  // Submit Reflection Form
  const feedbackForm = document.querySelector('#articleFeedbackForm') || document.querySelector('#vlogFeedbackForm');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentVlog) return;
      const btn = document.querySelector('#feedbackSubmitBtn');
      const status = document.querySelector('#feedbackFormStatus');
      const fd = new FormData(feedbackForm);

      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        const span = btn.querySelector('span:first-child');
        if (span) span.textContent = 'Submitting…';
      }
      if (status) {
        status.style.display = 'block';
        status.style.color = 'var(--muted)';
        status.textContent = 'Posting reflection…';
      }

      try {
        const payload = {
          vlog_id: typeof currentVlog.id === 'number' ? currentVlog.id : null,
          vlog_title: currentVlog.title,
          author_name: fd.get('author_name'),
          author_email: fd.get('author_email') || '',
          comment: fd.get('comment')
        };

        const resp = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to submit reflection');

        feedbackForm.reset();
        if (status) {
          status.style.color = '#7ce352';
          status.textContent = '✓ Thank you! Your reflection has been published.';
        }
        loadFeedbackList(currentVlog);
      } catch (err) {
        if (status) {
          status.style.color = '#ff8b8b';
          status.textContent = 'Error: ' + err.message;
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          const span = btn.querySelector('span:first-child');
          if (span) span.textContent = 'Submit reflection';
        }
      }
    });
  }

  // Action Buttons Listeners (Complies with Content Security Policy - no inline onclick)
  const copyBtn = document.querySelector('#copyStoryLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        alert('Story link copied to clipboard!');
      }).catch(() => {
        prompt('Copy this story link:', window.location.href);
      });
    });
  }

  const waBtn = document.querySelector('#shareWhatsAppBtn');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const url = encodeURIComponent(window.location.href);
      const title = encodeURIComponent(document.title);
      window.open(`https://api.whatsapp.com/send?text=${title}%20${url}`, '_blank');
    });
  }

  const printBtn = document.querySelector('#printStoryBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Initialize Page
  loadVlogContent();
})();
