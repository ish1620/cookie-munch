// Random consent-settings panels, for testing how content.js turns a panel's switches off.
// Used by run.mjs (see its header for how to run); loaded by unit.html and page.html.
//
// RandomPanels.specFor(seed, index, e2e) describes one panel as plain data, always the same for the same
// arguments. RandomPanels.build() draws it, with each switch behaving like the tool or library it is
// modelled on, and RandomPanels.judge() says how the panel ended. The oracle: every switch that is not
// locked ends off, locked ones keep their state, and nothing outside the banner, no Accept and no link
// is clicked.
//
// Each shape names where its markup comes from. "autoconsent" is DuckDuckGo autoconsent's rule files
// (rules/autoconsent/<name>.json, lib/cmps/<name>.ts), "Consent-O-Matic" its rules/<name>.json; libraries
// are named by their switch component's source. A shape marked guess has no source: it is a variation
// that seemed likely. A shape marked unreadable says nothing a generic reader can go by (no checkbox,
// no role, no aria state): Cookie Munch is expected to leave those on, and they are counted apart.
(() => {
  'use strict';

  const RENDER_DELAY_MS = 50;  // a "delay" switch redraws this long after a click
  const VIEW_DRAW_MS = 400;    // a legitimate-interest view draws this long after its tab is clicked
  const NAMES = ['Analytics', 'Marketing', 'Statistics', 'Personalisation', 'Advertising', 'Social media',
    'Measurement', 'Functional', 'Performance', 'Targeting'];

  // shape: [weight, variants, render modes, lock kinds, flags]
  //   render: native (the browser's own checkbox), sync (redrawn during the click, as React does),
  //           micro (redrawn in a microtask, as Vue, Preact and Lit do), delay (redrawn later)
  //   lock:   attr (disabled), aria (aria-disabled="true"), class (a class only; the handler ignores clicks)
  const SHAPES = {
    // input[type=checkbox]: 257 of autoconsent's 316 opt-out rules with a switch click one.
    //   plain      label > input
    //   label-for  OneTrust: input.category-switch-handler[role=switch] + label.ot-switch (autoconsent onetrust)
    //   bootstrap  .form-check.form-switch > input[role=switch] (Bootstrap docs, Checks and radios)
    //   klaro      input.cm-list-input + label > .cm-switch, redrawn by Preact (klaro-js service-item.jsx)
    //   mui        .MuiSwitch-root > .MuiSwitch-switchBase > input (MUI SwitchBase.js; autoconsent praca-pl)
    //   ketch      input[role=switch][aria-checked] (autoconsent ketch, smallpdf, aws-amazon)
    //   ark        label[data-state] > hidden input (zag-js switch.connect.ts; autoconsent kartverket)
    checkbox: [24, { plain: ['native'], 'label-for': ['native'], bootstrap: ['native'], klaro: ['micro'],
      mui: ['sync'], ketch: ['sync', 'micro'], ark: ['sync', 'micro'] }, ['attr']],
    // button[role=switch][aria-checked]: rc-switch (Ant Design), Radix, Headless UI; Sourcepoint's
    // pm-switch and InMobi's .qc-cmp2-toggle-switch > button (Consent-O-Matic sourcepoint_frame_2022,
    // quantcast2b); autoconsent arena-ai, concept3d, pandectes.
    //   radix-form     plus Radix's sibling input[type=checkbox][aria-hidden] (radix switch.tsx, BubbleInput)
    //   headless-form  plus Headless UI's sibling input[type=checkbox][hidden][readonly] (form-fields.tsx)
    'button-switch': [18, { plain: ['sync', 'micro', 'delay'], 'radix-form': ['sync'], 'headless-form': ['sync'] },
      ['attr', 'aria', 'class']],
    // [role=checkbox][aria-checked] on a div or span (Vant Checker.tsx; autoconsent privacymanager, stright).
    'role-checkbox': [5, { plain: ['sync', 'micro'] }, ['aria', 'class']],
    // A wrapper with role=switch around the real input; the click handler is on the wrapper and works
    // from the value drawn last (Element UI 2 switch component.vue; Quasar use-checkbox.js).
    'wrapper-input': [10, { 'element-ui': ['micro'], quasar: ['micro'] }, ['aria']],
    // Element Plus: the role is on the input, the handler on the div around it (switch.vue).
    'inner-role-input': [5, { plain: ['micro'] }, ['attr']],
    // Sourcepoint's pm-toggle: a switch holding an Off and an On part, each a switch; only a part's
    // click counts (seen on thesun.co.uk; Consent-O-Matic sourcepoint_frame_2022 ".pm-type-toggle > div").
    'two-part': [6, { 'off-first': ['delay'], 'on-first': ['delay'] }, []],
    // button[aria-pressed] (autoconsent hl-co-uk).
    'pressed-button': [5, { plain: ['sync', 'micro'] }, ['attr']],
    // A custom element with the input in its open shadow root (Shoelace switch.component.ts).
    'shadow-switch': [6, { plain: ['micro'] }, ['attr']],
    // Ionic's ion-toggle: the host is a switch and listens; its open shadow root holds an input that is
    // a switch too. The host flips its state at once and redraws a frame later (ionic toggle.tsx).
    'host-switch': [5, { ionic: ['delay'] }, ['aria']],
    // Guesses: a label or div with role=switch around a checkbox, where only the checkbox listens.
    'label-switch': [3, { plain: ['sync', 'micro'] }, ['attr'], { guess: true }],
    'div-switch-input': [3, { plain: ['sync', 'micro'] }, ['attr'], { guess: true }],
    // Unreadable: a class is the only state (autoconsent sourcepoint-frame "a.switch-bg.on", mega-io).
    'class-only': [3, { div: ['sync'], link: ['sync'] }, [], { unreadable: true }],
    // Unreadable: an on and an off radio (autoconsent cc-banner-springer, ct-ultimate-gdpr).
    'radio-pair': [2, { plain: ['native'] }, [], { unreadable: true }],
    // Unreadable: [aria-pressed] on something that is not a button (autoconsent web-rewind.com; tag guessed).
    'pressed-div': [2, { plain: ['sync'] }, [], { unreadable: true, guess: true }],
    // Unreadable: aria-checked stays "false" whatever the state (autoconsent bigid).
    'aria-stuck': [1, { plain: ['sync'] }, [], { unreadable: true }],
  };

  // A small seeded generator (mulberry32).
  function randomFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function specFor(seed, index, e2e = false) {
    const random = randomFrom(Math.imul(seed, 1000003) + Math.imul(index + 1, 7919));
    const chance = (p) => random() < p;
    const pick = (list) => list[Math.floor(random() * list.length)];
    const names = Object.keys(SHAPES);
    const total = names.reduce((sum, name) => sum + SHAPES[name][0], 0);
    const shape = () => {
      let at = random() * total;
      return names.find((name) => (at -= SHAPES[name][0]) < 0) ?? names[0];
    };
    const row = (late) => {
      const name = shape();
      const [, variants, locks] = SHAPES[name];
      const variant = pick(Object.keys(variants));
      const locked = locks.length > 0 && chance(0.2);
      return {
        shape: name, variant, render: pick(variants[variant]),
        locked, lock: locked ? pick(locks) : null,
        on: locked ? chance(0.85) : chance(0.75),
        wrap: pick(['none', 'none', 'none', 'list', 'deep', 'hidden', 'shadow']),
        late: late && chance(0.25) ? 100 + Math.floor(random() * 500) : 0,
      };
    };
    const rows = Array.from({ length: 1 + Math.floor(random() * 8) }, () => row(e2e));
    const spec = {
      seed, index, rows,
      shadowPanel: chance(0.1),                    // every row inside one shadow root, as Usercentrics does
      master: chance(0.12) ? { first: chance(0.5), render: pick(['sync', 'micro']) } : null, // a guess
      pressedAccept: chance(0.1),                  // an "Accept all" that carries aria-pressed
      save: pick(['Save my choices', 'Confirm my choices', 'Save & Exit', 'Save preferences']),
    };
    if (e2e) {
      spec.layout = chance(0.15) ? 'first-layer' : 'settings';
      spec.frame = chance(0.12);
      spec.legit = spec.layout === 'settings' && chance(0.2)
        ? { rows: Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({ ...row(false), locked: false, lock: null, on: true })),
          objectAll: chance(0.4) }
        : null;
    }
    return spec;
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------
  let nextId = 0;

  function el(doc, tag, attrs = {}, ...children) {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== false) node.setAttribute(name, value === true ? '' : value);
    node.append(...children);
    return node;
  }

  const later = (mode, draw) => {
    if (mode === 'micro') queueMicrotask(draw);
    else if (mode === 'delay') setTimeout(draw, RENDER_DELAY_MS);
    else draw();
  };

  // One switch. Returns its node, how to read and set its real state, and what must never be clicked.
  // `changed` tells the panel that a state changed (a "toggle all" switch redraws itself then).
  function drawSwitch(doc, row, name, changed) {
    const { shape, variant, render, locked, lock } = row;
    const id = `rp-${nextId++}`;
    let on = row.on;
    const forbidden = [];
    let node;
    let draw = () => {};
    let get = () => on;
    const flip = (value) => { on = value; later(render, draw); changed(); };

    if (shape === 'checkbox') {
      const input = el(doc, 'input', { type: 'checkbox', id, checked: on, disabled: locked });
      input.checked = on;
      const controlled = render !== 'native';
      if (variant === 'plain') node = el(doc, 'label', {}, input, ` ${name}`);
      if (variant === 'label-for') {
        input.className = 'category-switch-handler';
        input.setAttribute('role', 'switch');
        node = el(doc, 'div', { class: 'ot-tgl' }, input, el(doc, 'label', { class: 'ot-switch', for: id },
          el(doc, 'span', { class: 'ot-switch-nob' }), el(doc, 'span', { class: 'ot-label-txt' }, name)));
      }
      if (variant === 'bootstrap') {
        input.className = 'form-check-input';
        input.setAttribute('role', 'switch');
        node = el(doc, 'div', { class: 'form-check form-switch' }, input, el(doc, 'label', { class: 'form-check-label', for: id }, name));
      }
      if (variant === 'klaro') {
        input.className = `cm-list-input${locked ? ' required' : ''}`;
        node = el(doc, 'div', { class: 'cm-purpose' }, input, el(doc, 'label', { class: 'cm-list-label', for: id },
          el(doc, 'span', { class: 'cm-list-title' }, name), el(doc, 'span', { class: 'cm-switch' }, el(doc, 'div', { class: 'slider round' }))));
      }
      if (variant === 'mui') {
        input.className = 'MuiSwitch-input';
        input.style.cssText = 'position:absolute;opacity:0;width:100%;height:100%;margin:0';
        node = el(doc, 'label', {}, el(doc, 'span', { class: 'MuiSwitch-root', style: 'position:relative;display:inline-block' },
          el(doc, 'span', { class: 'MuiSwitch-switchBase' }, input, el(doc, 'span', { class: 'MuiSwitch-thumb' }, 'o')),
          el(doc, 'span', { class: 'MuiSwitch-track' })), ` ${name}`);
      }
      if (variant === 'ketch') {
        input.setAttribute('role', 'switch');
        node = el(doc, 'label', {}, input, ` ${name}`);
      }
      if (variant === 'ark') {
        input.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
        node = el(doc, 'label', { 'data-scope': 'switch', 'data-part': 'root' }, input,
          el(doc, 'span', { 'data-part': 'control', 'aria-hidden': 'true' }, 'o'), el(doc, 'span', {}, name));
        node.addEventListener('click', (event) => { if (event.target === input) event.stopPropagation(); });
      }
      draw = () => {
        input.checked = on;
        if (variant === 'ketch') input.setAttribute('aria-checked', String(on));
        if (variant === 'ark') node.setAttribute('data-state', on ? 'checked' : 'unchecked');
      };
      draw();
      // A controlled checkbox takes the state the click gave the input, then draws it again.
      input.addEventListener('change', () => { on = input.checked; if (controlled) later(render, draw); changed(); });
      if (!controlled) get = () => input.checked;
    }

    if (shape === 'button-switch') {
      const button = el(doc, 'button', { type: 'button', role: 'switch', class: 'pm-switch', disabled: lock === 'attr',
        'aria-disabled': lock === 'aria' ? 'true' : null }, el(doc, 'span', { class: 'slider' }, 'o'));
      if (lock === 'class') button.classList.add('disabled');
      button.addEventListener('click', () => { if (!locked) flip(!on); });
      node = el(doc, 'div', { class: 'qc-cmp2-toggle-switch' }, el(doc, 'span', {}, `${name} `), button);
      let field = null;
      if (variant === 'radix-form') {
        // Radix's form input: a click on it changes only the input, and stops there.
        field = el(doc, 'input', { type: 'checkbox', 'aria-hidden': 'true', tabindex: '-1', disabled: lock === 'attr',
          style: 'position:absolute;pointer-events:none;opacity:0;margin:0' });
        field.addEventListener('click', (event) => event.stopPropagation());
        get = () => on || field.checked;
      }
      if (variant === 'headless-form') field = el(doc, 'input', { type: 'checkbox', hidden: true, readonly: true });
      if (field) node.append(field);
      draw = () => {
        button.setAttribute('aria-checked', String(on));
        if (field) field.checked = on;
      };
      draw();
    }

    if (shape === 'role-checkbox') {
      node = el(doc, 'div', { role: 'checkbox', class: `van-checkbox${lock === 'class' ? ' van-checkbox--disabled' : ''}`,
        tabindex: locked ? null : '0', 'aria-disabled': lock === 'aria' ? 'true' : null },
      el(doc, 'div', { class: 'van-checkbox__icon' }, 'o'), el(doc, 'span', { class: 'van-checkbox__label' }, ` ${name}`));
      node.addEventListener('click', () => { if (!locked) flip(!on); });
      draw = () => node.setAttribute('aria-checked', String(on));
      draw();
    }

    if (shape === 'wrapper-input' || shape === 'inner-role-input') {
      // Vue: the handler flips the value that was drawn last, which follows the real one a tick later.
      let drawn = on;
      const quasar = variant === 'quasar';
      const input = quasar && locked ? null // Quasar leaves the input out of a disabled toggle
        : el(doc, 'input', { type: 'checkbox', class: quasar ? 'q-toggle__native' : 'el-switch__input', disabled: locked,
          style: 'position:absolute;width:0;height:0;opacity:0;margin:0' });
      const core = el(doc, 'span', { class: 'el-switch__core', style: 'display:inline-block;width:40px' }, 'o');
      const wrapper = el(doc, 'div', { class: quasar ? 'q-toggle' : 'el-switch' }, ...(quasar
        ? [el(doc, 'div', { 'aria-hidden': 'true' }, ...(input ? [input] : []), core)] : [input, core]));
      const roleOn = shape === 'inner-role-input' ? input : wrapper;
      roleOn.setAttribute('role', 'switch');
      if (locked) roleOn.setAttribute('aria-disabled', 'true');
      if (locked) wrapper.classList.add('is-disabled');
      if (quasar) wrapper.setAttribute('tabindex', locked ? '-1' : '0');
      const handle = () => { if (!locked) flip(!drawn); };
      wrapper.addEventListener('click', (event) => {
        event.preventDefault();
        if (quasar) event.stopPropagation();
        handle();
      });
      if (input && !quasar) input.addEventListener('change', handle);
      node = el(doc, 'div', {}, `${name} `, wrapper);
      draw = () => {
        drawn = on;
        roleOn.setAttribute('aria-checked', String(on));
        wrapper.classList.toggle('is-checked', on);
        if (input) input.checked = on;
      };
      draw();
    }

    if (shape === 'two-part') {
      const off = el(doc, 'span', { class: 'off', role: 'switch' }, 'Off');
      const onPart = el(doc, 'span', { class: 'on', role: 'switch' }, 'On');
      const button = el(doc, 'button', { type: 'button', class: 'pm-toggle', role: 'switch' },
        ...(variant === 'on-first' ? [onPart, off] : [off, onPart]));
      off.addEventListener('click', () => flip(false));
      onPart.addEventListener('click', () => flip(true));
      forbidden.push(onPart);
      node = el(doc, 'div', {}, `${name} `, button);
      draw = () => { for (const part of [button, off, onPart]) part.setAttribute('aria-checked', String(on)); };
      draw();
    }

    if (shape === 'pressed-button' || shape === 'pressed-div') {
      node = el(doc, shape === 'pressed-div' ? 'div' : 'button', { class: 'toggle-switch', disabled: locked,
        type: shape === 'pressed-div' ? null : 'button', tabindex: shape === 'pressed-div' ? '0' : null }, name);
      node.addEventListener('click', () => { if (!locked) flip(!on); });
      draw = () => node.setAttribute('aria-pressed', String(on));
      draw();
    }

    if (shape === 'shadow-switch') {
      const input = el(doc, 'input', { type: 'checkbox', class: 'switch__input', role: 'switch', disabled: locked });
      node = el(doc, 'sl-switch', { disabled: locked }, name);
      node.attachShadow({ mode: 'open' }).append(el(doc, 'label', { class: 'switch' }, input,
        el(doc, 'span', { class: 'switch__control' }, 'o'), el(doc, 'slot')));
      input.addEventListener('click', () => flip(!on));
      draw = () => {
        input.checked = on;
        input.setAttribute('aria-checked', String(on));
        node.toggleAttribute('checked', on);
      };
      draw();
    }

    if (shape === 'host-switch') {
      const input = el(doc, 'input', { type: 'checkbox', role: 'switch', id, disabled: locked });
      node = el(doc, 'ion-toggle', { role: 'switch', 'aria-disabled': locked ? 'true' : null }, name);
      node.attachShadow({ mode: 'open' }).append(el(doc, 'label', { class: 'toggle-wrapper', for: id }, input, el(doc, 'slot')));
      node.addEventListener('click', (event) => {
        if (locked) return;
        event.preventDefault();
        flip(!on);
      });
      draw = () => {
        input.checked = on;
        for (const part of [node, input]) part.setAttribute('aria-checked', String(on));
      };
      draw();
    }

    if (shape === 'label-switch' || shape === 'div-switch-input') {
      const input = el(doc, 'input', { type: 'checkbox', disabled: locked });
      input.checked = on;
      node = el(doc, shape === 'label-switch' ? 'label' : 'div', { class: 'toggle', role: 'switch',
        'aria-disabled': locked ? 'true' : null }, input, el(doc, 'span', {}, ` ${name}`));
      input.addEventListener('change', () => flip(input.checked));
      draw = () => {
        input.checked = on;
        node.setAttribute('aria-checked', String(on));
      };
      draw();
    }

    if (shape === 'class-only') {
      const knob = el(doc, variant === 'link' ? 'a' : 'div', { class: variant === 'link' ? 'switch-bg' : 'toggle-control' }, 'o');
      knob.addEventListener('click', () => flip(!on));
      node = el(doc, 'div', {}, `${name} `, knob);
      draw = () => knob.classList.toggle('on', on);
      draw();
    }

    if (shape === 'radio-pair') {
      const radios = ['on', 'off'].map((value) => el(doc, 'input', { type: 'radio', name: id, value }));
      radios[on ? 0 : 1].checked = true;
      node = el(doc, 'div', {}, `${name} `, el(doc, 'label', {}, radios[0], ' On'), el(doc, 'label', {}, radios[1], ' Off'));
      get = () => radios[0].checked;
      draw = () => { radios[on ? 0 : 1].checked = true; };
    }

    if (shape === 'aria-stuck') {
      const knob = el(doc, 'span', {}, 'o');
      const button = el(doc, 'button', { type: 'button', role: 'switch', 'aria-checked': 'false' }, knob);
      button.addEventListener('click', () => flip(!on));
      node = el(doc, 'div', {}, `${name} `, button);
      draw = () => knob.classList.toggle('translate-x', on);
      draw();
    }

    const flags = SHAPES[shape][3] ?? {};
    return {
      node, forbidden, get, initial: get(), locked,
      set: (value) => { if (!locked) flip(value); },
      label: `${shape}/${variant}/${render}${locked ? `/locked-${lock}` : ''}`,
      where: row.wrap, unreadable: Boolean(flags.unreadable), guess: Boolean(flags.guess),
    };
  }

  // Put a row's node where its `wrap` says.
  function wrapRow(doc, node, wrap) {
    if (wrap === 'list') return el(doc, 'ul', {}, el(doc, 'li', {}, node));
    if (wrap === 'deep') return el(doc, 'div', { class: 'group' }, el(doc, 'div', {}, el(doc, 'div', {}, node)));
    if (wrap === 'hidden') return el(doc, 'div', { class: 'details', hidden: true }, node); // a closed "details" part
    if (wrap === 'shadow') {
      const host = el(doc, 'x-row');
      host.attachShadow({ mode: 'open' }).append(node);
      return host;
    }
    return node;
  }

  function drawRows(doc, rows, into, panel, linked) {
    rows.forEach((row, i) => {
      const item = drawSwitch(doc, row, NAMES[i % NAMES.length], () => panel.changed());
      panel.switches.push(item);
      panel.forbidden.push(...item.forbidden);
      if (linked && !item.locked) linked.push(item);
      const node = wrapRow(doc, item.node, row.wrap);
      if (row.late) {
        const place = doc.createComment('late row');
        into.append(place);
        panel.lateRows.push(() => setTimeout(() => place.replaceWith(node), row.late));
      } else {
        into.append(node);
      }
    });
  }

  // The settings panel: its switches, a Save button and an Accept button, and around it things that
  // must stay as they are. `mount` gets everything; the panel itself is `banner`.
  function build(spec, doc, mount) {
    const panel = { spec, switches: [], forbidden: [], lateRows: [], clicks: [], banners: [], changed: () => {}, savedWith: null };
    const banner = el(doc, 'div', { class: 'fixed', role: 'dialog', 'aria-modal': 'true', 'data-banner': true },
      el(doc, 'h2', {}, 'Cookie preferences'), el(doc, 'p', {}, 'Choose which cookies we and our partners may use on this site.'));
    panel.banner = banner;
    panel.banners.push(banner);
    let into = banner;
    if (spec.shadowPanel) {
      const host = el(doc, 'div', { id: 'consent-root' });
      into = host.attachShadow({ mode: 'open' });
      banner.append(host);
    }
    const linked = [];
    const rowsBox = el(doc, 'div', { class: 'rows' });
    if (spec.master) {
      // A guess: one switch for all the others, on while every one of them is on.
      const all = el(doc, 'button', { type: 'button', role: 'switch', 'aria-label': 'All categories' }, 'o');
      const drawAll = () => all.setAttribute('aria-checked', String(linked.length > 0 && linked.every((item) => item.get())));
      panel.changed = () => later(spec.master.render, drawAll);
      all.addEventListener('click', () => {
        const value = !linked.every((item) => item.get());
        for (const item of linked) item.set(value);
        panel.changed();
      });
      panel.drawAll = drawAll;
      const allRow = el(doc, 'div', { class: 'all' }, 'All ', all);
      if (spec.master.first) into.append(allRow, rowsBox); else into.append(rowsBox, allRow);
    } else {
      into.append(rowsBox);
    }
    drawRows(doc, spec.rows, rowsBox, panel, linked);
    panel.drawAll?.();

    const button = (label, attrs = {}) => el(doc, 'button', { type: 'button', ...attrs }, label);
    const link = el(doc, 'a', { href: '/privacy-policy' }, 'Privacy policy');
    const accept = button('Accept all', spec.pressedAccept ? { 'aria-pressed': 'false' } : {});
    const save = button(spec.save);
    panel.save = save;
    panel.forbidden.push(link, accept);
    if (spec.legit) {
      // A "Legitimate Interest" tab: its switches are drawn a moment after the click, and not before.
      const tab = el(doc, 'div', { role: 'tab' }, 'Legitimate Interest');
      const view = el(doc, 'div', { class: 'legit-view' });
      panel.legitUnopened = true; // its purposes are on until someone opens the view and objects
      tab.addEventListener('click', () => {
        setTimeout(() => {
          panel.legitUnopened = false;
          const from = panel.switches.length;
          drawRows(doc, spec.legit.rows, view, panel, null);
          if (spec.legit.objectAll) {
            const objectAll = button('Object all');
            objectAll.addEventListener('click', () => { for (const item of panel.switches.slice(from)) item.set(false); });
            view.prepend(objectAll);
          }
          banner.insertBefore(view, save);
        }, VIEW_DRAW_MS);
      }, { once: true });
      banner.append(tab);
    }
    banner.append(save, accept, el(doc, 'p', {}, link));

    // Outside the banner: nothing here may be clicked or changed.
    const newsletter = el(doc, 'input', { type: 'checkbox', checked: true });
    const darkMode = el(doc, 'button', { type: 'button', role: 'switch', 'aria-checked': 'true' }, 'Dark mode');
    const outside = el(doc, 'div', { class: 'outside' }, el(doc, 'label', {}, newsletter, ' Send me the newsletter'), darkMode);
    panel.outside = () => newsletter.checked && darkMode.getAttribute('aria-checked') === 'true';
    panel.forbidden.push(outside);
    for (const part of [accept, link, outside]) part.addEventListener('click', (event) => event.preventDefault());

    mount.append(outside, banner);
    // Every click, with its real target (also inside shadow roots).
    mount.addEventListener('click', (event) => panel.clicks.push(event.composedPath()[0]), true);
    return panel;
  }

  // The parent element, stepping out of shadow roots.
  const parentOf = (node) => node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
  const within = (node, list) => {
    for (let at = node; at; at = parentOf(at)) if (list.includes(at)) return true;
    return false;
  };

  // How the panel ended. `saved`: its settings were saved and reported as "optional cookies off".
  //   pass         every switch that is not locked is off, nothing else changed or was clicked
  //   harm         a locked or outside switch changed, a switch was turned on, or a forbidden click
  //   false-saved  saved and reported, with a switch still on
  //   not-saved    a switch is still on, and nothing was saved or reported as saved
  // A "Legitimate Interest" view that was never opened counts as a switch left on.
  function judge(panel, saved) {
    const states = panel.savedWith ?? panel.switches.map((item) => item.get());
    const final = panel.switches.map((item) => item.get());
    const items = panel.switches.map((item, i) => ({ ...item, at: states[i] || final[i] }));
    const leftOn = items.filter((item) => !item.locked && item.at);
    if (panel.legitUnopened) leftOn.push({ label: 'legitimate-interest view/never opened', initial: true, where: 'none' });
    const turnedOn = leftOn.filter((item) => !item.initial);
    const lockedChanged = items.filter((item, i) => item.locked && (states[i] !== item.initial || final[i] !== item.initial));
    const badClicks = panel.clicks.filter((target) => within(target, panel.forbidden) || !within(target, panel.banners))
      .map((target) => (target.textContent || target.tagName).trim().slice(0, 30));
    const harm = turnedOn.length > 0 || lockedChanged.length > 0 || badClicks.length > 0 || !panel.outside();
    const kind = harm ? 'harm' : leftOn.length === 0 ? 'pass' : saved ? 'false-saved' : 'not-saved';
    const blame = harm ? [...turnedOn, ...lockedChanged] : leftOn;
    // The shapes left on (or harmed), each once; without one, the clicks that were wrong.
    const shapes = new Map(blame.map((item) => [item.label.replace(/\/locked.*/, ''),
      item.unreadable ? ' [unreadable]' : item.guess ? ' [guess]' : '']));
    if (kind !== 'pass' && !shapes.size) shapes.set(badClicks.length ? `clicked "${badClicks[0]}"` : 'outside the banner', '');
    return {
      kind, saved,
      shapes: [...shapes].map(([label, tag]) => label + tag).sort(),
      unreadableOnly: blame.length > 0 && blame.every((item) => item.unreadable),
      master: Boolean(panel.spec.master),
      leftOn: leftOn.map((item) => `${item.label}@${item.where}`),
      turnedOn: turnedOn.map((item) => item.label),
      lockedChanged: lockedChanged.map((item) => item.label),
      badClicks,
      states: panel.switches.map((item, i) => `${item.label}=${item.initial ? 1 : 0}>${final[i] ? 1 : 0}`),
    };
  }

  globalThis.RandomPanels = { specFor, build, judge, RENDER_DELAY_MS, VIEW_DRAW_MS, SHAPES };
})();
