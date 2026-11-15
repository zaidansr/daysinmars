(() => {
  'use strict';

  const select = (selector) => document.querySelector(selector);
  const world = select('#world');
  const player = select('#player');
  const dialog = select('#dialog');
  const title = select('#dialog-title');
  const content = select('#dialog-content');
  const clock = select('#clock');
  const status = select('#status');
  const alert = select('#alert');
  const prompt = select('#prompt');
  const launch = select('[data-action="start"]');
  const keys = new Set();
  const moves = new Map([
    ['w', 'up'], ['a', 'left'], ['s', 'down'], ['d', 'right'],
    ['arrowup', 'up'], ['arrowleft', 'left'], ['arrowdown', 'down'], ['arrowright', 'right'],
  ]);
  const stations = {
    donki: { x: 20, y: 39, name: 'DONKI desk' },
    rad: { x: 48, y: 39, name: 'RAD monitor' },
    crew: { x: 75, y: 39, name: 'crew console' },
    instructor: { x: 22, y: 47, name: 'instructor' },
    phone: { x: 83, y: 55, name: 'hint phone' },
    lab: { x: 68, y: 85, name: 'magnet lab' },
    desk: { x: 35.3, y: 84.5, name: 'shift desk' },
  };
  const lessons = ['donki', 'rad', 'crew'];
  const milestones = { notice: 14, arrival: 38, clear: 82, finish: 145 };
  const travelMinutes = 12;
  const archive = 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/';
  const donkiInfo = 'https://ccmc.gsfc.nasa.gov/tools/DONKI/';
  const initialPrompt = prompt?.textContent;
  const initialPosition = { x: 46.49, y: 57.35 };
  const position = { ...initialPosition };
  const previousRuns = [];
  let destination = null;
  let phase = 'welcome';
  let lesson = 0;
  let hintCount = 0;
  let hintTopic = '';
  let shift = null;
  let audioContext;
  let lastFrame;
  let elapsed = 0;
  let previousNearest;

  for (const [key, station] of Object.entries(stations)) {
    const element = select(`[data-station="${key}"]`);
    if (element?.dataset.x && element?.dataset.y) {
      station.x = Number(element.dataset.x);
      station.y = Number(element.dataset.y);
    }
  }

  function shiftTime(minute) {
    const hour = String(9 + Math.floor(minute / 60)).padStart(2, '0');
    return `${hour}:${String(minute % 60).padStart(2, '0')}`;
  }

  const button = (action, label, primary = false) =>
    `<button type="button" data-choice="${action}"${primary ? ' class="primary"' : ''}>${label}</button>`;
  const actions = (...buttons) => `<div class="action-row">${buttons.join('')}</div>`;
  const feedback = (message) => message ? `<p class="feedback" role="status">${message}</p>` : '';

  function openPanel(heading, body) {
    keys.clear();
    destination = null;
    title.textContent = heading;
    content.innerHTML = body;
    content.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    title.focus({ preventScroll: true });
    updateDisplay();
  }

  function renderPlayer() {
    player.style.left = `${position.x}%`;
    player.style.top = `${position.y}%`;
  }

  function distance(station) {
    return Math.hypot(position.x - station.x, position.y - station.y);
  }

  function nearby() {
    let best = null;
    let range = 9.5;
    for (const [key, station] of Object.entries(stations)) {
      const gap = distance(station);
      if (gap < range) {
        best = key;
        range = gap;
      }
    }
    return best;
  }

  function updateDisplay() {
    const near = nearby();
    if (prompt && (near !== previousNearest || (phase !== 'welcome' && !near))) {
      const verb = near === 'instructor' ? 'TALK' : 'INTERACT';
      const promptText = near ? `PRESS E TO ${verb}` :
        (phase === 'welcome' ? initialPrompt : 'WALK UP TO A STATION');
      if (prompt.textContent !== promptText) prompt.textContent = promptText;
      prompt.dataset.active = near ? 'true' : 'false';
      previousNearest = near;
    }
    if (clock && shift) {
      const time = shiftTime(shift.minute);
      if (clock.textContent !== time) clock.textContent = time;
    }
    if (status && phase !== 'welcome') {
      const statusText = phase === 'solo' ? (dialog.open ? 'PAUSED' : 'SOLO SHIFT') :
        phase === 'complete' ? 'SHIFT COMPLETE' : 'TRAINING';
      if (status.textContent !== statusText) status.textContent = statusText;
    }
    if (launch) {
      const label = phase === 'welcome' ? 'Start training' : phase === 'complete' ? 'View debrief' : 'Talk to instructor';
      if (launch.textContent !== label) launch.textContent = label;
    }
  }

  function prepareAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audioContext ??= new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch {
      audioContext = null;
    }
  }

  function chime() {
    if (audioContext?.state !== 'running') return;
    const start = audioContext.currentTime;
    for (const [index, frequency] of [523, 659, 784].entries()) {
      const sound = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const offset = start + index * 0.15;
      sound.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, offset);
      volume.gain.exponentialRampToValueAtTime(0.12, offset + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001, offset + 0.22);
      sound.connect(volume);
      volume.connect(audioContext.destination);
      sound.start(offset);
      sound.stop(offset + 0.22);
    }
  }

  function showAlert(kind, message, sound = false) {
    if (alert) {
      alert.hidden = false;
      alert.dataset.level = kind;
      alert.dataset.active = 'true';
      alert.textContent = message;
    }
    if (sound) chime();
  }

  function instructor() {
    if (phase === 'solo') {
      openPanel('Instructor', '<p>You have the tower. Check DONKI for reports, RAD for local readings, and CREW to talk to the team. The phone is here if you get stuck.</p>');
      return;
    }
    if (phase === 'complete') {
      debrief();
      return;
    }
    if (phase === 'welcome') {
      openPanel('Meet the instructor', `<p>Welcome to the Mars Radiation Tower. An astronaut team is outside inspecting an antenna. Your job is to watch space weather and help them decide when to work or shelter.</p>
        <p>Walk with <strong>WASD</strong>, the arrow keys, or the on-screen arrows. Press <strong>E</strong> near a station, or tap a station to walk up to it.</p>
        ${actions(button('training', 'Begin practice', true))}`);
      return;
    }
    if (lesson === lessons.length) {
      openPanel('The tower is yours', `<p>You checked a space-weather report, read the local radiation monitor, and practiced sending a crew command. Ready to run the tower on your own?</p>
        <p>The simulation clock runs between panels and pauses whenever you read one. Watch for alerts and check the crew’s location before sending a command.</p>
        ${actions(button('launch', 'Start solo shift', true), button('leave', 'Keep exploring'))}`);
      return;
    }
    const guidance = [
      'First, go to the left console labeled DONKI. Read the practice report and decide what it tells us about Mars.',
      'Next, go to the middle console labeled RAD. Compare the normal reading with the practice reading.',
      'Go to the right console labeled CREW. Check where the team is and send a practice command.',
    ];
    openPanel('Practice with the instructor', `<p>${guidance[lesson]}</p>
      ${actions(button('leave', 'Back to the tower', true))}`);
  }

  function startTraining() {
    phase = 'training';
    instructor();
  }

  function practice(station, message = '') {
    const index = lessons.indexOf(station);
    const headings = ['DONKI practice', 'RAD practice', 'Crew practice'];
    if (lesson < index) {
      openPanel(headings[index], `<p>Visit the ${stations[lessons[lesson]].name} first. The instructor is by the left wall if you need directions.</p>`);
      return;
    }
    const lessonsHtml = [
      `<p class="eyebrow">Practice report</p><p>The Sun released a burst of fast particles. The tower has a heads-up. It could affect Mars later.</p>
      <p><strong>What does this report tell you?</strong></p>`,
      `<p class="eyebrow">Practice readings</p><div class="data-grid"><p>Usual reading <strong>2</strong></p><p>Current reading <strong>12</strong></p></div>
      <p>RAD measures radiation where it is. More radiation recorded each minute means dose can build up faster.</p><p><strong>What changed?</strong></p>`,
      `<p class="eyebrow">Practice crew</p><p>The team is outside at the antenna. RAD shows high radiation. The habitat shelter is a short walk away.</p><p><strong>What command takes the team to shelter?</strong></p>`,
    ];
    const good = ['Check RAD for a local reading', 'Radiation is higher right now', 'Return to shelter'];
    const other = ['The report gives the crew’s dose', 'Radiation stayed the same', 'Continue inspection'];
    const retry = [
      'A report gives us a heads-up. Which instrument could tell us what is happening here now?',
      'Compare 12 with the usual reading of 2. Try again.',
      'Continuing keeps the crew outside. What command moves them to the habitat?',
    ];
    const done = [
      'Right. DONKI can give you a heads-up. Go to RAD to find out what the local instrument measures.',
      'Right. The higher number means radiation is building up faster. Now check the crew console.',
      'Right. The team heads to shelter. Return to the instructor for your handoff.',
    ];
    const result = lesson > index ? done[index] : message === 'retry' ? retry[index] : '';
    openPanel(headings[index], `${lessonsHtml[index]}${feedback(result)}
      ${lesson > index ? actions(button('leave', 'Back to the tower', true)) :
        actions(button(`pass-${station}`, good[index], true), button(`retry-${station}`, other[index]))}
      ${index === 0 ? `<p class="source-note"><a href="${donkiInfo}" target="_blank" rel="noopener">What NASA’s DONKI does ↗</a></p>` : ''}`);
  }

  function log(message) {
    shift.timeline.push({ minute: shift.minute, message });
  }

  function startShift() {
    phase = 'solo';
    hintCount = 0;
    elapsed = 0;
    shift = { minute: 0, dose: 0, inspection: 8, location: 'antenna', travel: 0, waiting: false, timeline: [] };
    log('Solo shift began. The crew was inspecting the antenna.');
    showAlert('quiet', 'MONITORING · No space-weather alert');
    dialog.close();
    updateDisplay();
  }

  function radiation() {
    return shift.minute >= milestones.arrival && shift.minute < milestones.clear;
  }

  function advanceShift() {
    shift.minute++;
    if (shift.minute === milestones.notice) {
      log('A DONKI-style report warned of fast particles from the Sun.');
      showAlert('watch', 'WATCH · New space-weather report at DONKI', true);
    }
    if (shift.minute === milestones.arrival) {
      log('RAD measured a sharp rise in local radiation.');
      showAlert('danger', 'HIGH RADIATION · Check RAD and the crew', true);
    }
    if (shift.minute === milestones.clear) {
      log('RAD returned to its usual level.');
      showAlert('clear', 'RADIATION LOWER · Check whether the crew can resume', true);
    }

    const outside = shift.location !== 'shelter';
    shift.dose += outside ? (radiation() ? 18 : 2) : (radiation() ? 1.5 : 0.3);

    if (shift.travel) {
      shift.travel--;
      if (!shift.travel) {
        shift.location = shift.location === 'going-in' ? 'shelter' : 'antenna';
        log(shift.location === 'shelter' ? 'The crew reached the habitat shelter.' : 'The crew reached the antenna and picked up the inspection.');
      }
    } else if (shift.location === 'antenna' && shift.inspection < 100) {
      shift.inspection = Math.min(100, shift.inspection + 1.7);
      if (shift.inspection === 100) log('The crew finished the antenna inspection.');
    }

    if (shift.minute === milestones.finish) {
      log('The shift ended.');
      previousRuns.push({ inspection: Math.floor(shift.inspection), dose: Math.round(shift.dose) });
      phase = 'complete';
      showAlert('quiet', 'SHIFT COMPLETE · Review your debrief');
      debrief();
    }
    updateDisplay();
  }

  function showDonki() {
    const report = shift.minute >= milestones.notice;
    openPanel('DONKI · Space weather', `<p class="eyebrow">Simulated report</p>
      <p>${report ? 'A burst of fast-moving charged particles left the Sun. It may raise radiation near Mars. Check RAD for the local measurement and consider sending the crew to shelter before the particles arrive.' :
        'No reports for this shift yet. Keep an eye on the alert banner while the crew works.'}</p>
      <details><summary>About the real event</summary><p>On May 20, 2024, a solar storm sent energetic particles to Mars. Curiosity’s RAD instrument measured a sharp rise in radiation. This shift uses that event as a starting point and has its own timing and values.</p>
      <p><a href="${archive}" target="_blank" rel="noopener">Read the NASA JPL event report ↗</a></p></details>`);
  }

  function showRad() {
    const rate = radiation() ? 18 : 2;
    openPanel('RAD · Local radiation', `<p class="eyebrow">Training measurements</p>
      <div class="data-grid"><p>Current outside rate <strong>${rate} µGy/min</strong></p><p>Usual outside rate <strong>2 µGy/min</strong></p></div>
      <p>${radiation() ? 'RAD is measuring more radiation than usual. The longer the crew stays outside, the more dose builds up.' :
        'RAD is measuring the usual level. A crew member outside still receives a small dose each minute.'}</p>
      <details><summary>What’s a dose?</summary><p>Rate tells us how quickly radiation adds up. Dose tells us how much energy from radiation has been left in something over time. A microgray (µGy) is a tiny unit of absorbed dose.</p></details>`);
  }

  function crewConsole(message = '') {
    const { location, inspection, dose, travel, waiting } = shift;
    const locations = {
      antenna: 'Antenna site',
      shelter: 'Habitat shelter',
      'going-in': 'Walking to habitat',
      'going-out': 'Walking to antenna',
    };
    const progress = Math.floor(inspection);
    const crewStatus = travel ? `${travel} sim min left` : location === 'shelter' ?
      (waiting ? 'Sheltered · waiting for your call' : 'Sheltered') : progress === 100 ? 'Inspection finished' : 'Inspecting';
    const path = location === 'antenna' ? 100 : location === 'shelter' ? 0 :
      location === 'going-in' ? (travel / travelMinutes) * 100 : (1 - travel / travelMinutes) * 100;
    const options = location === 'antenna' ?
      (progress < 100 ? actions(button('continue', 'Continue inspection', true), button('shelter', 'Return to shelter')) :
        actions(button('shelter', 'Return to shelter', true))) :
      location === 'shelter' && progress < 100 ?
        actions(button('resume', 'Resume inspection', !radiation()), button('wait', 'Resume later', radiation())) : '';
    openPanel('CREW · Antenna team', `<div class="crew-map" aria-label="Route from the habitat shelter to the antenna site">
      <span>Habitat shelter</span><span>Antenna site</span>
      <div class="crew-route"><b style="left:${path}%" aria-hidden="true"></b></div></div>
      <div class="data-grid"><p>Location <strong>${locations[location]}</strong></p>
      <p>Status <strong>${crewStatus}</strong></p><p>Training dose <strong>${Math.round(dose)} µGy</strong></p>
      <p>Inspection <strong>${progress}%</strong></p></div>
      <p>One-way walk: ${travelMinutes} sim min. The crew keeps its inspection progress when it leaves the antenna.</p>
      ${feedback(message)}${options}`);
  }

  function crewCommand(command) {
    const { location, inspection } = shift;
    if (command === 'continue' && location === 'antenna') {
      if (inspection < 100) {
        log('You told the crew to continue inspecting.');
        crewConsole('Command received. The crew will keep inspecting when you close this panel.');
      }
    } else if (command === 'shelter' && location === 'antenna') {
      shift.location = 'going-in';
      shift.travel = travelMinutes;
      log('You sent the crew toward the habitat shelter.');
      crewConsole('The crew will walk to shelter when you close this panel.');
    } else if (command === 'resume' && location === 'shelter' && inspection < 100) {
      shift.location = 'going-out';
      shift.waiting = false;
      shift.travel = travelMinutes;
      log('You sent the crew back to resume the antenna inspection.');
      crewConsole('The crew will walk to the antenna and start where it left off.');
    } else if (command === 'wait' && location === 'shelter' && !shift.waiting) {
      shift.waiting = true;
      log('You kept the crew in the shelter to resume later.');
      crewConsole('The crew will stay in shelter until you choose Resume inspection.');
    }
  }

  function help(next = false) {
    let hints;
    let topic = phase;
    if (phase === 'welcome') {
      hints = ['Find your instructor.', 'The instructor is the person by the left wall.', 'Walk up to the instructor and press E, or choose Start training.'];
    } else if (phase === 'training') {
      const station = lessons[lesson] || 'instructor';
      topic = station;
      const specifics = {
        donki: 'A report gives a heads-up. Check RAD to see what is happening where you are.',
        rad: 'The reading of 12 is higher than the usual 2.',
        crew: 'Return to shelter is the command that moves the practice crew away from the antenna.',
        instructor: 'Ask the instructor for the handoff. Choose Start solo shift when ready.',
      };
      hints = [`Your next stop is the ${stations[station].name}.`,
        `Walk to the ${stations[station].name} and press E, or tap it.`, specifics[station]];
    } else if (phase === 'complete') {
      hints = ['See how your shift went.', 'Open the shift desk to see your debrief.', 'In the debrief, choose Replay solo shift to try a different plan.'];
    } else if (shift.minute < milestones.notice) {
      topic = 'watch';
      hints = ['Watch for an alert.', 'You can check RAD and crew progress while waiting for a report.', 'When the DONKI alert arrives, read the report and consider how long it takes to reach shelter.'];
    } else if (shift.minute < milestones.clear) {
      topic = `storm-${shift.location}`;
      if (shift.location === 'shelter') {
        hints = ['Watch the radiation reading while the crew is sheltered.', 'Check RAD again after the next global alert.', 'When RAD returns to its usual level, open CREW and select Resume inspection if work remains.'];
      } else if (shift.location === 'going-in') {
        hints = ['Check how far the crew has to go.', 'You can read the remaining walk time in CREW.', 'Close the crew console to let the crew finish walking. Wait for RAD to drop before sending them back.'];
      } else {
        hints = ['Check the instruments and the crew’s location.', 'The crew needs 12 simulated minutes to reach the shelter. Dose builds up while they walk.', 'To reduce time outside during the storm, open CREW and select Return to shelter. Wait for RAD to drop before sending the crew back.'];
      }
    } else {
      topic = 'clear';
      hints = ['Look at the latest RAD reading.', 'If the crew is in shelter, check how much work remains.', 'If there is work left, open CREW and select Resume inspection. The crew keeps the progress it already made.'];
    }
    if (topic !== hintTopic) {
      hintTopic = topic;
      hintCount = 0;
    }
    if (next) hintCount++;
    openPanel('Hint phone', `<p class="eyebrow">Hint ${hintCount + 1}</p><p>${hints[Math.min(hintCount, hints.length - 1)]}</p>
      ${actions(button('hint', 'Another hint', true), button('leave', 'Back to the tower'))}`);
  }

  function lab(particle = 'none') {
    const charged = particle === 'charged';
    const observed = particle !== 'none';
    openPanel('Magnet lab', `<p>Send two particles through a magnetic field and compare their paths.</p>
      <div class="lab-diagram ${particle}" aria-label="${observed ? (charged ? 'The charged particle bends upward in the magnetic field.' : 'The neutral particle passes straight through the field.') : 'A chamber with a magnetic field between its poles.'}">
      <svg viewBox="0 0 320 115" role="presentation"><rect x="100" y="9" width="125" height="96" rx="12" fill="#754eae" opacity=".33"/>
      <text x="162" y="28" text-anchor="middle" fill="currentColor" font-size="11">MAGNETIC FIELD</text>
      ${observed ? `<path d="${charged ? 'M20 78 H100 Q162 78 225 50 L298 18' : 'M20 78 H298'}" fill="none" stroke="#ffd284" stroke-width="4" stroke-dasharray="7 4"/>
      <circle cx="298" cy="${charged ? 18 : 78}" r="6" fill="#fff0ae"/>` : ''}</svg></div>
      ${actions(button('charged', 'Send charged particle', particle !== 'charged'), button('neutral', 'Send neutral particle', particle === 'charged'))}
      ${observed ? feedback(charged ? 'The charged particle bends as it crosses the field.' : 'The neutral particle keeps going straight in this model.') : ''}
      <details><summary>How does this connect to Mars?</summary><p>Magnetic fields can bend the paths of moving charged particles. Other kinds of radiation can still reach the surface, and a small magnet would provide little protection for a crew.</p></details>`);
  }

  function debrief() {
    const current = previousRuns.at(-1);
    const prior = previousRuns.at(-2);
    const doseChange = prior ? current.dose - prior.dose : 0;
    const comparison = prior ? `<p>Previous shift: ${prior.inspection}% inspected, ${prior.dose} µGy dose.
      ${doseChange === 0 ? 'The dose stayed the same.' : `This time the crew absorbed ${Math.abs(doseChange)} µGy ${doseChange < 0 ? 'less' : 'more'}.`}</p>` :
      '<p>Replay the shift to compare a different shelter decision.</p>';
    openPanel('Shift debrief', `<p class="eyebrow">Solo shift ${previousRuns.length}</p>
      <div class="data-grid"><p>Inspection <strong>${current.inspection}%</strong></p><p>Crew training dose <strong>${current.dose} µGy</strong></p></div>
      ${comparison}
      <h3>What happened</h3><ol class="timeline">${shift.timeline.map(({ minute, message }) =>
        `<li><time>${shiftTime(minute)}</time> ${message}</li>`).join('')}</ol>
      <p>This shift compresses time and uses made-up radiation rates. On May 20, 2024, NASA’s Curiosity rover measured a sharp rise in radiation on Mars. <a href="${archive}" target="_blank" rel="noopener">Read about the real storm ↗</a></p>
      ${actions(button('launch', 'Replay solo shift', true), button('lab', 'Visit magnet lab'))}`);
  }

  function desk() {
    if (phase === 'complete') debrief();
    else if (phase === 'solo') {
      openPanel('Shift desk', `<p>Your shift ends at ${shiftTime(milestones.finish)}. Keep an eye on the alert banner and check in with the crew.</p>`);
    } else instructor();
  }

  function interact(station) {
    if (!station) return;
    if (station === 'instructor') instructor();
    else if (station === 'phone') help();
    else if (station === 'lab') lab();
    else if (station === 'desk' || phase === 'complete') desk();
    else if (phase === 'welcome') instructor();
    else if (phase === 'training') practice(station);
    else if (station === 'donki') showDonki();
    else if (station === 'rad') showRad();
    else if (station === 'crew') crewConsole();
  }

  function frame(now) {
    const duration = Math.min((now - (lastFrame ?? now)) / 1000, 0.06);
    lastFrame = now;
    if (!dialog.open) {
      const dx = Number(keys.has('right')) - Number(keys.has('left'));
      const dy = Number(keys.has('down')) - Number(keys.has('up'));
      if (dx || dy) {
        destination = null;
        const diagonal = Math.hypot(dx, dy);
        position.x += (dx / diagonal) * duration * 28;
        position.y += (dy / diagonal) * duration * 26;
      } else if (destination) {
        const target = stations[destination];
        const gap = distance(target);
        if (gap < 1.5) {
          const station = destination;
          destination = null;
          interact(station);
        } else {
          position.x += ((target.x - position.x) / gap) * duration * 34;
          position.y += ((target.y - position.y) / gap) * duration * 32;
        }
      }
      position.x = Math.max(8, Math.min(92, position.x));
      position.y = Math.max(34, Math.min(93, position.y));
      renderPlayer();
      if (phase === 'solo' && !dialog.open) {
        elapsed += duration;
        if (elapsed >= 0.85) {
          elapsed -= 0.85;
          advanceShift();
        }
      }
      updateDisplay();
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', (event) => {
    if (dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (moves.has(key)) {
      event.preventDefault();
      keys.add(moves.get(key));
    } else if (key === 'e' && !event.repeat) {
      prepareAudio();
      interact(nearby());
    }
  });
  document.addEventListener('keyup', (event) => keys.delete(moves.get(event.key.toLowerCase())));
  window.addEventListener('blur', () => keys.clear());
  dialog.addEventListener('close', updateDisplay);
  select('#dialog-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-choice]')?.dataset.choice;
    if (!choice) return;
    if (choice === 'leave') dialog.close();
    else if (choice === 'training') startTraining();
    else if (choice === 'launch') startShift();
    else if (choice === 'hint') help(true);
    else if (choice === 'lab') lab();
    else if (choice === 'charged' || choice === 'neutral') lab(choice);
    else if (choice.startsWith('pass-')) {
      lesson++;
      hintCount = 0;
      practice(choice.slice(5));
    } else if (choice.startsWith('retry-')) practice(choice.slice(6), 'retry');
    else crewCommand(choice);
  });

  document.addEventListener('click', (event) => {
    if (dialog.open) return;
    const target = event.target.closest('[data-station], [data-action]');
    if (!target) return;
    prepareAudio();
    const { station, action } = target.dataset;
    if (station && stations[station] && world.contains(target)) {
      if (distance(stations[station]) <= 9.5) interact(station);
      else destination = station;
    } else if (action === 'interact') {
      const near = nearby();
      if (near) interact(near);
      else if (prompt) prompt.textContent = 'WALK UP TO A STATION';
    } else if (action === 'help') help();
    else if (action === 'lab') lab();
    else if (action === 'start') instructor();
    else if (action === 'debrief') desk();
  });

  for (const control of document.querySelectorAll('[data-move]')) {
    const direction = control.dataset.move;
    control.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      control.setPointerCapture(event.pointerId);
      keys.add(direction);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      control.addEventListener(type, () => keys.delete(direction));
    }
    control.addEventListener('click', (event) => {
      if (event.detail === 0) {
        keys.add(direction);
        setTimeout(() => keys.delete(direction), 100);
      }
    });
  }

  renderPlayer();
  title.tabIndex = -1;
  alert?.setAttribute('role', 'status');
  alert?.setAttribute('aria-live', 'polite');
  updateDisplay();
  requestAnimationFrame(frame);
})();
