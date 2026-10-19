/* Tunvori sitesi: tema seçimi ve sağ kenardaki gitar teli.
   Tema: kayıtlı seçim varsa o, yoksa sistem teması. Tel: çekip bırakınca (ya da odaklanıp
   Enter/Boşluk) titrer, Karplus–Strong ile bir La (A2) çalar ve temayı değiştirir.
   <head> içinde ertelemeden yüklenir ki sayfa yanlış temayla bir an bile görünmesin. */
(function () {
  "use strict";

  var KEY = "tunvori-theme";
  var root = document.documentElement;
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function savedTheme() {
    try {
      var value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (e) {
      return null;
    }
  }

  function saveTheme(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* gizli pencere: seçim bu sayfada kalır */ }
  }

  function applyTheme(value) {
    root.setAttribute("data-theme", value);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", value === "dark" ? "#120e1a" : "#f7f1e7");
  }

  applyTheme(savedTheme() || (systemDark.matches ? "dark" : "light"));
  root.classList.add("js");

  function onSystemChange(event) {
    if (!savedTheme()) applyTheme(event.matches ? "dark" : "light");
  }
  if (systemDark.addEventListener) systemDark.addEventListener("change", onSystemChange);
  else if (systemDark.addListener) systemDark.addListener(onSystemChange);

  // --- Ses: uygulamadaki GuitarSynth.renderStrum ile aynı Karplus–Strong sentezi ---

  var NOTE = { name: "A2", frequency: 110 };
  var SAMPLE_RATE = 22050;
  var audio = null;
  var voice = null;

  function audioContext() {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audio) {
      try { audio = new Context(); } catch (e) { return null; }
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  /**
   * Gürültüyle dolan bir gecikme hattı, ortalama alan geri beslemeyle söner (Karplus–Strong).
   * [strength] 0..1 çekiş gücü: yumuşak çekiş daha koyu tınlar. [position] 0..1 telin neresinden
   * çekildiği: uca yakın çekiş daha parlak, ortaya yakın daha yuvarlak (tarak süzgeci).
   */
  function renderPluck(frequency, strength, position) {
    var frames = Math.round(SAMPLE_RATE * 2.4);
    var output = new Float32Array(frames);
    var period = Math.max(2, Math.round(SAMPLE_RATE / frequency));
    var line = new Float32Array(period);

    var smoothing = 0.35 + 0.6 * strength;
    var level = 0;
    for (var i = 0; i < period; i++) {
      level += smoothing * ((Math.random() * 2 - 1) - level);
      line[i] = level;
    }

    var edge = Math.min(position, 1 - position) / 0.5;
    var shift = Math.max(1, Math.round(period * (0.08 + 0.17 * edge)));
    var source = line.slice();
    var mean = 0;
    for (i = 0; i < period; i++) {
      line[i] = source[i] - source[(i - shift + period) % period];
      mean += line[i] / period;
    }
    for (i = 0; i < period; i++) line[i] -= mean;

    // Yüksek teller daha çabuk söner; kalın teller daha uzun tınlar.
    var damping = Math.min(0.997, Math.max(0.985, 0.996 - frequency / 4000));
    var cursor = 0;
    var peak = 0;
    for (var frame = 0; frame < frames; frame++) {
      var current = line[cursor];
      var next = line[(cursor + 1) % period];
      line[cursor] = damping * 0.5 * (current + next);
      output[frame] = current;
      if (Math.abs(current) > peak) peak = Math.abs(current);
      cursor = (cursor + 1) % period;
    }

    // Seviyeyi eşitle, sonda kısa fade-out ile tık sesini önle.
    var gain = peak > 0 ? 0.9 / peak : 0;
    var fadeFrames = Math.round(SAMPLE_RATE * 0.25);
    for (frame = 0; frame < frames; frame++) {
      var fade = frame >= frames - fadeFrames ? (frames - frame) / fadeFrames : 1;
      output[frame] *= gain * fade;
    }
    return output;
  }

  function playNote(strength, position) {
    var context = audioContext();
    if (!context) return;
    var samples = renderPluck(NOTE.frequency, strength, position);
    var buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    var source = context.createBufferSource();
    source.buffer = buffer;
    var gain = context.createGain();
    gain.gain.value = 0.18 + 0.4 * strength;
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
    voice = { source: source, gain: gain };
  }

  // Titreşen tele dokunmak onu susturur, gerçek telde olduğu gibi.
  function muteNote() {
    if (!voice || !audio) return;
    var now = audio.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.015);
    try { voice.source.stop(now + 0.12); } catch (e) { /* zaten durmuş */ }
    voice = null;
  }

  // --- Tel ---

  var COPY = {
    tr: { toDark: "Gitar telini çal: koyu temaya geç", toLight: "Gitar telini çal: açık temaya geç", hint: "teli çek, bırak" },
    en: { toDark: "Pluck the guitar string: switch to the dark theme", toLight: "Pluck the guitar string: switch to the light theme", hint: "pull the string, let go" }
  };

  var POINTS = 72;              // telin çizildiği nokta sayısı
  var MODES = 24;               // titreşimdeki harmonik sayısı
  var VISIBLE_HZ = 11;          // ekranda görünen titreşim hızı (gerçek 110 Hz göz için çok hızlı)
  var DECAY = 0.65;             // temel harmoniğin sönüm süresi (sn); üst harmonikler daha çabuk söner
  var MAX_PULL = 92;            // sola en fazla çekiş (px)
  var MAX_PUSH = 18;            // sağa en fazla çekiş (px): kenara yakın, az yer var
  var TAP_PULL = -28;           // dokunma ya da klavye ile çalışta tel bu kadar çekilmiş sayılır

  function mount() {
    var copy = (root.lang || "tr").toLowerCase().indexOf("tr") === 0 ? COPY.tr : COPY.en;
    var tel = document.createElement("button");
    tel.type = "button";
    tel.className = "tel";
    tel.innerHTML =
      '<svg aria-hidden="true" focusable="false">' +
      '<path class="ghost"></path><path class="ghost"></path><path class="string"></path>' +
      "</svg>" +
      '<span class="tel-hint" aria-hidden="true">' + copy.hint + "</span>" +
      '<span class="tel-note" aria-hidden="true">' + NOTE.name + " · " + NOTE.frequency + " Hz</span>";
    document.body.appendChild(tel);

    var paths = tel.querySelectorAll("path");
    var ghosts = [paths[0], paths[1]];
    var string = paths[2];
    var note = tel.querySelector(".tel-note");

    var width = 0;
    var height = 0;
    var x = 0;
    var shapes = [];            // harmonik başına telin şekli: sin(nπy/L)
    var held = null;            // çekilirken: { id, startX, y, pull, moved }
    var ringing = null;         // titreşirken: { start, amplitudes }
    var trail = [];
    var frame = 0;
    var shiftTimer = 0;

    function label() {
      var dark = root.getAttribute("data-theme") === "dark";
      var text = dark ? copy.toLight : copy.toDark;
      tel.setAttribute("aria-label", text);
      tel.title = text;
    }

    function measure() {
      width = tel.clientWidth;
      height = tel.clientHeight;
      x = width / 2;
      shapes = [];
      for (var n = 1; n <= MODES; n++) {
        var row = new Float32Array(POINTS);
        for (var k = 0; k < POINTS; k++) row[k] = Math.sin(n * Math.PI * k / (POINTS - 1));
        shapes.push(row);
      }
      if (!held && !ringing) drawStraight();
    }

    function drawStraight() {
      string.setAttribute("d", "M" + x + " 0V" + height);
      ghosts[0].style.opacity = ghosts[1].style.opacity = 0;
      trail = [];
    }

    // Çekilen tel iki düz parçadır: köşe parmağın olduğu yerde.
    function drawHeld() {
      string.setAttribute("d", "M" + x + " 0L" + (x + held.pull).toFixed(2) + " " + held.y.toFixed(2) + "L" + x + " " + height);
    }

    // Üçgen şeklin harmoniklere ayrılışı: b_n = 2h·sin(nπp) / (n²π²·p(1−p)).
    function release(pull, position) {
      var amplitudes = new Float32Array(MODES);
      for (var n = 1; n <= MODES; n++) {
        amplitudes[n - 1] = 2 * pull * Math.sin(n * Math.PI * position) /
          (n * n * Math.PI * Math.PI * position * (1 - position));
      }
      if (reducedMotion.matches) {
        ringing = null;
        drawStraight();
        return;
      }
      ringing = { start: performance.now(), amplitudes: amplitudes };
      if (!frame) frame = requestAnimationFrame(tick);
    }

    function tick(now) {
      frame = 0;
      if (!ringing) return;
      var t = (now - ringing.start) / 1000;
      var weights = new Float32Array(MODES);
      var energy = 0;
      for (var n = 1; n <= MODES; n++) {
        var envelope = ringing.amplitudes[n - 1] * Math.exp(-t * Math.pow(n, 0.85) / DECAY);
        weights[n - 1] = envelope * Math.cos(2 * Math.PI * n * VISIBLE_HZ * t);
        energy += Math.abs(envelope);
      }
      if (energy < 0.15) {
        ringing = null;
        drawStraight();
        return;
      }
      var d = "M" + x + " 0";
      for (var k = 1; k < POINTS - 1; k++) {
        var offset = 0;
        for (n = 0; n < MODES; n++) offset += weights[n] * shapes[n][k];
        d += "L" + (x + offset).toFixed(2) + " " + (k * height / (POINTS - 1)).toFixed(1);
      }
      d += "L" + x + " " + height;
      string.setAttribute("d", d);

      // Göz hızlı titreşen teli bulanık görür: son iki kareyi soluk iz olarak bırak.
      trail.unshift(d);
      if (trail.length > 3) trail.length = 3;
      for (var i = 0; i < 2; i++) {
        var past = trail[i + 1];
        ghosts[i].setAttribute("d", past || d);
        ghosts[i].style.opacity = past ? (i === 0 ? 0.28 : 0.12) : 0;
      }
      frame = requestAnimationFrame(tick);
    }

    function showNote(y) {
      note.style.top = y + "px";
      note.classList.remove("is-on");
      void note.offsetWidth;
      note.classList.add("is-on");
    }

    function toggleTheme() {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      if (!reducedMotion.matches) {
        root.classList.add("theme-shift");
        clearTimeout(shiftTimer);
        shiftTimer = setTimeout(function () { root.classList.remove("theme-shift"); }, 650);
      }
      applyTheme(next);
      saveTheme(next);
      tel.classList.add("is-known");
      label();
    }

    function pluck(pull, y) {
      var position = Math.min(0.96, Math.max(0.04, y / height));
      var strength = Math.min(1, Math.abs(pull) / MAX_PULL);
      release(pull, position);
      playNote(Math.max(0.3, strength), position);
      showNote(y);
      toggleTheme();
    }

    // Yumuşak sınır: çektikçe tel sertleşir, belli bir noktadan öteye gitmez.
    function resist(dx) {
      var limit = dx < 0 ? MAX_PULL : MAX_PUSH;
      return limit * Math.tanh(dx / limit);
    }

    function clampY(clientY) {
      var top = tel.getBoundingClientRect().top;
      return Math.min(height - 8, Math.max(8, clientY - top));
    }

    tel.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || held) return;
      held = { id: event.pointerId, startX: event.clientX, y: clampY(event.clientY), pull: 0, moved: false };
      try { tel.setPointerCapture(event.pointerId); } catch (e) { /* eski tarayıcı */ }
      tel.classList.add("is-held");
      ringing = null;
      drawStraight();
      muteNote();
      audioContext(); // ses bağlamı kullanıcı hareketi içinde açılmalı (tarayıcı kuralı)
      drawHeld();
    });

    tel.addEventListener("pointermove", function (event) {
      if (!held || event.pointerId !== held.id) return;
      var dx = event.clientX - held.startX;
      if (Math.abs(dx) > 4) held.moved = true;
      held.pull = resist(dx);
      held.y = clampY(event.clientY);
      drawHeld();
    });

    function letGo(event, play) {
      if (!held || event.pointerId !== held.id) return;
      var pull = held.moved ? held.pull : TAP_PULL;
      var y = held.y;
      held = null;
      tel.classList.remove("is-held");
      if (play && Math.abs(pull) >= 6) {
        pluck(pull, y);
      } else {
        release(pull, Math.min(0.96, Math.max(0.04, y / height)));
      }
    }

    tel.addEventListener("pointerup", function (event) { letGo(event, true); });
    // Kaydırma başlarsa tarayıcı çekişi iptal eder: tel sessizce yerine döner.
    tel.addEventListener("pointercancel", function (event) { letGo(event, false); });

    // Klavye (Enter/Boşluk) ve ekran okuyucu etkinleştirmesi: detail 0 olan tıklama.
    tel.addEventListener("click", function (event) {
      if (event.detail !== 0) return;
      muteNote();
      pluck(TAP_PULL, height / 2);
    });

    window.addEventListener("resize", measure);
    if (savedTheme()) tel.classList.add("is-known");
    label();
    measure();

    // İlk ziyarette tel bir kez hafifçe kıpırdar: dokunulabilir olduğunu sessizce gösterir.
    if (!savedTheme() && !reducedMotion.matches) {
      setTimeout(function () {
        if (!held && !ringing) release(-9, 0.42);
      }, 1200);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
