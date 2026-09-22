import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/* ------------------------------------------------------------------ *
 * SIPI — maquete arquitetônica compartilhada
 * Modelo geométrico, materiais, iluminação, enquadramentos e estados.
 * Usado pela cena do hero e pela demonstração de seis etapas.
 * ------------------------------------------------------------------ */

const PAL = {
  concrete: 0xD7D9D6,
  concreteDark: 0xBFC3C1,
  masonry: 0xC4BFB6,
  graphite: 0x2B3134,
  steel: 0x848C90,
  orange: 0xFF7900,
  ground: 0xF1F0EC
};

// planta ilustrativa: 12 x 8, pé-direito 2.8, laje 0.20
const W = 12, D = 8, H = 2.8, T = 0.15, SLAB = 0.2;
const PIECES = [
  { id: 'L01', x0: 8, z0: 4, x1: 12, z1: 8 },
  { id: 'L02', x0: 4, z0: 4, x1: 8,  z1: 8 },
  { id: 'L03', x0: 0, z0: 4, x1: 4,  z1: 8 },
  { id: 'L04', x0: 8, z0: 0, x1: 12, z1: 4 },
  { id: 'L05', x0: 4, z0: 0, x1: 8,  z1: 4 },
  { id: 'L06', x0: 0, z0: 0, x1: 4,  z1: 4 }
];
const TRACKED = 0; // L01 — painel acompanhado do projeto à montagem
const ORDER = [0, 1, 2, 3, 4, 5]; // sequência de produção e montagem: L01 → L06

/* ---------------------------- texturas ---------------------------- */
let _mas, _con;
function masonryTexture() {
  if (_mas) return _mas;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#C8C3BA'; g.fillRect(0, 0, 256, 256);
  const ch = 32, bw = 64;
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * (bw / 2);
    g.strokeStyle = 'rgba(52,54,52,0.34)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, r * ch); g.lineTo(256, r * ch); g.stroke();
    for (let b = -1; b < 5; b++) {
      const x = b * bw + off;
      g.beginPath(); g.moveTo(x, r * ch); g.lineTo(x, r * ch + ch); g.stroke();
    }
    g.fillStyle = r % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)';
    g.fillRect(0, r * ch + 2, 256, ch - 4);
  }
  _mas = new THREE.CanvasTexture(c);
  _mas.wrapS = _mas.wrapT = THREE.RepeatWrapping;
  _mas.anisotropy = 4;
  return _mas;
}
function concreteTexture() {
  if (_con) return _con;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#DBDDDA'; g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  _con = new THREE.CanvasTexture(c);
  _con.wrapS = _con.wrapT = THREE.RepeatWrapping;
  return _con;
}

/* --------------------------- materiais ---------------------------- */
function materials() {
  const mas = new THREE.MeshStandardMaterial({ color: PAL.masonry, roughness: 0.95, metalness: 0, map: masonryTexture() });
  const con = new THREE.MeshStandardMaterial({ color: PAL.concrete, roughness: 0.88, metalness: 0, map: concreteTexture() });
  return {
    masonry: mas,
    masonryPlain: new THREE.MeshStandardMaterial({ color: 0xB9B4AB, roughness: 0.95, metalness: 0 }),
    concrete: con,
    concreteDark: new THREE.MeshStandardMaterial({ color: PAL.concreteDark, roughness: 0.9, metalness: 0 }),
    piece: new THREE.MeshStandardMaterial({ color: PAL.concrete, roughness: 0.85, metalness: 0, map: concreteTexture() }),
    steel: new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.55, metalness: 0.65 }),
    graphite: new THREE.MeshStandardMaterial({ color: PAL.graphite, roughness: 0.7, metalness: 0.3 }),
    orange: new THREE.MeshStandardMaterial({ color: PAL.orange, roughness: 0.65, metalness: 0.05 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x4A5154, roughness: 0.6, metalness: 0.4 }),
    ghost: new THREE.LineBasicMaterial({ color: 0x6E7679, transparent: true, opacity: 0.35 }),
    edge: new THREE.LineBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0.9 })
  };
}

/* ------------------------- construção base ------------------------ */
function boxAt(mats, m, x0, y0, z0, x1, y1, z1, repeatScale) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = new THREE.BoxGeometry(w, h, d);
  let mm = m;
  if (m.map && repeatScale !== false) {
    mm = m.clone();
    mm.map = m.map.clone();
    mm.map.needsUpdate = true;
    mm.map.wrapS = mm.map.wrapT = THREE.RepeatWrapping;
    mm.map.repeat.set(Math.max(w, d) / 1.6, h / 1.2);
  }
  const mesh = new THREE.Mesh(g, mm);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Parede com aberturas. axis 'x' ou 'z'; c = coordenada transversal (centro)
function addWall(group, mats, axis, a0, a1, c, y0, h, openings) {
  const list = (openings || []).slice().sort((p, q) => p.at - q.at);
  let cursor = a0;
  const solid = (s, e, yy0, yy1) => {
    if (e - s < 0.02 || yy1 - yy0 < 0.02) return;
    const m = axis === 'x'
      ? boxAt(mats, mats.masonry, s, yy0, c - T / 2, e, yy1, c + T / 2)
      : boxAt(mats, mats.masonry, c - T / 2, yy0, s, c + T / 2, yy1, e);
    group.add(m);
  };
  for (const o of list) {
    const s = o.at - o.w / 2, e = o.at + o.w / 2;
    solid(cursor, s, y0, y0 + h);
    if (o.sill > 0) solid(s, e, y0, y0 + o.sill);
    if (o.head < h) solid(s, e, y0 + o.head, y0 + h);
    cursor = e;
  }
  solid(cursor, a1, y0, y0 + h);
}

const WIN = (at) => ({ at, w: 1.3, sill: 1.0, head: 2.2 });
const DOOR = (at) => ({ at, w: 0.85, sill: 0, head: 2.1 });

