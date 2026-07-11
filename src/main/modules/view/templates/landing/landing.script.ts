// src/main/modules/view/templates/landing/landing.script.ts

export const LANDING_SCRIPT = `
<script>
(function() {
  // 0) Nav toggle: mobile menu — controls BOTH layer-1 actions and layer-2 role pills
  var navToggle = document.querySelector('.js-nav-toggle');
  var navCollapsible = document.querySelector('.js-nav-collapsible');
  var roleAnchors = document.querySelector('.role-anchors');
  function focusableElements() {
    // Collect focusable elements inside open menu (nav-toggle + role anchors + nav actions)
    var sel = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';
    var inNav1 = navToggle ? Array.prototype.slice.call(navToggle.parentElement.querySelectorAll(sel)) : [];
    var inNav2 = roleAnchors ? Array.prototype.slice.call(roleAnchors.querySelectorAll(sel)) : [];
    return inNav1.concat(inNav2);
  }
  function isOpen() { return navToggle && navToggle.getAttribute('aria-expanded') === 'true'; }
  function setOpen(open) {
    if (!navToggle) return;
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (navCollapsible) navCollapsible.classList.toggle('open', open);
    if (roleAnchors) roleAnchors.classList.toggle('open', open);
    // Move focus appropriately
    if (open && navToggle) {
      // Focus first focusable in expanded menu after a tick
      setTimeout(function() {
        var els = focusableElements();
        if (els.length > 1) els[1].focus();
      }, 50);
    } else if (navToggle) {
      navToggle.focus();
    }
  }
  if (navToggle) {
    navToggle.addEventListener('click', function() { setOpen(!isOpen()); });
    // Close menu when any nav link is clicked (mobile UX)
    document.querySelectorAll('.js-nav-toggle-link').forEach(function(link) {
      link.addEventListener('click', function() { setOpen(false); });
    });
    // Focus trap: when menu is open, Tab/Shift+Tab cycle within menu
    document.addEventListener('keydown', function(e) {
      if (!isOpen() || e.key !== 'Tab') return;
      var els = focusableElements();
      if (els.length === 0) return;
      var first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    // Esc closes menu
    document.addEventListener('keydown', function(e) {
      if (isOpen() && e.key === 'Escape') { setOpen(false); }
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

  // 2) Ranking tabs — full WAI-ARIA Tab Pattern (aria-selected sync + roving tabindex + keyboard nav)
  function activateTab(tabName) {
    document.querySelectorAll('.js-ranking-tab').forEach(function(t) {
      var match = t.getAttribute('data-tab') === tabName;
      t.classList.toggle('active', match);
      t.setAttribute('aria-selected', match ? 'true' : 'false');
      t.setAttribute('tabindex', match ? '0' : '-1');
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
  var rankingTabs = Array.prototype.slice.call(document.querySelectorAll('.js-ranking-tab'));
  rankingTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      activateTab(tab.getAttribute('data-tab'));
    });
  });
  // Keyboard navigation: ←/→ wrap, Home/End jump (WAI-ARIA Tab Pattern)
  rankingTabs.forEach(function(tab, i) {
    tab.addEventListener('keydown', function(e) {
      var next = null;
      if (e.key === 'ArrowRight') next = rankingTabs[(i + 1) % rankingTabs.length];
      else if (e.key === 'ArrowLeft') next = rankingTabs[(i - 1 + rankingTabs.length) % rankingTabs.length];
      else if (e.key === 'Home') next = rankingTabs[0];
      else if (e.key === 'End') next = rankingTabs[rankingTabs.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        activateTab(next.getAttribute('data-tab'));
      }
    });
  });
  // Restore from URL hash on load
  if (location.hash && location.hash.indexOf('ranking=') === 1) {
    var tabName = location.hash.split('ranking=')[1];
    if (tabName) activateTab(tabName);
  }

  // 2b) Role switcher tabs — same WAI-ARIA Tab Pattern as rankings
  function activateRoleTab(tabName) {
    document.querySelectorAll('.js-roles-tab').forEach(function(t) {
      var match = t.getAttribute('data-tab') === tabName;
      t.classList.toggle('active', match);
      t.setAttribute('aria-selected', match ? 'true' : 'false');
      t.setAttribute('tabindex', match ? '0' : '-1');
    });
    document.querySelectorAll('.js-roles-panel').forEach(function(p) {
      var match = p.getAttribute('data-panel') === tabName;
      p.classList.toggle('active', match);
      if (match) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    if (history.replaceState) {
      history.replaceState(null, '', '#role=' + tabName);
    }
  }
  var roleTabs = Array.prototype.slice.call(document.querySelectorAll('.js-roles-tab'));
  roleTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      activateRoleTab(tab.getAttribute('data-tab'));
    });
  });
  roleTabs.forEach(function(tab, i) {
    tab.addEventListener('keydown', function(e) {
      var next = null;
      if (e.key === 'ArrowRight') next = roleTabs[(i + 1) % roleTabs.length];
      else if (e.key === 'ArrowLeft') next = roleTabs[(i - 1 + roleTabs.length) % roleTabs.length];
      else if (e.key === 'Home') next = roleTabs[0];
      else if (e.key === 'End') next = roleTabs[roleTabs.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        activateRoleTab(next.getAttribute('data-tab'));
      }
    });
  });
  // Restore role from URL hash on load (#role=candidates|employers|headhunters)
  if (location.hash && location.hash.indexOf('role=') === 1) {
    var roleName = location.hash.split('role=')[1];
    if (roleName) activateRoleTab(roleName);
  }

  // 3) Role anchor smooth scroll + activate matching tab when role is set
  document.querySelectorAll('.js-role-anchor').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var targetId = a.getAttribute('data-target');
      var role = a.getAttribute('data-role');
      var target = document.getElementById(targetId);
      if (target) {
        // If this anchor targets the merged roles-switcher, dispatch click on matching tab
        if (targetId === 'for-roles' && role) {
          var tab = document.querySelector('.js-roles-tab[data-tab="' + role + '"]');
          if (tab) tab.click();
        }
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