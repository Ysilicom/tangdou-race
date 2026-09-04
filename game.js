(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const titleOverlay = document.getElementById("title-overlay");
  const winOverlay = document.getElementById("win-overlay");
  const hud = document.getElementById("hud");
  const timerEl = document.getElementById("timer");
  const cpLabel = document.getElementById("checkpoint-label");
  const winTimeEl = document.getElementById("win-time");
  const howtoPanel = document.getElementById("howto-panel");
  const mobileControls = document.getElementById("mobile-controls");
  const joyBase = document.getElementById("joy-base");
  const joyKnob = document.getElementById("joy-knob");
  const jumpBtn = document.getElementById("jump-btn");

  const GRAVITY = -28;
  const MOVE_SPEED = 11;
  const AIR_CONTROL = 0.65;
  const JUMP_V = 11.5;
  const PLAYER_R = 0.55;
  const FRICTION = 0.86;
  const BOT_COUNT = 6;

  let renderer, scene, camera, clock;
  let player, playerVel, onGround, facing;
  let bots = [];
  let solids = [];
  let hazards = [];
  let movingPlatforms = [];
  let hexTiles = [];
  let checkpoints = [];
  let currentCheckpoint = 0;
  let finishZ = 100;
  let playing = false;
  let won = false;
  let startTime = 0;
  let elapsed = 0;
  let keys = {};
  let joy = { x: 0, z: 0 };
  let jumpPressed = false;
  let jumpQueued = false;
  let camTarget = new THREE.Vector3();
  let finishGroup = null;

  const PASTELS = [0xff8fab, 0x84d2f6, 0xc3f584, 0xffd56b, 0xd4a5ff, 0xffb347, 0x7af0c5];

  function isTouchDevice() {
    return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  }

  function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x87ceeb, 1);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xb8e0f0, 40, 140);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 8, -10);

    const hemi = new THREE.HemisphereLight(0xfff0f8, 0x88bb88, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff5e6, 0.85);
    sun.position.set(-20, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    scene.add(sun);

    const amb = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(amb);

    clock = new THREE.Clock();
    window.addEventListener("resize", onResize);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function makeMat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.45,
      metalness: opts.metalness ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
  }

  function addSolidBox(w, h, d, x, y, z, color, receive = true) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, makeMat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    const solid = {
      mesh,
      type: "box",
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      top: y + h / 2,
      moving: false,
    };
    solids.push(solid);
    return solid;
  }

  function refreshSolidBounds(solid) {
    const p = solid.mesh.position;
    const s = solid.mesh.scale;
    const geo = solid.mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const hx = ((bb.max.x - bb.min.x) / 2) * s.x;
    const hy = ((bb.max.y - bb.min.y) / 2) * s.y;
    const hz = ((bb.max.z - bb.min.z) / 2) * s.z;
    solid.min.set(p.x - hx, p.y - hy, p.z - hz);
    solid.max.set(p.x + hx, p.y + hy, p.z + hz);
    solid.top = p.y + hy;
  }

  function makeBean(color, scale = 1, cute = false) {
    const g = new THREE.Group();
    const bodyColor = cute ? 0xffb7d5 : color;
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.55 * scale, 28, 22),
      makeMat(bodyColor, { roughness: 0.28 })
    );
    body.scale.set(cute ? 1.05 : 1, cute ? 1.22 : 1.15, cute ? 0.92 : 0.95);
    body.castShadow = true;
    g.add(body);

    if (cute) {
      const belly = new THREE.Mesh(
        new THREE.SphereGeometry(0.32 * scale, 16, 12),
        makeMat(0xffe6f2, { roughness: 0.55 })
      );
      belly.position.set(0, -0.08 * scale, 0.28 * scale);
      belly.scale.set(1.1, 0.9, 0.55);
      g.add(belly);
    }

    const eyeGeo = new THREE.SphereGeometry((cute ? 0.14 : 0.1) * scale, 14, 12);
    const eyeMat = makeMat(0xffffff);
    const pupilMat = makeMat(cute ? 0x5b3a6b : 0x222233);
    const eyeY = (cute ? 0.22 : 0.18) * scale;
    const eyeZ = (cute ? 0.4 : 0.42) * scale;
    [-0.2, 0.2].forEach((ox) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ox * scale, eyeY, eyeZ);
      eye.scale.set(cute ? 1.05 : 1, cute ? 1.15 : 1, 1);
      g.add(eye);
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry((cute ? 0.065 : 0.05) * scale, 10, 10),
        pupilMat
      );
      pupil.position.set(ox * scale, eyeY + (cute ? 0.01 : 0) * scale, eyeZ + 0.08 * scale);
      g.add(pupil);
      if (cute) {
        const shine = new THREE.Mesh(
          new THREE.SphereGeometry(0.028 * scale, 8, 8),
          makeMat(0xffffff, { roughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.35 })
        );
        shine.position.set(ox * scale - 0.03 * scale, eyeY + 0.04 * scale, eyeZ + 0.12 * scale);
        g.add(shine);
        const lash = new THREE.Mesh(
          new THREE.BoxGeometry(0.09 * scale, 0.018 * scale, 0.02 * scale),
          makeMat(0x5b3a6b)
        );
        lash.position.set(ox * scale, eyeY + 0.12 * scale, eyeZ + 0.02 * scale);
        lash.rotation.z = ox > 0 ? -0.25 : 0.25;
        g.add(lash);
      }
    });

    if (cute) {
      [-0.32, 0.32].forEach((ox) => {
        const blush = new THREE.Mesh(
          new THREE.SphereGeometry(0.08 * scale, 10, 8),
          makeMat(0xff8fb8, { roughness: 0.7, emissive: 0xff6b9d, emissiveIntensity: 0.15 })
        );
        blush.position.set(ox * scale, 0.02 * scale, 0.4 * scale);
        blush.scale.set(1.2, 0.7, 0.4);
        g.add(blush);
      });
    }

    const smile = new THREE.Mesh(
      new THREE.TorusGeometry((cute ? 0.11 : 0.14) * scale, (cute ? 0.025 : 0.03) * scale, 8, 16, Math.PI),
      makeMat(0xff6b8a)
    );
    smile.position.set(0, (cute ? -0.08 : -0.05) * scale, (cute ? 0.46 : 0.48) * scale);
    smile.rotation.x = Math.PI;
    g.add(smile);

    if (cute) {
      const tuft = new THREE.Mesh(
        new THREE.SphereGeometry(0.2 * scale, 12, 10),
        makeMat(0xff9ec8, { roughness: 0.4 })
      );
      tuft.position.set(0, 0.62 * scale, -0.05 * scale);
      tuft.scale.set(1.1, 0.85, 0.9);
      g.add(tuft);
      const bowL = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 * scale, 10, 8),
        makeMat(0xff5fa2, { roughness: 0.35 })
      );
      bowL.position.set(-0.14 * scale, 0.72 * scale, 0.05 * scale);
      bowL.scale.set(1.3, 0.7, 0.5);
      g.add(bowL);
      const bowR = bowL.clone();
      bowR.position.x = 0.14 * scale;
      g.add(bowR);
      const knot = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 * scale, 8, 8),
        makeMat(0xff3d8a)
      );
      knot.position.set(0, 0.72 * scale, 0.08 * scale);
      g.add(knot);
    }

    const legGeo = (THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(0.12 * scale, 0.18 * scale, 4, 8)
      : new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, 0.35 * scale, 8));
    [-0.22, 0.22].forEach((ox) => {
      const leg = new THREE.Mesh(legGeo, makeMat(bodyColor));
      leg.position.set(ox * scale, -0.55 * scale, 0);
      leg.castShadow = true;
      g.add(leg);
    });

    g.userData.body = body;
    return g;
  }

  function buildCourse() {
    solids = [];
    hazards = [];
    movingPlatforms = [];
    hexTiles = [];
    checkpoints = [];

    // Sky blobs / clouds
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(2 + Math.random() * 2, 12, 10),
        makeMat(0xffffff, { roughness: 1 })
      );
      c.position.set((Math.random() - 0.5) * 80, 14 + Math.random() * 8, Math.random() * 110);
      c.scale.set(1.6, 0.7, 1);
      scene.add(c);
    }

    // Section 1: Start platform (z 0..18)
    addSolidBox(16, 1.2, 20, 0, -0.6, 8, 0xffc2e0);
    addSolidBox(14, 0.4, 2, 0, 0.2, 0, 0xff9ecd); // start stripe
    checkpoints.push({ z: 2, y: 1.2, x: 0, name: "起点" });

    // Decorative start arches
    [[-6, 0], [6, 0]].forEach(([x]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 4, 12), makeMat(0xff7eb3));
      p.position.set(x, 2, 2);
      p.castShadow = true;
      scene.add(p);
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 0.3), makeMat(0xffffff));
    banner.position.set(0, 4.2, 2);
    scene.add(banner);

    // Section 2: Spinning bars (z 20..40)
    addSolidBox(12, 1.0, 22, 0, -0.5, 30, 0xa8e6ff);
    checkpoints.push({ z: 20, y: 1.0, x: 0, name: "旋转棒" });

    for (let i = 0; i < 4; i++) {
      const z = 24 + i * 4.5;
      const bar = new THREE.Group();
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 11, 12),
        makeMat(0xff6b6b, { metalness: 0.3, roughness: 0.35 })
      );
      rod.rotation.z = Math.PI / 2;
      rod.castShadow = true;
      bar.add(rod);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 12), makeMat(0xffd93d));
      hub.position.y = -0.2;
      bar.add(hub);
      bar.position.set(0, 1.35, z);
      scene.add(bar);
      hazards.push({
        type: "spinner",
        mesh: bar,
        speed: (i % 2 === 0 ? 1.4 : -1.6) * (1 + i * 0.08),
        length: 5.5,
        radius: 0.45,
        knock: 16,
      });
    }

    // Section 3: Narrow bridge + pendulums (z 42..62)
    addSolidBox(3.2, 1.0, 22, 0, -0.5, 52, 0xd4f5a5);
    // side safety lips (thin)
    addSolidBox(0.35, 0.5, 22, -1.75, 0.25, 52, 0x9fd36a);
    addSolidBox(0.35, 0.5, 22, 1.75, 0.25, 52, 0x9fd36a);
    checkpoints.push({ z: 42, y: 1.0, x: 0, name: "吊锤桥" });

    for (let i = 0; i < 4; i++) {
      const z = 46 + i * 4.2;
      const pivot = new THREE.Group();
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8),
        makeMat(0x888899, { metalness: 0.4 })
      );
      arm.position.y = -2.25;
      pivot.add(arm);
      const hammer = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 16, 12),
        makeMat(0xff8c42, { roughness: 0.4 })
      );
      hammer.position.y = -4.5;
      hammer.castShadow = true;
      pivot.add(hammer);
      pivot.position.set(0, 6.5, z);
      scene.add(pivot);
      hazards.push({
        type: "pendulum",
        mesh: pivot,
        phase: i * 0.9,
        amp: 0.95,
        speed: 1.5 + i * 0.1,
        hammer,
        knock: 18,
      });
    }

    // Section 4: Moving platforms + hex tiles (z 64..88)
    checkpoints.push({ z: 64, y: 1.2, x: 0, name: "移动平台" });
    // gap then platforms
    addSolidBox(8, 1.0, 6, 0, -0.5, 66, 0xffe0a3);

    for (let i = 0; i < 5; i++) {
      const w = 3.2;
      const plat = addSolidBox(w, 0.7, 3.0, (i % 2 === 0 ? -2.5 : 2.5), 0.2, 72 + i * 3.2, 0xffb347);
      plat.moving = true;
      plat.baseX = plat.mesh.position.x;
      plat.amp = 3.2;
      plat.speed = 1.1 + i * 0.15;
      plat.phase = i * 0.7;
      movingPlatforms.push(plat);
    }

    // Hex falling tiles zone
    const hexZ0 = 88;
    addSolidBox(10, 1.0, 4, 0, -0.5, 86, 0xe0c3fc);
    const hexR = 1.05;
    const hexH = 0.45;
    const hexShape = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      hexShape.push(new THREE.Vector2(Math.cos(a) * hexR, Math.sin(a) * hexR));
    }
    const hexGeo = new THREE.ExtrudeGeometry(new THREE.Shape(hexShape), {
      depth: hexH,
      bevelEnabled: false,
    });
    hexGeo.rotateX(-Math.PI / 2);

    let idx = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = -2; col <= 2; col++) {
        const x = col * (hexR * 1.75) + (row % 2) * hexR * 0.88;
        const z = hexZ0 + row * (hexR * 1.55);
        const mesh = new THREE.Mesh(
          hexGeo,
          makeMat(PASTELS[idx % PASTELS.length], { roughness: 0.5 })
        );
        mesh.position.set(x, 0.0, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const solid = {
          mesh,
          type: "hex",
          min: new THREE.Vector3(),
          max: new THREE.Vector3(),
          top: hexH,
          moving: false,
          hex: true,
        };
        refreshSolidBounds(solid);
        // approximate bounds for hex
        solid.min.set(x - hexR, 0, z - hexR);
        solid.max.set(x + hexR, hexH, z + hexR);
        solid.top = hexH;
        solids.push(solid);
        hexTiles.push({
          solid,
          mesh,
          state: "idle", // idle | warn | falling | gone
          timer: 0,
          baseY: 0,
          triggered: false,
        });
        idx++;
      }
    }

    // Section 5: Finish (z 98..108)
    finishZ = 102;
    addSolidBox(14, 1.4, 14, 0, -0.7, 104, 0xfff3b0);
    checkpoints.push({ z: 96, y: 1.2, x: 0, name: "终点冲刺" });

    // Crown / finish
    finishGroup = new THREE.Group();
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.2, 24), makeMat(0xffd700, { metalness: 0.45, roughness: 0.3 }));
    podium.position.y = 0.7;
    podium.castShadow = true;
    finishGroup.add(podium);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 5), makeMat(0xffeb3b, { emissive: 0xffaa00, emissiveIntensity: 0.25 }));
    crown.position.y = 2.2;
    finishGroup.add(crown);
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), makeMat(0xff4081, { emissive: 0xff4081, emissiveIntensity: 0.4 }));
    jewel.position.y = 2.9;
    finishGroup.add(jewel);
    finishGroup.position.set(0, 0.7, finishZ);
    scene.add(finishGroup);

    // Finish arches
    [-5, 5].forEach((x) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 6, 12), makeMat(0xff6bcb));
      col.position.set(x, 3, 98);
      col.castShadow = true;
      scene.add(col);
    });
    const finBanner = new THREE.Mesh(new THREE.BoxGeometry(10, 1.4, 0.35), makeMat(0xffffff, { emissive: 0xffc0e0, emissiveIntensity: 0.2 }));
    finBanner.position.set(0, 6.2, 98);
    scene.add(finBanner);

    // Soft ground void color cue
    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 250),
      new THREE.MeshBasicMaterial({ color: 0x6ec6ff, transparent: true, opacity: 0.35 })
    );
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.y = -8;
    voidPlane.position.z = 55;
    scene.add(voidPlane);
  }

  function spawnPlayer() {
    if (player) scene.remove(player);
    player = makeBean(0xffb7d5, 1, true);
    player.position.set(0, 1.5, 2);
    scene.add(player);
    playerVel = new THREE.Vector3(0, 0, 0);
    onGround = false;
    facing = 0;
    currentCheckpoint = 0;
  }

  function spawnBots() {
    bots.forEach((b) => scene.remove(b.mesh));
    bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const color = PASTELS[(i + 1) % PASTELS.length];
      const mesh = makeBean(color, 0.92);
      const x = (i - (BOT_COUNT - 1) / 2) * 1.6;
      mesh.position.set(x, 1.5, 3 + Math.random() * 2);
      scene.add(mesh);
      bots.push({
        mesh,
        vel: new THREE.Vector3(0, 0, 0),
        onGround: false,
        targetZ: 20 + Math.random() * 10,
        wander: (Math.random() - 0.5) * 2,
        jumpCd: Math.random() * 2,
        alive: true,
        color,
      });
    }
  }

  function resetGame() {
    // clear scene contents except lights/fog handled by rebuilding
    while (scene.children.length) scene.remove(scene.children[0]);
    // re-add lights
    const hemi = new THREE.HemisphereLight(0xfff0f8, 0x88bb88, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff5e6, 0.85);
    sun.position.set(-20, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    buildCourse();
    spawnPlayer();
    spawnBots();
    won = false;
    playing = true;
    startTime = performance.now();
    elapsed = 0;
    cpLabel.textContent = checkpoints[0].name;
    winOverlay.classList.add("hidden");
    titleOverlay.classList.add("hidden");
    hud.classList.remove("hidden");
    if (isTouchDevice()) mobileControls.classList.add("visible");
  }

  function respawnAtCheckpoint(who) {
    const cp = checkpoints[Math.min(currentCheckpoint, checkpoints.length - 1)];
    who.position.set(cp.x + (Math.random() - 0.5) * 0.5, cp.y + 0.8, cp.z);
    return new THREE.Vector3(0, 0, 0);
  }

  function getSupport(pos, radius) {
    let best = null;
    let bestTop = -Infinity;
    for (const s of solids) {
      if (s.hexGone) continue;
      if (pos.x + radius < s.min.x || pos.x - radius > s.max.x) continue;
      if (pos.z + radius < s.min.z || pos.z - radius > s.max.z) continue;
      const top = s.top;
      if (pos.y >= top - 0.85 && pos.y <= top + 0.55 && top > bestTop) {
        bestTop = top;
        best = s;
      }
    }
    return best ? { solid: best, top: bestTop } : null;
  }

  function resolveHorizontal(pos, radius) {
    for (const s of solids) {
      if (s.hexGone) continue;
      // only block if roughly body-overlapping in Y
      if (pos.y + radius < s.min.y + 0.1 || pos.y - radius * 0.2 > s.max.y) continue;
      const cx = Math.max(s.min.x, Math.min(pos.x, s.max.x));
      const cz = Math.max(s.min.z, Math.min(pos.z, s.max.z));
      // if center is inside xz footprint and not clearly on top
      if (pos.x > s.min.x && pos.x < s.max.x && pos.z > s.min.z && pos.z < s.max.z) {
        if (pos.y < s.top - 0.05) {
          // push out to nearest face
          const dl = pos.x - s.min.x;
          const dr = s.max.x - pos.x;
          const df = pos.z - s.min.z;
          const db = s.max.z - pos.z;
          const m = Math.min(dl, dr, df, db);
          if (m === dl) pos.x = s.min.x - radius * 0.2;
          else if (m === dr) pos.x = s.max.x + radius * 0.2;
          else if (m === df) pos.z = s.min.z - radius * 0.2;
          else pos.z = s.max.z + radius * 0.2;
        }
      }
    }
  }

  function applyHazards(pos, vel, radius, isPlayer) {
    for (const h of hazards) {
      if (h.type === "spinner") {
        // rod along local X after rotation around Y
        const ang = h.mesh.rotation.y;
        const hx = h.mesh.position.x;
        const hz = h.mesh.position.z;
        const hy = h.mesh.position.y;
        // closest point on rotating segment
        const dirx = Math.cos(ang);
        const dirz = -Math.sin(ang);
        const wx = pos.x - hx;
        const wz = pos.z - hz;
        let t = wx * dirx + wz * dirz;
        t = Math.max(-h.length, Math.min(h.length, t));
        const cx = hx + dirx * t;
        const cz = hz + dirz * t;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const dy = pos.y - hy;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < h.radius + radius && Math.abs(dy) < 1.1) {
          const nx = dist > 1e-4 ? dx / dist : dirz;
          const nz = dist > 1e-4 ? dz / dist : -dirx;
          // tangential knock from spin
          const tx = -dirz * Math.sign(h.speed);
          const tz = dirx * Math.sign(h.speed);
          vel.x += (nx * 0.4 + tx) * h.knock * 0.08;
          vel.z += (nz * 0.4 + tz) * h.knock * 0.08;
          vel.y = Math.max(vel.y, 4);
          pos.x += nx * 0.15;
          pos.z += nz * 0.15;
        }
      } else if (h.type === "pendulum") {
        h.hammer.updateWorldMatrix(true, false);
        const wp = new THREE.Vector3();
        h.hammer.getWorldPosition(wp);
        const dx = pos.x - wp.x;
        const dy = pos.y - wp.y;
        const dz = pos.z - wp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.85 + radius) {
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          const nz = dz / (dist || 1);
          vel.x += nx * h.knock * 0.12;
          vel.y += Math.max(2, ny * h.knock * 0.08);
          vel.z += nz * h.knock * 0.12;
          pos.x += nx * 0.2;
          pos.z += nz * 0.2;
        }
      }
    }
  }

  function triggerHex(tile) {
    if (tile.state !== "idle") return;
    tile.state = "warn";
    tile.timer = 0.55;
    tile.mesh.material = makeMat(0xff5555, { emissive: 0xff2222, emissiveIntensity: 0.35 });
  }

  function updateHexTiles(dt) {
    for (const tile of hexTiles) {
      if (tile.state === "idle") continue;
      tile.timer -= dt;
      if (tile.state === "warn" && tile.timer <= 0) {
        tile.state = "falling";
        tile.timer = 1.2;
        tile.solid.hexGone = true;
      } else if (tile.state === "falling") {
        tile.mesh.position.y -= 8 * dt;
        tile.mesh.rotation.z += dt * 2;
        tile.mesh.material.opacity = Math.max(0, tile.timer);
        tile.mesh.material.transparent = true;
        if (tile.timer <= 0) {
          tile.state = "gone";
          tile.mesh.visible = false;
        }
      }
    }
  }

  function updateMoving(dt, t) {
    for (const p of movingPlatforms) {
      p.mesh.position.x = p.baseX + Math.sin(t * p.speed + p.phase) * p.amp;
      refreshSolidBounds(p);
      // keep approximate
      const w = 3.2, h = 0.7, d = 3.0;
      const x = p.mesh.position.x, y = p.mesh.position.y, z = p.mesh.position.z;
      p.min.set(x - w / 2, y - h / 2, z - d / 2);
      p.max.set(x + w / 2, y + h / 2, z + d / 2);
      p.top = y + h / 2;
    }
  }

  function updateHazardsMotion(t) {
    for (const h of hazards) {
      if (h.type === "spinner") {
        // clock-based spin
        h.mesh.rotation.y = t * h.speed;
      } else if (h.type === "pendulum") {
        h.mesh.rotation.z = Math.sin(t * h.speed + h.phase) * h.amp;
      }
    }
    if (finishGroup) finishGroup.rotation.y = t * 0.8;
  }

  function integrateBean(mesh, vel, inputX, inputZ, wantJump, dt, isPlayer) {
    let grounded = false;
    const speedMul = grounded ? 1 : AIR_CONTROL;

    // We'll compute ground after vertical move; first apply input
    const targetVx = inputX * MOVE_SPEED;
    const targetVz = inputZ * MOVE_SPEED;
    const accel = onGroundFor(mesh) ? 1 : AIR_CONTROL;
    // use previous frame ground via mesh.userData
    const wasGround = !!mesh.userData.onGround;
    const a = wasGround ? 1 : AIR_CONTROL;
    vel.x += (targetVx - vel.x) * Math.min(1, 12 * a * dt);
    vel.z += (targetVz - vel.z) * Math.min(1, 12 * a * dt);

    if (wasGround) {
      vel.x *= Math.pow(FRICTION, dt * 60);
      vel.z *= Math.pow(FRICTION, dt * 60);
    }

    vel.y += GRAVITY * dt;

    if (wantJump && wasGround) {
      vel.y = JUMP_V;
      mesh.userData.onGround = false;
    }

    mesh.position.x += vel.x * dt;
    mesh.position.z += vel.z * dt;
    resolveHorizontal(mesh.position, PLAYER_R);

    mesh.position.y += vel.y * dt;

    const support = getSupport(mesh.position, PLAYER_R);
    if (support && vel.y <= 0) {
      mesh.position.y = support.top + PLAYER_R * 0.95;
      vel.y = 0;
      grounded = true;
      if (support.solid.hex && isPlayer) {
        const tile = hexTiles.find((t) => t.solid === support.solid);
        if (tile) triggerHex(tile);
      }
      // carry moving platforms
      if (support.solid.moving) {
        const p = support.solid;
        const nx = p.baseX + Math.sin((performance.now() / 1000) * p.speed + p.phase) * p.amp;
        // approximate carry via position sync already in updateMoving next frame
      }
    }
    mesh.userData.onGround = grounded;

    applyHazards(mesh.position, vel, PLAYER_R, isPlayer);

    // squash stretch
    const body = mesh.userData.body;
    if (body) {
      const squash = grounded ? 1 - Math.min(0.15, Math.abs(vel.y) * 0.01) : 1 + Math.min(0.2, Math.abs(vel.y) * 0.015);
      body.scale.set(1 / Math.sqrt(squash), squash * 1.15, 1 / Math.sqrt(squash));
    }

    // face move dir
    if (Math.abs(inputX) + Math.abs(inputZ) > 0.1) {
      mesh.rotation.y = Math.atan2(inputX, inputZ);
    }

    return grounded;
  }

  function onGroundFor(mesh) {
    return !!mesh.userData.onGround;
  }

  function updatePlayer(dt) {
    let ix = 0, iz = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) iz += 1;
    if (keys["KeyS"] || keys["ArrowDown"]) iz -= 1;
    // chase cam looks along +Z, so screen-right is world -X
    if (keys["KeyA"] || keys["ArrowLeft"]) ix += 1;
    if (keys["KeyD"] || keys["ArrowRight"]) ix -= 1;
    ix += joy.x;
    iz += joy.z;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }

    const wantJump = jumpQueued || keys["Space"] || jumpPressed;
    jumpQueued = false;

    integrateBean(player, playerVel, ix, iz, wantJump, dt, true);

    // checkpoints
    for (let i = currentCheckpoint + 1; i < checkpoints.length; i++) {
      if (player.position.z >= checkpoints[i].z - 1) {
        currentCheckpoint = i;
        cpLabel.textContent = checkpoints[i].name;
      }
    }

    if (player.position.y < -5) {
      playerVel.set(0, 0, 0);
      const cp = checkpoints[currentCheckpoint];
      player.position.set(cp.x, cp.y + 1, cp.z);
      player.userData.onGround = false;
    }

    if (player.position.z >= finishZ - 1.5 && player.position.y > 0.5 && !won) {
      doWin();
    }
  }

  function updateBots(dt, t) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      // simple AI: push forward with wander, jump occasionally
      bot.jumpCd -= dt;
      const targetX = Math.sin(t * 0.7 + bot.wander) * 2.5 + bot.wander;
      let ix = (targetX - bot.mesh.position.x) * 0.35;
      let iz = 0.85 + Math.sin(t + bot.wander) * 0.15;
      // avoid edges roughly on bridge
      if (bot.mesh.position.z > 42 && bot.mesh.position.z < 62) {
        ix += -bot.mesh.position.x * 0.5;
        iz = 0.7;
      }
      const len = Math.hypot(ix, iz) || 1;
      ix = (ix / len) * 0.9;
      iz = (iz / len) * 0.9;

      let wantJump = false;
      if (bot.jumpCd <= 0 && bot.mesh.userData.onGround) {
        if (Math.random() < 0.35) wantJump = true;
        bot.jumpCd = 0.8 + Math.random() * 1.8;
      }

      integrateBean(bot.mesh, bot.vel, ix, iz, wantJump, dt, false);

      if (bot.mesh.position.y < -5) {
        // respawn near player checkpoint vibe
        const cp = checkpoints[Math.min(currentCheckpoint, checkpoints.length - 1)];
        bot.mesh.position.set(cp.x + (Math.random() - 0.5) * 3, cp.y + 1, cp.z - 1);
        bot.vel.set(0, 0, 0);
      }
    }
  }

  function updateCamera(dt) {
    const ideal = new THREE.Vector3(
      player.position.x * 0.35,
      player.position.y + 6.5,
      player.position.z - 11
    );
    camera.position.lerp(ideal, 1 - Math.pow(0.001, dt));
    camTarget.lerp(
      new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z + 4),
      1 - Math.pow(0.0008, dt)
    );
    camera.lookAt(camTarget);
  }

  function doWin() {
    won = true;
    playing = false;
    elapsed = (performance.now() - startTime) / 1000;
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    const cs = Math.floor((elapsed % 1) * 100);
    winTimeEl.textContent = `用时 ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
    winOverlay.classList.remove("hidden");
    mobileControls.classList.remove("visible");
  }

  function updateTimer() {
    if (!playing) return;
    elapsed = (performance.now() - startTime) / 1000;
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    timerEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (playing && !won) {
      updateMoving(dt, t);
      updateHazardsMotion(t);
      updateHexTiles(dt);
      updatePlayer(dt);
      updateBots(dt, t);
      updateTimer();
    } else {
      updateHazardsMotion(t);
    }
    if (player) updateCamera(dt);
    renderer.render(scene, camera);
  }

  // Input
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space") {
      e.preventDefault();
      jumpQueued = true;
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  // Joystick
  let joyActive = false;
  let joyId = null;
  function joyPos(clientX, clientY) {
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.38;
    const mag = Math.hypot(dx, dy);
    if (mag > max) { dx = (dx / mag) * max; dy = (dy / mag) * max; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    joy.x = -dx / max; // screen-right → world -X (chase cam along +Z)
    joy.z = -dy / max;
  }
  function joyEnd() {
    joyActive = false;
    joyId = null;
    joy.x = 0; joy.z = 0;
    joyKnob.style.transform = "translate(-50%, -50%)";
  }
  joyBase.addEventListener("pointerdown", (e) => {
    joyActive = true; joyId = e.pointerId; joyBase.setPointerCapture(e.pointerId);
    joyPos(e.clientX, e.clientY);
  });
  joyBase.addEventListener("pointermove", (e) => {
    if (!joyActive || e.pointerId !== joyId) return;
    joyPos(e.clientX, e.clientY);
  });
  joyBase.addEventListener("pointerup", joyEnd);
  joyBase.addEventListener("pointercancel", joyEnd);

  jumpBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    jumpPressed = true;
    jumpQueued = true;
  });
  jumpBtn.addEventListener("pointerup", () => { jumpPressed = false; });
  jumpBtn.addEventListener("pointercancel", () => { jumpPressed = false; });

  document.getElementById("btn-start").addEventListener("click", () => resetGame());
  document.getElementById("btn-replay").addEventListener("click", () => resetGame());
  document.getElementById("btn-howto").addEventListener("click", () => {
    howtoPanel.style.display = howtoPanel.style.display === "none" ? "block" : "none";
  });

  // Boot
  initThree();
  buildCourse();
  spawnPlayer();
  spawnBots();
  // Idle camera preview
  playing = false;
  requestAnimationFrame(tick);
  // gently animate title scene
  setInterval(() => {
    if (!playing && player) {
      const t = clock.elapsedTime;
      updateHazardsMotion(t);
      updateMoving(0.016, t);
    }
  }, 30);
})();