// Um pavimento de alvenaria estrutural. cutFront: recorte didático na fachada z=D
function storey(mats, y0, cutFront) {
  const g = new THREE.Group();
  // fachada norte (z=0)
  addWall(g, mats, 'x', 0, W, 0, y0, H, [WIN(2), WIN(5), WIN(7), WIN(10)]);
  // fachada oeste (x=0)
  addWall(g, mats, 'z', 0, D, 0, y0, H, [WIN(2.2), WIN(5.8)]);
  // fachada leste (x=12)
  addWall(g, mats, 'z', 0, D, W, y0, H, [WIN(2.2), WIN(5.8)]);
  // fachada sul (z=8) — parte recortada para leitura do interior
  if (cutFront) {
    addWall(g, mats, 'x', 0, 6, D, y0, 1.1, []);
    addWall(g, mats, 'x', 6, W, D, y0, H, [WIN(8), WIN(10.6)]);
  } else {
    addWall(g, mats, 'x', 0, W, D, y0, H, [WIN(2), WIN(4), WIN(8), WIN(10.6)]);
  }
  // parede de geminação
  addWall(g, mats, 'z', 0, D, 6, y0, H, []);
  // divisórias internas
  addWall(g, mats, 'x', 0, 6, 4.6, y0, H, [DOOR(1.6), DOOR(4.4)]);
  addWall(g, mats, 'x', 6, W, 4.6, y0, H, [DOOR(7.6), DOOR(10.4)]);
  addWall(g, mats, 'z', 4.6, D, 3, y0, H, [DOOR(6.6)]);
  addWall(g, mats, 'z', 4.6, D, 9, y0, H, [DOOR(6.6)]);
  return g;
}

function slabSheet(mats, y) {
  const m = boxAt(mats, mats.concreteDark, -0.1, y - SLAB, -0.1, W + 0.1, y, D + 0.1, false);
  return m;
}

/* ----------------------------- peças ------------------------------ */
function makePiece(mats, spec, withElectrical) {
  const g = new THREE.Group();
  g.userData.id = spec.id;
  const w = spec.x1 - spec.x0 - 0.11, d = spec.z1 - spec.z0 - 0.11;
  const mat = mats.piece.clone();
  g.userData.mat = mat;
  g.userData.size = { w, d };
  const add = (bw, bd, cx, cz) => {
    const mm = new THREE.Mesh(new THREE.BoxGeometry(bw, SLAB, bd), mat);
    mm.position.set(cx, 0, cz);
    mm.castShadow = true; mm.receiveShadow = true;
    g.add(mm); return mm;
  };
  if (!withElectrical) {
    add(w, d, 0, 0);
  } else {
    add(w, d / 2, 0, d / 4);
    add(w / 2, d / 2, w / 4, -d / 4);
    // fundo do entalhe
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w / 2, SLAB * 0.28, d / 2), mat);
    floor.position.set(-w / 4, -SLAB * 0.36, -d / 4);
    floor.receiveShadow = true;
    g.add(floor);
    // conduítes e caixa elétrica dentro do entalhe
    const cav = new THREE.Group();
    const boxEl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 20), mats.orange);
    boxEl.position.set(-w / 4, -SLAB * 0.14, -d / 4);
    boxEl.castShadow = true;
    cav.add(boxEl);
    const target = new THREE.Vector3(-w / 4, -SLAB * 0.16, -d / 4);
    const entries = [
      [new THREE.Vector3(-w / 2 + 0.02, -SLAB * 0.16, -d / 4 + 0.5), new THREE.Vector3(-w / 4 - 0.7, -SLAB * 0.16, -d / 4 + 0.5)],
      [new THREE.Vector3(-w / 4 + 0.6, -SLAB * 0.16, -d / 2 + 0.02), new THREE.Vector3(-w / 4 + 0.6, -SLAB * 0.16, -d / 4 - 0.55)],
      [new THREE.Vector3(-w / 2 + 0.02, -SLAB * 0.16, -d / 4 - 0.85), new THREE.Vector3(-w / 4 - 0.55, -SLAB * 0.16, -d / 4 - 0.85)]
    ];
    for (const [a, b] of entries) {
      const curve = new THREE.CatmullRomCurve3([a, b, target.clone()], false, 'catmullrom', 0.2);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.036, 8, false), mats.orange);
      tube.castShadow = true;
      cav.add(tube);
    }
    g.add(cav);
    g.userData.cavity = cav;
    // bloco removível que fecha o entalhe
    const cut = new THREE.Mesh(new THREE.BoxGeometry(w / 2, SLAB, d / 2), mat);
    cut.position.set(-w / 4, 0, -d / 4);
    cut.castShadow = true; cut.receiveShadow = true;
    g.add(cut);
    g.userData.cut = cut;
  }
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, SLAB, d)),
    new THREE.LineBasicMaterial({ color: 0x79817F, transparent: true, opacity: 0.8 })
  );
  g.add(edges);
  g.userData.edges = edges;
  return g;
}

function pieceHome(spec) {
  return new THREE.Vector3((spec.x0 + spec.x1) / 2, 0, (spec.z0 + spec.z1) / 2);
}

/* --------------------------- escoramento -------------------------- */
function makeShoring(mats, y0, yTop) {
  const g = new THREE.Group();
  const pts = [];
  for (let x = 1.5; x <= W - 1; x += 2.2) for (let z = 1.4; z <= D - 1; z += 2.1) pts.push([x, z]);
  const hgt = yTop - y0 - 0.16;
  const shaft = new THREE.CylinderGeometry(0.045, 0.045, hgt, 10);
  const base = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12);
  const head = new THREE.BoxGeometry(0.34, 0.05, 0.34);
  const props = [];
  for (const [x, z] of pts) {
    const p = new THREE.Group();
    const s = new THREE.Mesh(shaft, mats.steel); s.position.y = hgt / 2 + 0.04; s.castShadow = true;
    const b = new THREE.Mesh(base, mats.graphite); b.position.y = 0.02; b.receiveShadow = true;
    const h = new THREE.Mesh(head, mats.steel); h.position.y = hgt + 0.07; h.castShadow = true;
    p.add(s, b, h);
    p.position.set(x, y0, z);
    p.scale.y = 1;
    g.add(p);
    props.push(p);
  }
  // longarinas ilustrativas
  for (let z = 1.4; z <= D - 1; z += 2.1) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W - 2.4, 0.07, 0.11), mats.steel);
    beam.position.set(W / 2, y0 + hgt + 0.11, z);
    beam.castShadow = true;
    g.add(beam);
    props.push(beam);
  }
  g.userData.props = props;
  return g;
}

