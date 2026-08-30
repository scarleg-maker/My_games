/**
 * ============================================================
 *  LOCALSYNC.JS - Remplacement local de Firebase Realtime DB
 * ============================================================
 *
 * Ce module reproduit la même interface que celle utilisée
 * avec Firebase (ref / set / onValue) mais fonctionne 100% en
 * local via un serveur Node.js (server.js), sans connexion
 * internet.
 *
 * L'adresse du serveur est déduite automatiquement de l'URL
 * utilisée pour charger la page (location.host). Ainsi, que
 * vous accédiez à la page via un hotspot WiFi ou un partage
 * USB, aucune adresse IP à coder en dur : ça s'adapte tout
 * seul.
 */

(function () {
  function createLocalDatabase() {
    let state = {};
    const listeners = {}; // path -> [callbacks]
    let ws = null;
    let connected = false;
    const pendingQueue = [];
    let reconnectDelay = 1000;

    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + location.host;

    function getPath(obj, path) {
      if (!path) return obj;
      return path
        .split('/')
        .filter(Boolean)
        .reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
    }

    function setPath(obj, path, value) {
      const keys = path.split('/').filter(Boolean);
      if (keys.length === 0) {
        Object.keys(obj).forEach((k) => delete obj[k]);
        if (value && typeof value === 'object') Object.assign(obj, value);
        return;
      }
      let cur = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
        cur = cur[k];
      }
      cur[keys[keys.length - 1]] = value;
    }

    function notifyPath(path) {
      Object.keys(listeners).forEach((lp) => {
        if (lp === path || lp === '' || path.startsWith(lp + '/') || lp.startsWith(path + '/') || path === lp) {
          const val = getPath(state, lp);
          listeners[lp].forEach((cb) => cb({ val: () => val }));
        }
      });
    }

    function notifyAll() {
      Object.keys(listeners).forEach((lp) => {
        const val = getPath(state, lp);
        listeners[lp].forEach((cb) => cb({ val: () => val }));
      });
    }

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connected = true;
        reconnectDelay = 1000;
        while (pendingQueue.length) {
          ws.send(JSON.stringify(pendingQueue.shift()));
        }
        if (typeof window.onLocalSyncStatusChange === 'function') {
          window.onLocalSyncStatusChange(true);
        }
      };

      ws.onmessage = (evt) => {
        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch (e) {
          return;
        }
        if (msg.type === 'state') {
          state = msg.state || {};
          notifyAll();
        } else if (msg.type === 'update') {
          setPath(state, msg.path, msg.value);
          notifyPath(msg.path);
        }
      };

      ws.onclose = () => {
        connected = false;
        if (typeof window.onLocalSyncStatusChange === 'function') {
          window.onLocalSyncStatusChange(false);
        }
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) {}
      };
    }

    connect();

    return {
      set(path, value) {
        return new Promise((resolve) => {
          setPath(state, path, value);
          notifyPath(path);
          const msg = { type: 'set', path, value };
          if (connected) {
            ws.send(JSON.stringify(msg));
          } else {
            pendingQueue.push(msg);
          }
          resolve();
        });
      },
      onValue(path, callback) {
        if (!listeners[path]) listeners[path] = [];
        listeners[path].push(callback);
        callback({ val: () => getPath(state, path) });
      },
      get(path) {
        return Promise.resolve({ val: () => getPath(state, path) });
      },
      isConnected() {
        return connected;
      }
    };
  }

  window.LocalSync = { createLocalDatabase };
})();
