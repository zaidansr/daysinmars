(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  const world = get('world');
  const player = get('player');
  const alert = get('alert');
  const actions = get('action-area');
  const interactButton = get('interact');
  const dialog = get('dialog');
  const keyHint = get('key-hint');
  const stationHint = get('station-hint');
  const crewDots = [...document.querySelectorAll('[data-crew-dot]')];
  const dialogBackground = document.querySelectorAll('[data-inert-when-dialog]');
  const stepMs = 150;
  const minuteMs = 8_000;
  const riseMinute = 5;
  const endMinute = 8;
  const workMinutes = 2;
  const travelMinutes = 6;
  const orders = {
    now: { name: 'Head to shelter now', leave: 0, reply: 'Copy. Heading to shelter now.' },
    finish: { name: 'Finish the check, then shelter', leave: workMinutes, reply: 'Copy. Two minutes to finish, then we will head back.' },
  };
  const directions = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };
  const moveKeys = {
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  };
  const stationNames = {
    sun: 'Sun Report', radiation: 'radiation monitor', crew: 'crew console',
    phone: 'hint phone', magnet: 'magnet lab', instructor: 'instructor',
  };
  const watchMessage = 'Fast particles could arrive in 4–8 min.';
  const whyMessage = 'The report gives a range because the arrival time is uncertain. Compare the earliest arrival with how long it takes the crew to reach shelter.';
  const sunSource = 'https://ccmc.gsfc.nasa.gov/tools/DONKI/';
  const marsSource = 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/';
  const settingsKey = 'mars-tower-settings';
  const dots = [[-9, -8], [5, 0], [-9, 8]];

  const makeTile = (x, y) => ({ x, y });
  const readCoordinate = (value, fallback) => value === undefined ? fallback : Number(value);
  const offset = (tile, direction) => makeTile(tile.x + directions[direction].x, tile.y + directions[direction].y);
  const tileId = ({ x, y }) => `${x},${y}`;
  const lerp = (from, to, progress) => from + (to - from) * progress;
  const setText = (element, content) => {
    if (element && element.textContent !== content) element.textContent = content;
  };
  const button = (id, label, className = '') =>
    `<button type="button" data-choice="${id}"${className ? ` class="${className}"` : ''}>${label}</button>`;
  const row = (...buttons) => `<div class="action-row">${buttons.join('')}</div>`;

  const spawn = makeTile(readCoordinate(world.dataset.spawnX, 10), readCoordinate(world.dataset.spawnY, 6));
  const spawnFacing = world.dataset.spawnFacing || 'up';
  const bounds = {
    minX: readCoordinate(world.dataset.minX, 2), maxX: readCoordinate(world.dataset.maxX, 13),
    minY: readCoordinate(world.dataset.minY, 4), maxY: readCoordinate(world.dataset.maxY, 12),
  };
  const stations = new Map();
  const stationTiles = new Map();
  const blocked = new Set();

  // Station and furniture footprints come from the same grid coordinates as the room art.
  for (const prop of world.querySelectorAll('[data-station], [data-block]')) {
    const { station, x, y, width = 1, height = 1 } = prop.dataset;
    if (x === undefined || y === undefined) continue;
    if (station) stations.set(station, prop);
    for (let dy = 0; dy < Number(height); dy++) {
      for (let dx = 0; dx < Number(width); dx++) {
        const id = tileId(makeTile(Number(x) + dx, Number(y) + dy));
        blocked.add(id);
        if (station) stationTiles.set(id, station);
      }
    }
  }

  const settings = { reading: false, assisted: false, guidance: true, sound: false };

  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    for (const key of Object.keys(settings)) {
      if (typeof saved?.[key] === 'boolean') settings[key] = saved[key];
    }
  } catch {
    // Settings still work for this session if storage is unavailable.
  }

  const held = new Map();
  let queuedDirection;
  let tile = spawn;
  let facing = spawnFacing;
  let movement = null;
  let route = [];
  let destination = null;
  let instrument = 'crew';
  let shownActions = '';
  let highlightedStation;
  let radarProgress;
  let briefing = 'orders';
  let selectedOrder = null;
  let elapsed = 0;
  let previousFrame;
  let overlay = null;
  let sourceOrigin = null;
  let restoreFocus = null;
  let hintIndex = 0;
  let audioContext;

  function announce(message) {
    setText(get('announcer'), message);
  }

  function saveSettings() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // Settings remain available in memory.
    }
  }

  function crewState(time = elapsed / minuteMs) {
    const leave = selectedOrder ? orders[selectedOrder].leave : Infinity;
    const arrive = leave + travelMinutes;
    const returning = time >= leave && time < arrive;
    const sheltered = time >= arrive;
    return {
      label: sheltered ? 'In shelter' : returning ? 'Returning' : 'At antenna',
      remaining: sheltered ? 0 : returning ? Math.ceil(arrive - time) : travelMinutes,
      progress: sheltered ? 1 : returning ? (time - leave) / travelMinutes : 0,
      elevated: time >= riseMinute,
      returning,
      sheltered,
    };
  }

  function crewReport(crew) {
    if (crew.sheltered) return 'All three of us are in shelter.';
    if (crew.returning && crew.elevated) return 'The crew is still returning. Shelter will reduce their exposure.';
    if (selectedOrder === 'finish' && crew.returning) return 'Antenna check complete. Heading to shelter.';
    return selectedOrder ? orders[selectedOrder].reply : 'Two minutes to finish the check. Six minutes to shelter. What’s our call?';
  }

  function timingPaused() {
    return Boolean(overlay || document.hidden || (settings.reading && instrument && briefing === 'running'));
  }

  function canWalk(point) {
    return point.x >= bounds.minX && point.x <= bounds.maxX &&
      point.y >= bounds.minY && point.y <= bounds.maxY && !blocked.has(tileId(point));
  }

  function facedStation() {
    return movement ? null : stationTiles.get(tileId(offset(tile, facing)));
  }

  function clearMovement() {
    held.clear();
    queuedDirection = null;
    route = [];
    destination = null;
    movement = null;
  }

  function beginStep(direction) {
    facing = direction;
    const target = offset(tile, direction);
    if (canWalk(target)) movement = { target, time: 0 };
  }

  function planRoute(station) {
    const origin = movement?.target ?? tile;
    const queue = [{ point: origin, trail: [] }];
    const visited = new Set([tileId(origin)]);
    for (const { point, trail } of queue) {
      for (const direction of Object.keys(directions)) {
        const next = offset(point, direction);
        const id = tileId(next);
        if (stationTiles.get(id) === station) return { trail, facing: direction };
        if (!canWalk(next) || visited.has(id)) continue;
        visited.add(id);
        queue.push({ point: next, trail: [...trail, direction] });
      }
    }
    return null;
  }

  function queueStep(direction) {
    queuedDirection = direction;
    route = [];
    destination = null;
  }

  function walk(duration) {
    if (movement) {
      movement.time += duration;
      if (movement.time < stepMs) return;
      tile = movement.target;
      movement = null;
      if (instrument && instrument !== facedStation()) {
        if (actions.contains(document.activeElement)) interactButton.focus();
        instrument = null;
      }
    }
    const direction = queuedDirection ?? Array.from(held.values()).at(-1);
    queuedDirection = null;
    if (direction) beginStep(direction);
    else if (route.length) beginStep(route.shift());
    else if (destination) {
      facing = destination.facing;
      const station = destination.station;
      destination = null;
      openInstrument(station);
    }
  }

  function renderPosition() {
    const progress = movement ? Math.min(movement.time / stepMs, 1) : 0;
    const x = movement ? lerp(tile.x, movement.target.x, progress) : tile.x;
    const y = movement ? lerp(tile.y, movement.target.y, progress) : tile.y;
    const frame = movement ? (progress < 0.5 ? '1' : '2') : '0';
    if (player.dataset.frame !== frame) player.dataset.frame = frame;
    if (player.dataset.facing !== facing) player.dataset.facing = facing;
    if (player.style.getPropertyValue('--x') !== String(x)) player.style.setProperty('--x', x);
    if (player.style.getPropertyValue('--y') !== String(y)) player.style.setProperty('--y', y);
  }

  function renderRoom() {
    renderPosition();
    const nearby = facedStation();
    const guide = settings.guidance && (briefing === 'orders' ? 'crew' :
      briefing === 'running' && tile === spawn ? 'radiation' : '');
    if (highlightedStation !== nearby) {
      if (highlightedStation) stations.get(highlightedStation).dataset.near = 'false';
      if (nearby) stations.get(nearby).dataset.near = 'true';
      highlightedStation = nearby;
      interactButton.setAttribute('aria-disabled', String(!nearby));
    }
    if (world.dataset.guidance !== String(guide || '')) {
      world.dataset.guidance = guide || '';
      for (const [station, prop] of stations) prop.dataset.guide = String(station === guide);
    }
    setText(interactButton, nearby === 'instructor' ? 'Talk to instructor' :
      nearby ? `Use ${stationNames[nearby]}` : 'Use station');
    setText(stationHint, guide === 'radiation' ? 'Walk to Radiation to check the reading.' :
      nearby ? `Facing ${stationNames[nearby]}` : 'Walk up to a station and face it.');
  }

  function renderRadar(crew) {
    if (crew.progress !== radarProgress) {
      radarProgress = crew.progress;
      const x = lerp(365, 80, crew.progress);
      for (const [index, mark] of crewDots.entries()) {
        const [dx, dy] = dots[index];
        mark.setAttribute('transform', `translate(${(x + dx).toFixed(2)} ${53 + dy})`);
      }
    }
    setText(get('crew-status'), crew.label);
    const minutes = `${crew.remaining} ${crew.remaining === 1 ? 'minute' : 'minutes'}`;
    const routeText = crew.sheltered ? 'All three crew members are in shelter.' :
      crew.returning ? `All three crew members are returning. ${minutes} to shelter.` :
        `All three crew members are at the antenna. From there, the walk to shelter takes ${minutes}.`;
    setText(get('radar-location'), routeText);
  }

  function renderTelemetry(crew) {
    const level = crew.elevated ? 'Elevated' : 'Normal';
    setText(get('radiation'), level);
    setText(get('walk'), `${travelMinutes} min`);
    setText(get('clock'), `MIN ${String(Math.floor(elapsed / minuteMs)).padStart(2, '0')} / 08`);
    const quiet = briefing === 'explore' && selectedOrder === null;
    const alertLevel = quiet ? 'quiet' : crew.elevated ? 'elevated' : 'warning';
    if (alert.dataset.level !== alertLevel) alert.dataset.level = alertLevel;
    setText(alert, quiet ? 'Training shift ended.' :
      crew.elevated ? 'Radiation is higher than usual.' : watchMessage);
    const pausedMessage = get('paused-status');
    if (pausedMessage) pausedMessage.hidden = !(timingPaused() && briefing === 'running');
    setText(keyHint, briefing === 'running' && timingPaused() ? 'Paused while you read' :
      briefing === 'orders' && instrument === 'crew' ? '↑ ↓ Select · E Confirm · Esc Back' :
        'Arrows / WASD: move · E: use station');
  }

  function instrumentContent(crew) {
    if (instrument === 'sun') {
      return ['Sun Report', 'Training forecast', 'The Sun sent out fast particles. They could reach Mars in 4–8 training minutes.',
        button('sources', 'NASA sources', 'sub-action')];
    }
    if (instrument === 'radiation') {
      return ['Radiation monitor', crew.elevated ? 'Elevated outside' : 'Normal outside',
        crew.elevated ? 'Radiation is higher than usual. The shelter reduces the crew’s exposure.' :
          'The sensor measures radiation here on Mars. It is at its usual level.'];
    }
    if (instrument === 'crew' && briefing === 'orders') {
      return ['Crew radio', 'Waiting for your call', `“${crewReport(crew)}”`,
        `<div role="group" aria-label="Crew orders" data-order-group>${row(
          button('now', orders.now.name), button('finish', orders.finish.name)
        )}</div><div class="action-footer"><p>The crew will follow your order, then head to shelter.</p>${button('why', 'Why?', 'sub-action')}</div>`];
    }
    if (instrument === 'crew') {
      const info = briefing === 'explore' && !selectedOrder ? 'This shift ended. You can start the scenario again from Pause.' : crewReport(crew);
      return ['Crew radio', crew.label, info,
        selectedOrder && briefing === 'explore' ? button('debrief', 'View debrief', 'sub-action') : ''];
    }
    if (instrument === 'phone') {
      const hints = [
        briefing === 'orders' ? 'Compare the earliest arrival in the warning with the six-minute walk.' :
          'Watch the three dots on the crew radar as they move toward shelter.',
        'The Sun Report gives an early warning. The Radiation Monitor measures what is happening here on Mars.',
        'Shelter reduces the crew’s exposure. More time outside during higher radiation means more exposure.',
      ];
      return ['Hint phone', '', hints[hintIndex],
        hintIndex < hints.length - 1 ? button('hint', 'Another hint', 'sub-action') : ''];
    }
    if (instrument === 'magnet') {
      const available = briefing === 'explore';
      return ['Magnet lab', available ? 'Optional activity' : 'Optional lab · after this shift',
        available ? 'Compare how two particles move through a magnetic field.' : 'Visit again after the shift to test the magnetic field.',
        available ? button('magnet', 'Open lab', 'sub-action') : ''];
    }
    if (instrument === 'instructor') {
      return ['Instructor', '', briefing === 'orders' ? whyMessage :
        'Use the radar to follow the crew, and check the radiation monitor for the outside reading.'];
    }
    if (briefing === 'orders') {
      return ['Crew is waiting', 'Training shift', 'Return to the Crew station to send your order.'];
    }
    if (briefing === 'running') {
      return ['Tower radio', crew.label, crewReport(crew)];
    }
    return ['Explore the tower', '', 'Face a station and use it to see what it does.'];
  }

  function renderInstrument(crew) {
    const [title, kicker, copy, controls = ''] = instrumentContent(crew);
    setText(get('instrument-title'), title);
    const kickerElement = get('instrument-kicker');
    if (kickerElement) kickerElement.hidden = !kicker;
    setText(kickerElement, kicker);
    setText(get('instrument-copy'), copy);
    if (shownActions !== controls) {
      const hadFocus = actions.contains(document.activeElement);
      actions.innerHTML = controls;
      shownActions = controls;
      if (hadFocus) (actions.querySelector('button') ?? get('pause')).focus();
    }
  }

  function render() {
    const crew = crewState();
    renderRoom();
    renderRadar(crew);
    renderTelemetry(crew);
    renderInstrument(crew);
  }

  function showDialog(kind, title, body) {
    if (!overlay) restoreFocus = document.activeElement;
    overlay = kind;
    clearMovement();
    previousFrame = undefined;
    dialog.innerHTML = `<header class="dialog-header"><h2 id="dialog-title" tabindex="-1">${title}</h2>
      <button class="dialog-close" type="button" data-choice="close" aria-label="Back to the tower">×</button></header>
      <div class="dialog-content">${body}</div>`;
    dialog.hidden = false;
    dialog.setAttribute('open', '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialogBackground.forEach((element) => { element.inert = true; });
    get('dialog-title').focus();
    render();
  }

  function closeDialog() {
    if (!overlay) return;
    overlay = null;
    dialog.hidden = true;
    dialog.removeAttribute('open');
    dialogBackground.forEach((element) => { element.inert = false; });
    previousFrame = undefined;
    render();
    const target = restoreFocus?.isConnected ? restoreFocus : get('pause');
    target?.focus({ preventScroll: true });
    restoreFocus = null;
  }

  function showSources() {
    sourceOrigin = overlay;
    showDialog('sources', 'NASA sources', `<p>This training scenario uses fictional timing. In May 2024, the Radiation Assessment Detector (RAD) aboard NASA’s Curiosity rover measured a large rise in radiation during a solar storm.</p>
      <p><a href="${marsSource}" target="_blank" rel="noopener">Read NASA JPL’s report</a></p>
      <p>NASA’s DONKI system records and connects space-weather observations and analyses. The Sun Report uses a fictional warning inspired by that work.</p>
      <p><a href="${sunSource}" target="_blank" rel="noopener">Learn about NASA’s DONKI system</a></p>`);
  }

  function showPause() {
    const shiftOpen = briefing === 'orders' || briefing === 'running';
    showDialog('pause', 'Paused', `<p>Paused while you read.</p>
      ${row(button('close', 'Keep playing'), button(shiftOpen ? 'leave-prompt' : 'replay', shiftOpen ? 'Leave shift' : 'Start a new shift'))}`);
  }

  function showHelp() {
    const controls = Object.keys(settings).map((key) => {
      const labels = {
        reading: 'Reading mode pauses time at an open station',
        assisted: 'Assisted station navigation',
        guidance: 'Show station guides',
        sound: 'Play radiation alert sound',
      };
      return `<label><input type="checkbox" data-setting="${key}"${settings[key] ? ' checked' : ''}> ${labels[key]}</label>`;
    }).join('');
    const shortcuts = settings.assisted ? row(...[...stations.keys()].map(
      (station) => button(`go-${station}`, station === 'instructor' ? 'Instructor' :
        stationNames[station].replace(/^./, (char) => char.toUpperCase()))
    )) : '';
    showDialog('help', 'Help', `<p>Move with the arrow keys, WASD, or the on-screen arrows. Face a station and press E, Space, or Use station. Esc opens Pause.</p>
      <fieldset><legend>Settings</legend>${controls}</fieldset>
      ${shortcuts}<p>${button('sources', 'NASA sources', 'sub-action')}</p>`);
  }

  function showDebrief() {
    const order = orders[selectedOrder];
    const arrive = order.leave + travelMinutes;
    const outside = Math.max(0, arrive - riseMinute);
    const summary = order.leave ? 'The crew finished the antenna check, then returned.' :
      'You called the crew back right away. The antenna check is unfinished.';
    showDialog('debrief', 'Crew sheltered', `<p>Let’s review your call.</p>
      <ol class="timeline"><li><strong>0 min</strong> · ${order.name}</li>
        <li><strong>5 min</strong> · Radiation rose</li>
        <li><strong>${arrive} min</strong> · Crew reached shelter</li></ol>
      <p>${summary} They spent <strong>${outside} ${outside === 1 ? 'minute' : 'minutes'} outside</strong> after radiation rose.</p>
      <p>The warning gave a range. Leaving earlier reduced the time outside during higher radiation.</p>
      ${row(button('replay-other', 'Try the other order'), button('explore', 'Explore the tower'))}
      <p>${button('sources', 'NASA sources', 'sub-action')}</p>`);
  }

  function showMagnet(particle) {
    const charged = particle === 'charged';
    const description = charged ? 'In this example, the charged particle bends in the field.' :
      'The neutral particle keeps going straight in this model.';
    const path = charged ? 'M20 66H92 Q157 66 214 38 L278 14' : 'M20 66H278';
    const chamber = `<svg viewBox="0 0 300 90" width="300" height="90" style="max-width:100%;height:auto" aria-hidden="true">
      <rect x="92" y="8" width="122" height="72" fill="currentColor" opacity=".16"/>
      <text x="153" y="27" text-anchor="middle" fill="currentColor" font-size="12">MAGNETIC FIELD</text>
      ${particle ? `<path d="${path}" stroke="currentColor" stroke-width="3" stroke-dasharray="5 3" fill="none"/>
        <circle cx="278" cy="${charged ? 14 : 66}" r="5" fill="currentColor"/>` : ''}</svg>`;
    showDialog('magnet', 'Magnet lab', `<p>Send a particle across the field, then compare its path with the other particle.</p>
      ${chamber}<p>${particle ? description : 'Which particle will change direction?'}</p>
      ${row(button('charged', 'Send charged particle'), button('neutral', 'Send neutral particle'))}
      <p>Magnetic fields can bend some charged particles’ paths. This model uses a field across the direction of travel.</p>`);
    if (particle) dialog.querySelector(`[data-choice="${particle}"]`).focus();
  }

  function openInstrument(station) {
    if (!station || station !== facedStation()) return;
    instrument = station;
    previousFrame = settings.reading ? undefined : previousFrame;
    render();
    focusInstrument();
  }

  function focusInstrument() {
    const title = get('instrument-title');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }

  function startOrder(order) {
    if (briefing !== 'orders' || instrument !== 'crew' || facedStation() !== 'crew' || overlay) return;
    selectedOrder = order;
    briefing = 'running';
    // Once the order is sent, the radio confirmation remains visible without opening a reading panel.
    instrument = null;
    clearMovement();
    previousFrame = undefined;
    focusInstrument();
    render();
    announce(orders[order].reply);
  }

  function reset(other) {
    if (briefing !== 'debrief' && briefing !== 'explore') return;
    const lastOrder = selectedOrder;
    selectedOrder = null;
    elapsed = 0;
    briefing = 'orders';
    clearMovement();
    tile = spawn;
    facing = spawnFacing;
    instrument = 'crew';
    hintIndex = 0;
    closeDialog();
    setText(get('announcer'), 'Training shift ready. Choose when the crew will return.');
    if (other) {
      const order = lastOrder === 'now' ? 'finish' : 'now';
      actions.querySelector(`[data-choice="${order}"]`)?.focus();
    }
  }

  function explore(leftEarly = false) {
    if (leftEarly) {
      selectedOrder = null;
      elapsed = 0;
    }
    briefing = 'explore';
    instrument = null;
    closeDialog();
    announce(leftEarly ? 'Shift ended. Explore the tower.' : 'Shift complete. Explore the tower.');
  }

  function prepareSound() {
    if (!settings.sound) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audioContext ??= new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch {
      audioContext = null;
    }
  }

  function playAlert() {
    if (!settings.sound || audioContext?.state !== 'running') return;
    const start = audioContext.currentTime;
    const tone = audioContext.createOscillator();
    const volume = audioContext.createGain();
    tone.frequency.value = 440;
    volume.gain.setValueAtTime(0.001, start);
    volume.gain.exponentialRampToValueAtTime(0.07, start + 0.04);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    tone.connect(volume);
    volume.connect(audioContext.destination);
    tone.start(start);
    tone.stop(start + 0.22);
  }

  function advance(duration) {
    const before = elapsed / minuteMs;
    elapsed = Math.min(endMinute * minuteMs, elapsed + duration);
    const after = elapsed / minuteMs;
    const events = [];
    const order = orders[selectedOrder];
    if (order.leave && before < order.leave && after >= order.leave) {
      events.push('Antenna check complete. The crew is heading to shelter.');
    }
    if (before < riseMinute && after >= riseMinute) {
      events.push('Radiation is higher than usual. The crew is still returning. Shelter will reduce their exposure.');
      playAlert();
    }
    if (before < order.leave + travelMinutes && after >= order.leave + travelMinutes) {
      events.push('All three of us are in shelter.');
    }
    if (after === endMinute) {
      briefing = 'debrief';
      showDebrief();
    }
    if (events.length) announce(events.join(' '));
  }

  function frame(now) {
    const duration = previousFrame === undefined ? 0 : Math.max(0, now - previousFrame);
    previousFrame = now;
    if (!document.hidden && !overlay) {
      const mayAdvance = briefing === 'running' && !timingPaused();
      walk(Math.min(duration, stepMs));
      if (mayAdvance) advance(duration);
      render();
    }
    requestAnimationFrame(frame);
  }

  function choose(name) {
    if (name === 'now' || name === 'finish') {
      startOrder(name);
    } else if (name.startsWith('go-') && overlay === 'help' && settings.assisted) {
      const station = name.slice(3);
      const path = planRoute(station);
      closeDialog();
      if (path) {
        route = path.trail;
        destination = { station, facing: path.facing };
      }
    } else if (name === 'close') {
      if (overlay === 'debrief') explore();
      else if (overlay === 'sources' && sourceOrigin === 'debrief') showDebrief();
      else if (overlay === 'sources' && sourceOrigin === 'help') showHelp();
      else closeDialog();
    } else if (name === 'leave-prompt') {
      showDialog('leave', 'Leave this shift?', `<p>The current shift will end. You can still explore the tower.</p>
        ${row(button('close', 'Keep playing'), button('leave', 'Leave'))}`);
    } else if (name === 'leave') explore(true);
    else if (name === 'explore') explore();
    else if (name === 'debrief') showDebrief();
    else if (name === 'replay' || name === 'replay-other') reset(name === 'replay-other');
    else if (name === 'sources') showSources();
    else if (name === 'why') showDialog('why', 'Why a range?', `<p>${whyMessage}</p>${row(button('close', 'Back to the crew'))}`);
    else if (name === 'magnet') showMagnet();
    else if (name === 'charged' || name === 'neutral') showMagnet(name);
    else if (name === 'hint') {
      hintIndex++;
      render();
    }
  }

  function bindActions(container) {
    container.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-choice]')?.dataset.choice;
      if (choice) {
        prepareSound();
        choose(choice);
      }
    });
  }

  function operateStation() {
    if (!overlay) openInstrument(facedStation());
  }

  bindActions(actions);
  bindActions(dialog);
  interactButton.addEventListener('click', operateStation);
  get('pause').addEventListener('click', showPause);
  get('help').addEventListener('click', showHelp);
  dialog.addEventListener('change', (event) => {
    const setting = event.target.dataset.setting;
    if (!setting) return;
    settings[setting] = event.target.checked;
    saveSettings();
    prepareSound();
    if (setting === 'assisted') {
      showHelp();
      dialog.querySelector('[data-setting="assisted"]').focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (key === 'escape' && !event.repeat) {
      event.preventDefault();
      if (overlay) choose('close');
      else showPause();
      return;
    }
    if (overlay) {
      if (key === 'tab') {
        const inputs = [...dialog.querySelectorAll('a[href], button:not([disabled]), input, summary')];
        const index = inputs.indexOf(document.activeElement);
        if (index < 0 || (event.shiftKey ? index === 0 : index === inputs.length - 1)) {
          event.preventDefault();
          inputs.at(event.shiftKey ? -1 : 0)?.focus();
        }
      }
      return;
    }
    const orderGroup = event.target.closest?.('[data-order-group]');
    if (orderGroup) {
      if (key === 'arrowup' || key === 'arrowdown') {
        event.preventDefault();
        const options = [...orderGroup.querySelectorAll('button')];
        options.find((option) => option !== event.target)?.focus();
      } else if (key === 'e' && !event.repeat && event.target instanceof HTMLButtonElement) {
        event.preventDefault();
        event.target.click();
      }
      queuedDirection = null;
      held.clear();
      return;
    }
    const focusedControl = event.target.closest?.('button, a, input, select, textarea, [contenteditable]');
    const direction = moveKeys[key];
    if (direction && !focusedControl) {
      event.preventDefault();
      if (!event.repeat) queueStep(direction);
      held.set(key, direction);
    } else if (!event.repeat && (key === 'e' || (key === ' ' && !focusedControl))) {
      event.preventDefault();
      operateStation();
    }
  });

  document.addEventListener('keyup', (event) => held.delete(event.key.toLowerCase()));
  document.addEventListener('focusin', (event) => {
    if (!event.target.closest?.('button, a, input, select, textarea, [contenteditable]')) return;
    for (const key of held.keys()) {
      if (!key.startsWith('pointer:')) held.delete(key);
    }
  });
  document.addEventListener('visibilitychange', () => {
    previousFrame = undefined;
    if (document.hidden) clearMovement();
  });
  window.addEventListener('blur', () => {
    held.clear();
    queuedDirection = null;
    previousFrame = undefined;
  });
  for (const control of document.querySelectorAll('[data-move]')) {
    const direction = control.dataset.move;
    const pointerKey = (event) => `pointer:${event.pointerId}`;
    control.addEventListener('pointerdown', (event) => {
      if (overlay || event.button !== 0) return;
      event.preventDefault();
      control.setPointerCapture(event.pointerId);
      if (actions.contains(document.activeElement)) document.activeElement.blur();
      queueStep(direction);
      held.set(pointerKey(event), direction);
    });
    control.addEventListener('pointerup', (event) => held.delete(pointerKey(event)));
    control.addEventListener('lostpointercapture', (event) => held.delete(pointerKey(event)));
    control.addEventListener('pointercancel', (event) => {
      held.delete(pointerKey(event));
      if (queuedDirection === direction) queuedDirection = null;
    });
    control.addEventListener('click', (event) => {
      if (event.detail === 0 && !overlay) queueStep(direction);
    });
  }

  dialog.hidden = true;
  render();
  requestAnimationFrame(frame);
})();
