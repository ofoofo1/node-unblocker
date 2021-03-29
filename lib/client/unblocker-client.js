(function (global) {
  "use strict";

  // todo:
  // - postMessage
  // - open
  // - split each part into separate files (?)
  // - wrap other JS and provide proxies to fix writes to window.location and document.cookie
  //   - will require updating contentTypes.html.includes(data.contentType) to include js
  //   - that, in turn will require decompressing js....

  function fixUrl(urlStr, config, location) {
    var currentRemoteHref;
    if (location.pathname.substr(0, config.prefix.length) === config.prefix) {
      currentRemoteHref =
        location.pathname.substr(config.prefix.length) +
        location.search +
        location.hash;
    } else {
      // in case sites like youtube bypass our history wrapper somehow
      currentRemoteHref = config.url;
    }
    var url = new URL(urlStr, currentRemoteHref);

    //todo: handle already proxied urls (will be important for checking current dom)

    // don't break data: urls
    if (url.protocol === "data:") {
      return urlStr;
    }

    // sometimes websites are tricky
    // check hostname (ignoring port)
    if (url.hostname === location.hostname) {
      var currentRemoteUrl = new URL(currentRemoteHref);
      // set host (including port)
      url.host = currentRemoteUrl.host;
      // also keep the remote site's current protocol
      url.protocol = currentRemoteUrl.protocol;
      // todo: handle websocket protocols
    }
    return config.prefix + url.href;
  }

  function initXMLHttpRequest(config, window) {
    if (typeof window.XMLHttpRequest === "undefined") return;
    var _XMLHttpRequest = window.XMLHttpRequest;

    window.XMLHttpRequest = function (opts) {
      var xhr = new _XMLHttpRequest(opts);
      var _open = xhr.open;
      xhr.open = function () {
        var args = Array.prototype.slice.call(arguments);
        args[1] = fixUrl(args[1], config, location);
        return _open.apply(xhr, args);
      };
      return xhr;
    };
  }

  function initFetch(config, window) {
    if (typeof window.fetch === "undefined") return;
    var _fetch = window.fetch;

    window.fetch = function (resource, init) {
      if (resource.url) {
        resource.url = fixUrl(resource.url, config, location);
      } else {
        resource = fixUrl(resource.toString(), config, location);
      }
      return _fetch(resource, init);
    };
  }

  function initCreateElement(config, window) {
    if (
      typeof window.document === "undefined" ||
      typeof window.document.createElement === "undefined"
    )
      return;
    var _createElement = window.document.createElement;

    window.document.createElement = function (tagName, options) {
      var element = _createElement.call(window.document, tagName, options);
      // todo: whitelist elements with href or src attributes and only check those
      setTimeout(function () {
        if (element.src) {
          element.src = fixUrl(element.src, config, location);
        }
        if (element.href) {
          element.href = fixUrl(element.href, config, location);
        }
        // todo: support srcset and ..?
      }, 0);
      // todo: handle urls that aren't set immediately
      return element;
    };
  }

  // js on some sites, such as youtube, uses an iframe to grab native APIs such as history, so we need to fix those also.
  // the
  // function initBodyAppendiFrame(config, window) {
  //   if (
  //     typeof window.document === "undefined" ||
  //     typeof window.document.body === "undefined"
  //   )
  //         if (tagName.toLowerCase() === 'iframe' && element.contentWindow) {
  //           // todo: check if we need to wait for onLoad or whatever
  //             initForWindow(config, element.contentWindow);
  //           }
  // }

  function initWebsockets(config, window) {
    if (typeof window.WebSocket === "undefined") return;
    var _WebSocket = window.WebSocket;
    var prefix = config.prefix;
    var proxyHost = location.host;
    var isSecure = location.protocol === "https";
    var target = location.pathname.substr(prefix.length);
    var targetURL = new URL(target);

    // ws:// or wss:// then at least one char for location,
    // then either the end or a path
    var reWsUrl = /^ws(s?):\/\/([^/]+)($|\/.*)/;

    window.WebSocket = function (url, protocols) {
      var parsedUrl = url.match(reWsUrl);
      if (parsedUrl) {
        var wsSecure = parsedUrl[1];
        // force downgrade if wss:// is called on insecure page
        // (in case the proxy only supports http)
        var wsProto = isSecure ? "ws" + wsSecure + "://" : "ws://";
        var wsHost = parsedUrl[2];
        // deal with "relative" js that uses the current url rather than a hard-coded one
        if (wsHost === location.host || wsHost === location.hostname) {
          // todo: handle situation where ws hostname === location.hostname but ports differ
          wsHost = targetURL.host;
        }
        var wsPath = parsedUrl[3];
        // prefix the websocket with the proxy server
        return new _WebSocket(
          wsProto +
            proxyHost +
            prefix +
            "http" +
            wsSecure +
            "://" +
            wsHost +
            wsPath
        );
      }
      // fallback in case the regex failed
      return new _WebSocket(url, protocols);
    };
  }

  // todo: figure out how youtube bypasses this
  // notes: look at bindHistoryStateFunctions_ - it looks like it checks the contentWindow.history of an iframe *fitst*, then it's __proto__, then the global history api
  //        - so, we need to inject this into iframes also
  function initPushState(config, window) {
    if (
      typeof window.history === "undefined" ||
      typeof window.history.pushState === "undefined"
    )
      return;

    var _pushState = window.history.pushState;
    window.history.pushState = function (state, title, url) {
      if (url) {
        url = fixUrl(url, config, location);
        config.url = new URL(url, config.url);
        return _pushState.call(history, state, title, url);
      }
    };

    if (typeof window.history.replaceState === "undefined") return;
    var _replaceState = window.history.replaceState;
    window.history.replaceState = function (state, title, url) {
      if (url) {
        url = fixUrl(url, config, location);
        config.url = new URL(url, config.url);
        return _replaceState.call(history, state, title, url);
      }
    };
  }

  function initForWindow(unblocker, window) {
    console.log("begin unblocker client scripts", unblocker, window);
    initXMLHttpRequest(unblocker, window);
    initFetch(unblocker, window);
    initCreateElement(unblocker, window);
    initWebsockets(unblocker, window);
    initPushState(unblocker, window);
    if (window === global) {
      // leave no trace
      delete global.unblockerInit;
    }
    console.log("unblocker client scripts initialized");
  }

  // either export things for testing or put the init method into the global scope to be called
  // with config by the next script tag in a browser
  /*globals module*/
  if (typeof module === "undefined") {
    global.unblockerInit = initForWindow;
  } else {
    module.exports = {
      initForWindow: initForWindow,
      fixUrl: fixUrl,
    };
  }
})(this); // window in a browser, global in node.js