/* ------------- eixos e cotas: leitura de projeto (etapa 01) --------- */
function makeAxes() {
  const g = new THREE.Group();
  const mt = new THREE.MeshBasicMaterial({ color: 0x6E7679, transparent: true, opacity: 0 });
  g.userData.mt = mt;
  const bar = (sx, sz, cx, cz) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.012, sz), mt);
    b.position.set(cx, 0.02, cz);
    g.add(b);
  };
  for (const x of [0, 4, 8, 12]) { for (let z = -1.2; z < D + 1.2; z += 0.62) bar(0.045, 0.34, x, z); }
  for (const z of [0, 4, 8]) { for (let x = -1.2; x < W + 1.2; x += 0.62) bar(0.34, 0.045, x, z); }
  for (const x of [0, 4, 8, 12]) bar(0.5, 0.05, x, -1.9);
  bar(W + 1, 0.05, W / 2, -1.9);
  for (const z of [0, 4, 8]) bar(0.05, 0.5, -1.9, z);
  bar(0.05, D + 1, -1.9, D / 2);
  return g;
}

/* --------- disciplinas integradas na compatibilização (etapa 02) ---- */
function makeDisciplines(mats) {
  const g = new THREE.Group();
  const elec = new THREE.MeshBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0 });
  const hyd = new THREE.MeshStandardMaterial({ color: 0x8C949A, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0 });
  g.userData.elec = elec; g.userData.hyd = hyd;
  const route = [[9.6, 4.0], [9.6, 5.6], [6.4, 5.6], [6.4, 2.2], [2.4, 2.2], [2.4, 5.4]];
  for (let i = 0; i < route.length - 1; i++) {
    const [x0, z0] = route[i], [x1, z1] = route[i + 1];
    const b = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.07, 0.05, Math.abs(z1 - z0) + 0.07), elec);
    b.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    g.add(b);
  }
  for (const [x, z] of route) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 18), elec);
    c.position.set(x, 0.07, z);
    g.add(c);
  }
  for (const [x, z] of [[2.4, 5.4], [6.4, 2.2], [10.6, 6.6]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, H, 12), hyd);
    r.position.set(x, H / 2, z);
    g.add(r);
  }
  return g;
}

/* --------- pontos de interface elétrica no topo da alvenaria -------- */
function makeWallStubs(mats, y) {
  const g = new THREE.Group();
  const pts = [[9.6, 4.0], [11.4, 6.2], [8.2, 6.9], [6.0, 5.4]];
  for (const [x, z] of pts) {
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.34, 8), mats.orange);
    stub.position.set(x, y + 0.17, z);
    stub.castShadow = true;
    g.add(stub);
  }
  g.userData.pts = pts;
  return g;
}

/* ------------------------------ grua ------------------------------ */
function makeCrane(mats) {
  const g = new THREE.Group();
  const jib = new THREE.Group();
  const len = 22;
  const chordGeo = new THREE.CylinderGeometry(0.07, 0.07, len, 8);
  for (const off of [[-0.35, 0], [0.35, 0], [0, 0.6]]) {
    const c = new THREE.Mesh(chordGeo, mats.graphite);
    c.rotation.z = Math.PI / 2;
    c.position.set(0, off[1], off[0]);
    jib.add(c);
  }
  for (let i = -len / 2; i < len / 2; i += 1.1) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), mats.graphite);
    br.position.set(i, 0.3, 0);
    br.rotation.x = Math.PI / 2.6;
    jib.add(br);
  }
  jib.position.set(6, 7.6, 2.2);
  g.add(jib);

  const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.5), mats.graphite);
  g.add(trolley);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), mats.cable);
  g.add(cable);
  const hook = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.24), mats.graphite);
  const hk = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16, Math.PI * 1.4), mats.steel);
  hk.position.y = -0.24; hk.rotation.x = Math.PI / 2;
  hook.add(block, hk);
  g.add(hook);
  const spreader = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), mats.steel);
  g.add(spreader);

  const slings = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), mats.cable);
    g.add(s); slings.push(s);
  }
  g.userData = { jib, trolley, cable, hook, spreader, slings, jibY: 7.6 };
  return g;
}

function alignCylinder(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) { mesh.visible = false; return; }
  mesh.visible = true;
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
}

/* ---------------------------- caminhão ---------------------------- */
function makeTruck(mats) {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 4.4), mats.graphite);
  bed.position.set(0, 1.15, 0); bed.castShadow = true; bed.receiveShadow = true;
  g.add(bed);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.34, 1.4), mats.graphite);
  chassis.position.set(-0.6, 0.84, 0); g.add(chassis);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.4, 3.1), mats.steel);
  cab.position.set(-8.4, 2.3, 0); cab.castShadow = true; g.add(cab);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 2.7), mats.graphite);
  wind.position.set(-9.82, 2.8, 0); g.add(wind);
  const wheel = new THREE.CylinderGeometry(0.72, 0.72, 0.5, 20);
  for (const x of [-7.9, 4.2, 5.8]) for (const z of [-1.9, 1.9]) {
    const wm = new THREE.Mesh(wheel, mats.graphite);
    wm.rotation.x = Math.PI / 2;
    wm.position.set(x, 0.72, z); wm.castShadow = true;
    g.add(wm);
  }
  for (const x of [-5.4, -1.2, 3, 6.4]) for (const z of [-2.3, 2.3]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), mats.steel);
    st.position.set(x, 2.05, z); st.castShadow = true; g.add(st);
  }
  return g;
}

/* -------------------- iluminação e apresentação ------------------- */
function lightRig(scene, dark) {
  const hemi = new THREE.HemisphereLight(0xffffff, dark ? 0x1B2022 : 0xCFCFC8, dark ? 1.15 : 1.0);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, dark ? 2.0 : 2.1);
  key.position.set(14, 18, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  const s = 16;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 1; key.shadow.camera.far = 70;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, dark ? 0.75 : 0.6);
  fill.position.set(-12, 8, -9);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, dark ? 0.5 : 0.3);
  rim.position.set(-4, 6, 16);
  scene.add(rim);
  return { hemi, key, fill, rim };
}

