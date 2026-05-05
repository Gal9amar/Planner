(function () {
  const NAV_JSON = '/workgant/data/sidebar-nav.json';

  const style = document.createElement('style');
  style.textContent = `
    #qa-board-nav {
      width: 100%;
      margin: 0;
      background: rgba(255,255,255,0.82);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border-radius: 0;
      border-bottom: 1px solid rgba(226,232,240,0.8);
      box-shadow: 0 2px 12px -2px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 24px;
      min-height: 52px;
      flex-shrink: 0;
      z-index: 200;
      flex-wrap: wrap;
      gap: 4px;
      direction: rtl;
      font-family: 'Heebo', sans-serif;
      box-sizing: border-box;
    }
    #qa-board-nav a.qnav-link,
    #qa-board-nav button.qnav-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px;
      color: #475569; text-decoration: none;
      font-weight: 600; font-size: 14px;
      background: none; border: 1px solid transparent;
      font-family: 'Heebo', sans-serif;
      cursor: pointer; transition: all 0.2s ease;
      white-space: nowrap;
    }
    #qa-board-nav a.qnav-link:hover,
    #qa-board-nav button.qnav-btn:hover {
      background: rgba(99,102,241,0.12);
      color: #1e293b;
    }
    #qa-board-nav a.qnav-link.active {
      color: #6366f1;
      font-weight: 700;
      background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15));
      border-color: rgba(99,102,241,0.35);
    }
    .qnav-dropdown { position: relative; }
    .qnav-dropdown-menu {
      position: absolute; top: calc(100% + 6px); right: 0;
      min-width: 200px;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: 14px;
      box-shadow: 0 16px 48px -12px rgba(99,102,241,0.22), 0 4px 16px -4px rgba(0,0,0,0.08);
      padding: 6px; display: flex; flex-direction: column; gap: 2px; z-index: 500;
      direction: rtl;
    }
    .qnav-dropdown-menu a {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 13px; border-radius: 9px;
      color: #1e293b; text-decoration: none;
      font-size: 14px; font-weight: 600; white-space: nowrap;
      font-family: 'Heebo', sans-serif;
      transition: background 0.15s ease;
    }
    .qnav-dropdown-menu a:hover { background: rgba(99,102,241,0.1); }
  `;
  document.head.appendChild(style);

  function getCurrentId() {
    const path = location.pathname;
    if (path.includes('/workgant/')) return 'workgant';
    if (path.includes('/knowledge-base/')) return 'knowledge-base';
    if (path.includes('/regression/')) return 'regression';
    const match = path.match(/\/([^/]+)\.html/);
    return match ? match[1] : 'home';
  }

  function render(items) {
    const nav = document.getElementById('qa-board-nav');
    if (!nav) return;
    const current = getCurrentId();
    let openDropdown = null;

    function build() {
      nav.innerHTML = '';
      items.forEach(item => {
        if (item.children && item.children.length) {
          const wrap = document.createElement('div');
          wrap.className = 'qnav-dropdown';

          const btn = document.createElement('button');
          btn.className = 'qnav-btn';
          btn.innerHTML = (item.icon || '') + ' ' + item.name + ' <span style="font-size:12px;display:inline-block;transition:transform 0.2s" class="qnav-arrow">▾</span>';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDropdown = openDropdown === item.id ? null : item.id;
            build();
          });
          wrap.appendChild(btn);

          if (openDropdown === item.id) {
            const menu = document.createElement('div');
            menu.className = 'qnav-dropdown-menu';
            item.children.forEach(child => {
              const a = document.createElement('a');
              a.href = child.url;
              a.innerHTML = '<span style="font-size:15px;width:22px;text-align:center">' + (child.icon || '') + '</span><span>' + child.name + '</span>';
              menu.appendChild(a);
            });
            wrap.appendChild(menu);
            btn.querySelector('.qnav-arrow').style.transform = 'rotate(180deg)';
          }

          nav.appendChild(wrap);
        } else {
          const a = document.createElement('a');
          a.className = 'qnav-link' + (item.id === current ? ' active' : '');
          a.href = item.url || '#';
          a.textContent = (item.icon || '') + ' ' + item.name;
          nav.appendChild(a);
        }
      });
    }

    build();

    document.addEventListener('click', () => {
      if (openDropdown) { openDropdown = null; build(); }
    });
  }

  fetch(NAV_JSON)
    .then(r => r.json())
    .then(render)
    .catch(() => {});
})();
