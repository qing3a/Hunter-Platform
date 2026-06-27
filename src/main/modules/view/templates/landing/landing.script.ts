// src/main/modules/view/templates/landing/landing.script.ts

export const LANDING_SCRIPT = `
<script>
(function() {
  // 0) Nav toggle: mobile menu (P1.7 v2)
  var navToggle = document.querySelector('.js-nav-toggle');
  var navCollapsible = document.querySelector('.js-nav-collapsible');
  if (navToggle && navCollapsible) {
    navToggle.addEventListener('click', function() {
      var isOpen = navCollapsible.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    // Close menu when a nav link is clicked (mobile UX)
    navCollapsible.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        navCollapsible.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // 1) Copy buttons: copy URL to clipboard
  document.querySelectorAll('.js-copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var path = btn.getAttribute('data-copy') || '/v1/skill.md';
      var url = window.location.origin + path;
      var original = btn.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          btn.textContent = '✓ 已复制';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
        }).catch(function() {
          btn.textContent = '复制失败，请手动复制';
          setTimeout(function() { btn.textContent = original; }, 2000);
        });
      } else {
        // Fallback: select-and-copy via textarea
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); btn.textContent = '✓ 已复制'; }
        catch (e) { btn.textContent = '复制失败，请手动复制'; }
        document.body.removeChild(ta);
        setTimeout(function() { btn.textContent = original; }, 2000);
      }
    });
  });

  // 2) Ranking tabs
  function activateTab(tabName) {
    document.querySelectorAll('.js-ranking-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.js-ranking-panel').forEach(function(p) {
      var match = p.getAttribute('data-panel') === tabName;
      p.classList.toggle('active', match);
      if (match) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    if (history.replaceState) {
      history.replaceState(null, '', '#ranking=' + tabName);
    }
  }
  document.querySelectorAll('.js-ranking-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      activateTab(tab.getAttribute('data-tab'));
    });
  });
  // Restore from URL hash on load
  if (location.hash && location.hash.indexOf('ranking=') === 1) {
    var tabName = location.hash.split('ranking=')[1];
    if (tabName) activateTab(tabName);
  }

  // 3) Role anchor smooth scroll
  document.querySelectorAll('.js-role-anchor').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var targetId = a.getAttribute('data-target');
      var target = document.getElementById(targetId);
      if (target) {
        var navH = 64;
        var y = target.getBoundingClientRect().top + window.pageYOffset - navH - 8;
        window.scrollTo({ top: y, behavior: 'smooth' });
        if (history.pushState) history.pushState(null, '', '#' + targetId);
      }
    });
  });

  // 4) Sticky-nav section highlight
  if ('IntersectionObserver' in window) {
    var sections = ['for-employers', 'for-headhunters', 'for-candidates', 'rankings']
      .map(function(id) { return document.getElementById(id); })
      .filter(Boolean);
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          document.querySelectorAll('.js-role-anchor').forEach(function(a) {
            a.classList.toggle('active', a.getAttribute('data-target') === id);
          });
        }
      });
    }, { rootMargin: '-100px 0px -50% 0px' });
    sections.forEach(function(s) { observer.observe(s); });
  }

  // 5) CountUp animation (existing v2 feature)
  function countUp(el, target, duration) {
    var start = 0;
    var startTime = performance.now();
    function tick(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }
  document.querySelectorAll('.stat-value[data-target]').forEach(function(el) {
    var target = parseInt(el.getAttribute('data-target'), 10) || 0;
    if (target > 0) countUp(el, target, 1500);
  });
})();
</script>
<noscript><style>.card { animation: none !important; }</style></noscript>
`.trim();