function shadowGround(y, dark) {
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.2 })
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = y;
  g.receiveShadow = true;
  return g;
}

/* ---------------------------- utilidades -------------------------- */
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeInOut = (v) => { v = clamp01(v); return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; };
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const seg = (v, a, b) => clamp01((v - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

function applyCamera(cam, f, aspect) {
  const el = f.elev * Math.PI / 180, az = f.azim * Math.PI / 180;
  const r = 60;
  cam.position.set(
    f.tx + r * Math.cos(el) * Math.sin(az),
    f.ty + r * Math.sin(el),
    f.tz + r * Math.cos(el) * Math.cos(az)
  );
  cam.lookAt(f.tx, f.ty, f.tz);
  const h = f.size, w = h * aspect;
  cam.left = -w; cam.right = w; cam.top = h; cam.bottom = -h;
  cam.near = 1; cam.far = 160;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}
function track(u, keys) {
  for (let i = 0; i < keys.length - 1; i++) {
    if (u <= keys[i + 1][0] || i === keys.length - 2) {
      return blendFrames(keys[i][1], keys[i + 1][1], easeInOut(seg(u, keys[i][0], keys[i + 1][0])));
    }
  }
  return keys[0][1];
}
function blendFrames(a, b, t) {
  return {
    tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), tz: lerp(a.tz, b.tz, t),
    azim: lerp(a.azim, b.azim, t), elev: lerp(a.elev, b.elev, t), size: lerp(a.size, b.size, t)
  };
}

/* =================================================================== *
 * Base comum dos dois elementos
 * =================================================================== */
class SceneElement extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.style.display = 'block';
    this.style.position = 'relative';
    this.style.width = '100%';
    this.style.height = '100%';
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { this.fail(e); return; }
    if (!this.renderer || !this.renderer.getContext()) { this.fail(new Error('sem WebGL')); return; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const cv = this.renderer.domElement;
    cv.style.display = 'block'; cv.style.width = '100%'; cv.style.height = '100%';
    this.appendChild(cv);
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.appendChild(this.overlay);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 160);
    this.mats = materials();
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.build();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this);
    this.resize();
    [80, 400, 1200].forEach((d) => setTimeout(() => { if (this.syncSize()) this.requestDraw(); }, d));
    this.dispatchEvent(new CustomEvent('sipi-ready', { bubbles: true }));
  }
  fail(e) {
    this.dataset.failed = '1';
    this.dispatchEvent(new CustomEvent('sipi-failed', { bubbles: true, detail: String(e && e.message) }));
  }
  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.scene) this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss(); }
    this._init = false;
  }
  resize() {
    if (!this.renderer) return;
    const w = this.clientWidth || 640, h = this.clientHeight || 420;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.narrow = w < 560;
    this.requestDraw();
  }
  syncSize() {
    if (!this.renderer) return false;
    const w = this.clientWidth || 640, h = this.clientHeight || 420;
    if (w === this._w && h === this._h) return false;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.narrow = w < 560;
    return true;
  }
  requestDraw() {
    if (this._pending || this._raf) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.draw(); });
  }
  label(key, text, tone) {
    if (!this._labels) this._labels = {};
    if (this._labels[key]) return this._labels[key];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;transform:translate(-50%,-50%);font:600 13px Inter,system-ui,sans-serif;' +
      'padding:5px 9px;border-radius:5px;white-space:nowrap;opacity:0;transition:opacity 260ms ease;' +
      (tone === 'accent'
        ? 'background:#FF7900;color:#111415;'
        : 'background:rgba(255,255,255,0.94);color:#111415;border:1px solid #D8DCDE;');
    wrap.textContent = text;
    this.overlay.appendChild(wrap);
    this._labels[key] = wrap;
    return wrap;
  }
  placeLabel(key, text, world, opacity, tone, dx, dy) {
    const el = this.label(key, text, tone);
    el.textContent = text;
    const v = world.clone().project(this.camera);
    const w = this.clientWidth, h = this.clientHeight;
    const ax = (v.x * 0.5 + 0.5) * w, ay = (-v.y * 0.5 + 0.5) * h;
    let lx = ax + (dx || 0), ly = ay + (dy || 0);
    const halfW = (el.offsetWidth || 90) / 2 + 6, halfH = (el.offsetHeight || 26) / 2 + 6;
    lx = Math.min(Math.max(lx, halfW), w - halfW);
    ly = Math.min(Math.max(ly, halfH), h - halfH);
    el.style.left = lx + 'px';
    el.style.top = ly + 'px';
    el.style.opacity = String(opacity);
    el.style.fontSize = (this.narrow ? 11 : 13) + 'px';
    this.leader(key, ax, ay, lx, ly, opacity, tone);
  }
  leader(key, ax, ay, lx, ly, opacity, tone) {
    if (!this._svg) {
      this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this._svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
      this.overlay.insertBefore(this._svg, this.overlay.firstChild);
      this._lines = {};
    }
    let ln = this._lines[key];
    if (!ln) {
      ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this._svg.appendChild(ln);
      this._lines[key] = ln;
    }
    const dist = Math.hypot(lx - ax, ly - ay);
    ln.setAttribute('x1', ax); ln.setAttribute('y1', ay);
    ln.setAttribute('x2', lx); ln.setAttribute('y2', ly);
    ln.setAttribute('stroke', tone === 'accent' ? '#FF7900' : '#565E62');
    ln.setAttribute('stroke-width', '1.2');
    ln.setAttribute('opacity', dist > 18 ? String(opacity * 0.85) : '0');
  }
  hideLabelsExcept(keys) {
    if (this._labels) for (const k of Object.keys(this._labels)) if (keys.indexOf(k) < 0) this._labels[k].style.opacity = '0';
    if (this._lines) for (const k of Object.keys(this._lines)) if (keys.indexOf(k) < 0) this._lines[k].setAttribute('opacity', '0');
  }
}

/* =================================================================== *
 * <sipi-hero> — recorte do edifício, peça suspensa, entrada de câmera
 * =================================================================== */
