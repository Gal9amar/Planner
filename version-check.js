// Auto-reload when server version changes
(function () {
  let currentVersion = null;

  async function checkVersion() {
    try {
      const r = await fetch('/api/version');
      if (!r.ok) return;
      const { version } = await r.json();
      if (currentVersion === null) {
        currentVersion = version;
      } else if (version !== currentVersion) {
        window.location.reload();
      }
    } catch {}
  }

  checkVersion();
  setInterval(checkVersion, 60000);
})();
