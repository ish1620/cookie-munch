// Stand-in for Safari's extension APIs on live sites (tests/live/run_live.mjs), loaded just before
// content.js in every frame. Unlike tests/harness.js it changes nothing on the page: it stores nothing,
// answers as Decline mode with no site switched off, has no cookie list (no site selectors, no hiding
// CSS), and passes each message content.js sends on to the test runner as a console line.
(() => {
  'use strict';

  const MESSAGE_PREFIX = '[Cookie Munch test] '; // the runner reads console lines that start with this
  const debug = console.debug.bind(console);     // kept now, in case the page replaces console.debug later

  globalThis.browser = {
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, disabledSites: [], mode: 'decline' }),
        set: async () => {},
      },
    },
    runtime: {
      sendMessage: async (message) => {
        debug(MESSAGE_PREFIX + JSON.stringify(message));
        return undefined; // no background script: no site selectors, no hiding CSS
      },
    },
  };
})();