class SipiHero extends SceneElement {
  build() {
    const m = this.mats;
    const root = new THREE.Group();
    this.scene.add(root);
    root.add(slabSheet(m, 0));
    root.add(storey(m, -H - SLAB, false));
    root.add(slabSheet(m, -H - SLAB));
    root.add(storey(m, 0, true));
    root.add(makeShoring(m, 0, H));
    const placed = new THREE.Group();
    for (let i = 0; i < PIECES.length; i++) {
      if (i === TRACKED) continue;
      const p = makePiece(m, PIECES[i], false);
      const c = pieceHome(PIECES[i]);
      p.position.set(c.x, H + SLAB / 2, c.z);
      placed.add(p);
    }
    root.add(placed);

    const lift = makePiece(m, PIECES[TRACKED], false);
    lift.userData.mat.color.setHex(PAL.orange);
    const c = pieceHome(PIECES[TRACKED]);
    lift.position.set(c.x - 0.15, H + 2.4, c.z + 0.1);
    root.add(lift);
    this.lift = lift;

    this.crane = makeCrane(m);
    root.add(this.crane);
    this.scene.add(shadowGround(-H - SLAB - 0.001, true));
    lightRig(this.scene, true);
    this.updateRig();
    this.t0 = performance.now();
  }
  updateRig() {
    const u = this.crane.userData;
    const p = this.lift.position, s = this.lift.userData.size;
    const hookY = p.y + 1.55;
    const hook = new THREE.Vector3(p.x, hookY, p.z);
    u.hook.position.copy(hook);
    u.spreader.position.set(p.x, hookY + 0.42, p.z);
    u.trolley.position.set(p.x, u.jibY - 0.55, p.z);
    alignCylinder(u.cable, new THREE.Vector3(p.x, u.jibY - 0.6, p.z), hook.clone().add(new THREE.Vector3(0, 0.14, 0)));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Vector3(p.x + corners[i][0] * 1.2, hookY + 0.42, p.z);
      const b = new THREE.Vector3(p.x + corners[i][0] * (s.w / 2 - 0.35), p.y + SLAB / 2, p.z + corners[i][1] * (s.d / 2 - 0.35));
      alignCylinder(u.slings[i], a, b);
    }
    u.jib.position.set(p.x + 7.5, u.jibY, p.z);
  }
  draw() {
    this.syncSize();
    const framingA = { tx: 6.2, ty: 1.4, tz: 4.2, azim: 46, elev: 25, size: 8.2 };
    const framingB = { tx: 6.1, ty: 0.9, tz: 4.0, azim: 37, elev: 30, size: 7.1 };
    let k = 1;
    if (!this.reduced) k = easeOut(seg((performance.now() - this.t0) / 1000, 0, 1.9));
    applyCamera(this.camera, blendFrames(framingA, framingB, k), this.aspect * (this.narrow ? 1 : 1));
    this.renderer.render(this.scene, this.camera);
    if (k < 1) { this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); }); }
  }
}

/* =================================================================== *
 * <sipi-process> — demonstração das seis etapas, relógio central
 * =================================================================== */
const DUR = [4, 5, 5, 5, 5, 11];
const STARTS = DUR.reduce((a, d, i) => (a.push(i ? a[i - 1] + DUR[i - 1] : 0), a), []);
const TOTAL = DUR.reduce((a, b) => a + b, 0);

const F = {
  top:    { tx: 6, ty: 1.4, tz: 4, azim: 0,  elev: 88, size: 7.6 },
  plan:   { tx: 6, ty: 1.3, tz: 4, azim: 16, elev: 58, size: 7.5 },
  prod0:  { tx: 0, ty: 2.9, tz: 0, azim: 42, elev: 24, size: 6.0 },
  prod1:  { tx: 0, ty: 3.1, tz: 0, azim: 24, elev: 16, size: 6.6 },
  iso:    { tx: 6, ty: 1.3, tz: 4, azim: 34, elev: 30, size: 6.9 },
  near:   { tx: 9.2, ty: 2.2, tz: 5.6, azim: 34, elev: 26, size: 3.6 },
  detail: { tx: 9.8, ty: 2.6, tz: 5.4, azim: 28, elev: 20, size: 2.0 },
  bench0: { tx: 0, ty: 0.5, tz: 0, azim: 46, elev: 30, size: 3.1 },
  bench1: { tx: 0.4, ty: 0.35, tz: 0.4, azim: 30, elev: 24, size: 2.4 },
  yard0:  { tx: 0, ty: 0.8, tz: 0, azim: 40, elev: 30, size: 5.4 },
  yard1:  { tx: 0, ty: 0.8, tz: 0, azim: 24, elev: 24, size: 7.2 },
  truck0: { tx: -0.8, ty: 1.8, tz: 0, azim: 36, elev: 24, size: 8.6 },
  truck1: { tx: 0.6, ty: 1.8, tz: 0, azim: 22, elev: 18, size: 7.8 },
  wide:   { tx: 6.6, ty: 2.4, tz: 4.6, azim: 40, elev: 27, size: 8.8 },
  lift:   { tx: 7.0, ty: 2.2, tz: 4.4, azim: 32, elev: 23, size: 7.6 },
  done:   { tx: 6, ty: 1.6, tz: 4, azim: 28, elev: 31, size: 8.4 }
};

class SipiProcess extends SceneElement {
  build() {
    const m = this.mats;
    this.groups = {};

    // ---- edifício
    const building = new THREE.Group();
    building.add(slabSheet(m, 0));
    building.add(storey(m, -H - SLAB, false));
    building.add(slabSheet(m, -H - SLAB));
    this.walls = storey(m, 0, true);
    building.add(this.walls);
    this.scene.add(building);
    this.groups.building = building;

    // ---- escoramento
    this.shoring = makeShoring(m, 0, H);
    this.scene.add(this.shoring);

    // ---- peças
    this.pieces = PIECES.map((s, i) => {
      const p = makePiece(m, s, i === TRACKED);
      const c = pieceHome(s);
      p.position.set(c.x, H + SLAB / 2, c.z);
      this.scene.add(p);
      return p;
    });
    this.tracked = this.pieces[TRACKED];

    // pontos de interface elétrica no topo da alvenaria
    this.stubs = makeWallStubs(m, H);
    this.scene.add(this.stubs);

    // indicação de continuidade entre eletroduto da laje e da parede
    this.link = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.34, 8), m.orange);
    this.link.position.set(9.6, H + SLAB * 0.5, 4.0);
    this.link.visible = false;
    this.scene.add(this.link);

    // eixos de projeto e disciplinas compatibilizadas
    this.axes = makeAxes();
    this.scene.add(this.axes);
    this.disc = makeDisciplines(m);
    this.scene.add(this.disc);

    // posições da peça em ambiente de produção (etapa 05)
    this.prodSlots = PIECES.map((sp, k) => new THREE.Vector3(0, 0.26 + k * 1.05, 0));

    // contornos das peças (etapa 01) — barras finas, legíveis em qualquer DPR
    this.outlines = PIECES.map((s2) => {
      const grp = new THREE.Group();
      const mt = new THREE.MeshBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0 });
      grp.userData.mt = mt;
      const bw = 0.09, y = 0.03;
      const spans = [
        [s2.x1 - s2.x0 - 0.12, bw, (s2.x0 + s2.x1) / 2, s2.z0 + 0.08],
        [s2.x1 - s2.x0 - 0.12, bw, (s2.x0 + s2.x1) / 2, s2.z1 - 0.08],
        [bw, s2.z1 - s2.z0 - 0.12, s2.x0 + 0.08, (s2.z0 + s2.z1) / 2],
        [bw, s2.z1 - s2.z0 - 0.12, s2.x1 - 0.08, (s2.z0 + s2.z1) / 2]
      ];
      for (const [sx, sz, cx, cz] of spans) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.02, sz), mt);
        b.position.set(cx, y, cz);
        grp.add(b);
      }
      this.scene.add(grp);
      return grp;
    });

    // ---- superfície de produção (etapa 02)
    this.bench = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.24, 5.2), m.graphite);
    top.position.y = -0.12; top.receiveShadow = true;
    this.bench.add(top);
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [2.2, 2.2], [-2.2, 2.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), m.steel);
      leg.position.set(x, -0.79, z); this.bench.add(leg);
    }
    this.bench.visible = false;
    this.scene.add(this.bench);

    // ---- caminhão (etapa 03)
    this.truck = makeTruck(m);
    this.truck.visible = false;
    this.scene.add(this.truck);
    this.cargo = PIECES.map((s, i) => {
      const p = makePiece(m, s, false);
      p.visible = false;
      this.truck.add(p);
      const col = i % 3, row = Math.floor(i / 3);
      p.position.set(-4.4 + col * 4.4, 1.42 + row * 0.26, 0);
      return p;
    });

    // ---- grua
    this.crane = makeCrane(m);
    this.scene.add(this.crane);

    // ---- pavimento seguinte (etapa 06)
    const nxt = new THREE.Group();
    const ghost = storey(m, H + SLAB, true);
    ghost.traverse((o) => {
      if (o.isMesh) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), m.ghost);
        e.position.copy(o.position); e.rotation.copy(o.rotation);
        nxt.add(e);
      }
    });
    nxt.visible = false;
    this.scene.add(nxt);
    this.ghostFloor = nxt;

    this.ground = shadowGround(-H - SLAB - 0.001, false);
    this.scene.add(this.ground);
    lightRig(this.scene, false);

    this.time = 0;
    this.playing = false;
    this.apply(0);
  }

  /* ---------------- relógio central ---------------- */
  play() {
    if (this.playing || this.time >= TOTAL - 0.001) return;
    this.playing = true;
    this._last = performance.now();
    this.emitState();
    this.loop();
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.emitState();
  }
  loop() {
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (!this.playing) return;
      const now = performance.now();
      const dt = Math.min((now - this._last) / 1000, 0.12);
      this._last = now;
      this.time += dt;
      if (this.time >= TOTAL) { this.time = TOTAL - 0.001; this.playing = false; }
      this.apply(this.time);
      this.emitState();
      if (this.playing) this.loop();
    });
  }
  goToStep(i) {
    this.pause();
    this.seek(STARTS[i] + (this.reduced ? DUR[i] * 0.98 : 0));
  }
  /* posicionamento direto pela linha do tempo (clique, arraste, teclado) */
  seek(t) {
    this.pause();
    this.time = Math.min(Math.max(t, 0), TOTAL - 0.001);
    this.apply(this.time);
    this.emitState();
  }
  seekFraction(f) { this.seek(f * TOTAL); }
  /* linha do tempo com seis segmentos visualmente iguais */
  seekUniform(f) {
    f = clamp01(f);
    const idx = Math.min(5, Math.floor(f * 6));
    this.seek(STARTS[idx] + (f * 6 - idx) * DUR[idx]);
  }
  uniformOf(t) {
    const i = this.stepOf(t);
    return (i + clamp01((t - STARTS[i]) / DUR[i])) / 6;
  }
  getTotal() { return TOTAL; }
  restart() { this.goToStep(0); }
  stepOf(t) { let i = 0; while (i < 5 && t >= STARTS[i + 1]) i++; return i; }
  emitState() {
    const i = this.stepOf(this.time);
    this.dispatchEvent(new CustomEvent('sipi-state', {
      bubbles: true,
      detail: { step: i, u: (this.time - STARTS[i]) / DUR[i], playing: this.playing, t: this.time, total: TOTAL, f: this.time / TOTAL, fu: this.uniformOf(this.time), starts: STARTS, dur: DUR }
    }));
  }

  /* ---------------- estados determinísticos ---------------- */
  /* apply(t) é função pura do tempo: qualquer instante reconstrói a cena inteira. */
  apply(t) {
    this.syncSize();
    const i = this.stepOf(t);
    const u = clamp01((t - STARTS[i]) / DUR[i]);
    const labels = [];
    const trk = this.tracked, S = trk.userData.size;
    const home = pieceHome(PIECES[TRACKED]);
    let frame = F.iso;

    // ---------- estado neutro ----------
    this.pieces.forEach((p, k) => {
      p.visible = false; p.rotation.set(0, 0, 0);
      const c = pieceHome(PIECES[k]);
      p.position.set(c.x, H + SLAB / 2, c.z);
      p.userData.mat.color.setHex(PAL.concrete);
      p.userData.edges.material.color.setHex(0x79817F);
    });
    this.outlines.forEach((l) => { l.userData.mt.opacity = 0; });
    this.cargo.forEach((c) => { c.visible = false; });
    this.axes.userData.mt.opacity = 0;
    this.disc.userData.elec.opacity = 0;
    this.disc.userData.hyd.opacity = 0;
    trk.userData.cut.visible = true;
    trk.userData.cut.position.set(-S.w / 4, 0, -S.d / 4);
    this.shoring.userData.props.forEach((p) => { p.visible = true; p.scale.y = 1; });
    let showBuilding = true, showShoring = false, showBench = false, showCrane = false,
        showStubs = false, showGhost = false, showTruck = false;

    if (i === 0) {
      /* 01 — Projeto da construtora: leitura técnica do pavimento */
      this.axes.userData.mt.opacity = 0.9 * smooth(seg(u, 0.05, 0.4));
      frame = track(u, [[0, F.top], [0.55, F.top], [1, F.plan]]);
      labels.push({ key: 'pv', text: 'Pavimento tipo', pos: new THREE.Vector3(W / 2, 0.1, D / 2), op: smooth(seg(u, 0.12, 0.3)), tone: 'plain', dy: -40 });
      labels.push({ key: 'al', text: 'Alvenaria estrutural', pos: new THREE.Vector3(6, H, 0.15), op: smooth(seg(u, 0.42, 0.62)), tone: 'plain', dx: 30, dy: -52 });

    } else if (i === 1) {
      /* 02 — Compatibilização: disciplinas integradas e interfaces */
      this.axes.userData.mt.opacity = 0.34;
      this.disc.userData.elec.opacity = smooth(seg(u, 0.08, 0.42));
      this.disc.userData.hyd.opacity = 0.9 * smooth(seg(u, 0.3, 0.6));
      showStubs = u > 0.55;
      frame = track(u, [[0, F.plan], [0.6, F.iso], [1, F.iso]]);
      labels.push({ key: 'el', text: 'Elétrica prevista em projeto', pos: new THREE.Vector3(6.4, 0.12, 5.6), op: smooth(seg(u, 0.16, 0.36)), tone: 'accent', dx: -26, dy: 56 });
      labels.push({ key: 'hd', text: 'Hidráulica', pos: new THREE.Vector3(2.4, H * 0.6, 5.4), op: smooth(seg(u, 0.36, 0.56)), tone: 'plain', dx: -34, dy: -20 });
      labels.push({ key: 'itf', text: 'Interfaces com a alvenaria', pos: new THREE.Vector3(9.6, H + 0.2, 4.0), op: smooth(seg(u, 0.6, 0.82)), tone: 'plain', dx: 40, dy: -50 });

    } else if (i === 2) {
      /* 03 — Modulação das lajes: o pavimento passa a ser painéis */
      this.axes.userData.mt.opacity = 0.2 * (1 - smooth(seg(u, 0.3, 0.7)));
      this.disc.userData.elec.opacity = 0.3 * (1 - smooth(seg(u, 0, 0.35)));
      frame = track(u, [[0, F.iso], [1, F.wide]]);
      PIECES.forEach((sp, k) => {
        const appear = smooth(seg(u, 0.08 + k * 0.1, 0.26 + k * 0.1));
        this.outlines[k].userData.mt.opacity = 0.95 * appear;
        const p = this.pieces[k];
        p.visible = appear > 0.55;
        p.position.y = H + SLAB / 2 + (1 - smooth(seg(u, 0.14 + k * 0.1, 0.4 + k * 0.1))) * 0.9;
        if (k === TRACKED) p.userData.mat.color.setHex(appear > 0.9 ? PAL.orange : PAL.concrete);
        labels.push({ key: 'p' + k, text: sp.id, pos: new THREE.Vector3((sp.x0 + sp.x1) / 2, H + SLAB, (sp.z0 + sp.z1) / 2), op: appear, tone: k === TRACKED ? 'accent' : 'plain' });
      });

    } else if (i === 3) {
      /* 04 — Instalações incorporadas: corte controlado no painel L01 */
      showStubs = true;
      this.pieces.forEach((p, k) => { p.visible = true; if (k !== TRACKED) p.userData.mat.color.setHex(PAL.concrete); });
      trk.position.set(home.x, H + SLAB / 2 + 0.6, home.z);
      const open = smooth(seg(u, 0.26, 0.62));
      trk.userData.cut.position.set(-S.w / 4 - open * 1.35, open * 0.5, -S.d / 4 - open * 1.35);
      trk.userData.cut.visible = open < 0.985;
      frame = track(u, [[0, F.wide], [0.4, F.near], [1, F.detail]]);
      labels.push({ key: 'pid', text: 'L01', pos: new THREE.Vector3(home.x - S.w * 0.3, H + 0.8, home.z - S.d * 0.3), op: 1, tone: 'accent', dy: -28 });
      labels.push({ key: 'el', text: 'Eletrodutos e caixas incorporados', pos: new THREE.Vector3(home.x + S.w / 4, H + 0.75, home.z + S.d / 4), op: smooth(seg(u, 0.34, 0.58)), tone: 'plain', dx: 22, dy: 58 });


    } else if (i === 4) {
      /* 05 — Plano de produção: peças identificadas, em sequência */
      showBuilding = false; showBench = true;
      PIECES.forEach((sp, k) => {
        const appear = smooth(seg(u, 0.06 + k * 0.11, 0.22 + k * 0.11));
        const p = this.pieces[k];
        p.visible = appear > 0.02;
        const slot = this.prodSlots[k];
        p.position.set(slot.x, slot.y + (1 - appear) * 1.1, slot.z);
        p.userData.mat.color.setHex(k === TRACKED ? PAL.orange : PAL.concrete);
        labels.push({ key: 'p' + k, text: sp.id, pos: new THREE.Vector3(slot.x + S.w / 2, slot.y + SLAB, slot.z), op: appear, tone: k === TRACKED ? 'accent' : 'plain', dx: k % 2 ? -46 : 46 });
      });
      frame = track(u, [[0, F.prod0], [1, F.prod1]]);

    } else {
      /* 06 — Plano de montagem: cada painel na sua posição, L01 primeiro */
      showShoring = true; showStubs = true;
      this.shoring.userData.props.forEach((p, k) => {
        const g = smooth(seg(u, (k / this.shoring.userData.props.length) * 0.04, 0.03 + (k / this.shoring.userData.props.length) * 0.04));
        p.visible = g > 0.02; p.scale.y = Math.max(0.02, g);
      });
      // L01 é içado e posicionado
      const start = new THREE.Vector3(home.x + 6.4, H + 1.6, home.z + 3.6);
      const high = H + 2.6;
      const pos = new THREE.Vector3(); let yaw = 0.14;
      trk.visible = u >= 0.05;
      showCrane = u >= 0.05 && u < 0.46;
      trk.userData.mat.color.setHex(PAL.orange);
      if (u < 0.12) {
        const k = easeInOut(seg(u, 0.05, 0.12));
        pos.set(start.x, lerp(start.y, high, k), start.z);
      } else if (u < 0.26) {
        const k = easeInOut(seg(u, 0.12, 0.26));
        pos.set(lerp(start.x, home.x, k), high, lerp(start.z, home.z, k));
        yaw = lerp(0.14, 0.03, k);
      } else if (u < 0.31) {
        const k = easeInOut(seg(u, 0.26, 0.31));
        pos.set(home.x, high, home.z); yaw = lerp(0.03, 0, k);
      } else if (u < 0.4) {
        const k = easeOut(seg(u, 0.31, 0.4));
        pos.set(home.x, lerp(high, H + SLAB / 2, k), home.z); yaw = 0;
      } else {
        pos.set(home.x, H + SLAB / 2, home.z); yaw = 0;
      }
      trk.position.copy(pos);
      trk.rotation.y = yaw;
      const detach = smooth(seg(u, 0.4, 0.46));
      if (trk.visible) this.rigTo(trk, detach);
      // L02 → L06 seguem a sequência planejada
      for (let k = 1; k < PIECES.length; k++) {
        const a0 = 0.48 + (k - 1) * 0.075;
        const app = smooth(seg(u, a0, a0 + 0.07));
        const p = this.pieces[k];
        p.visible = app > 0.02;
        p.position.y = H + SLAB / 2 + (1 - app) * 1.6;
      }
      // continuidade para o pavimento seguinte
      const fade = smooth(seg(u, 0.86, 1));
      trk.userData.mat.color.copy(new THREE.Color(PAL.orange).lerp(new THREE.Color(PAL.concrete), fade * 0.65));
      showGhost = u > 0.86;
      this.ghostFloor.traverse((o) => { if (o.material) o.material.opacity = 0.3 * fade; });
      frame = track(u, [[0, F.wide], [0.12, F.lift], [0.46, F.lift], [0.62, F.wide], [1, F.done]]);
      if (u >= 0.05 && u < 0.52) labels.push({ key: 'pid', text: 'L01', pos: trk.position.clone().add(new THREE.Vector3(0, 0.3, 0)), op: 1, tone: 'accent', dy: -30 });
      if (u > 0.5) PIECES.forEach((sp, k) => {
        if (!this.pieces[k].visible) return;
        labels.push({ key: 'm' + k, text: sp.id, pos: new THREE.Vector3((sp.x0 + sp.x1) / 2, H + SLAB, (sp.z0 + sp.z1) / 2), op: 0.95, tone: k === TRACKED ? 'accent' : 'plain' });
      });
    }

    this.groups.building.visible = showBuilding;
    this.shoring.visible = showShoring;
    this.bench.visible = showBench;
    this.truck.visible = showTruck;
    this.crane.visible = showCrane;
    this.stubs.visible = showStubs;
    this.ghostFloor.visible = showGhost;
    this.axes.visible = this.axes.userData.mt.opacity > 0.01;
    this.disc.visible = this.disc.userData.elec.opacity > 0.01 || this.disc.userData.hyd.opacity > 0.01;
    this.link.visible = false;
    this.ground.visible = showBuilding && !(i === 0 && u < 0.5);

    const f = Object.assign({}, frame);
    if (this.narrow) { f.size *= 1.24; f.ty += 0.2; }
    applyCamera(this.camera, f, this.aspect);

    const keys = labels.map((l) => l.key);
    for (const l of labels) this.placeLabel(l.key, l.text, l.pos, l.op, l.tone, l.dx, l.dy);
    this.hideLabelsExcept(keys);

    this.renderer.render(this.scene, this.camera);
  }

  rigTo(piece, detach) {
    const u = this.crane.userData;
    const p = piece.position, s = piece.userData.size;
    const hookY = p.y + 1.7 + detach * 2.2;
    const hook = new THREE.Vector3(p.x, hookY, p.z);
    u.hook.position.copy(hook);
    u.hook.visible = true;
    u.spreader.position.set(p.x, hookY + 0.45, p.z);
    u.spreader.rotation.y = piece.rotation.y;
    u.trolley.position.set(p.x, u.jibY - 0.55, p.z);
    alignCylinder(u.cable, new THREE.Vector3(p.x, u.jibY - 0.6, p.z), hook.clone().add(new THREE.Vector3(0, 0.16, 0)));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const inset = 0.38;
    for (let i = 0; i < 4; i++) {
      const sx = corners[i][0] * (s.w / 2 - inset), sz = corners[i][1] * (s.d / 2 - inset);
      const rot = piece.rotation.y;
      const wx = p.x + sx * Math.cos(rot) + sz * Math.sin(rot);
      const wz = p.z - sx * Math.sin(rot) + sz * Math.cos(rot);
      const a = new THREE.Vector3(p.x + corners[i][0] * 1.25 * Math.cos(rot), hookY + 0.45, p.z - corners[i][0] * 1.25 * Math.sin(rot));
      const b = new THREE.Vector3(wx, p.y + SLAB / 2, wz);
      const anchor = detach > 0.02 ? b.clone().lerp(a, Math.min(detach * 1.6, 0.94)) : b;
      alignCylinder(u.slings[i], a, anchor);
      u.slings[i].visible = detach < 0.98;
    }
    u.jib.position.set(p.x + 7.5, u.jibY, p.z);
  }

  draw() { this.apply(this.time); }
}

if (!customElements.get('sipi-hero')) customElements.define('sipi-hero', SipiHero);
if (!customElements.get('sipi-process')) customElements.define('sipi-process', SipiProcess);
window.SIPI_SCENE = { DUR, TOTAL, STARTS };
