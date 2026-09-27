#!/usr/bin/env node
/*
 * Build de produção do site SIPI.
 *
 * Entrada: o export do Claude Design em _build/src/ (SIPI Site.dc.html,
 * support.js, sipi-scene.js). Saída: o site estático na raiz do repositório.
 *
 * O layout, os textos, as animações e o runtime do Claude Design são mantidos.
 * O build só muda a camada técnica:
 *  - template movido para <script type="text/x-dc-template"> (sem {{ }} no HTML rastreável);
 *  - home pré-renderizada (#dc-pre), trocada pela árvore React sem mudança visual;
 *  - React, Three.js e fontes servidos localmente;
 *  - imagens responsivas AVIF/WebP e GIF convertido em AVIF animado;
 *  - metadados, canonical, Open Graph, JSON-LD, robots.txt, sitemap.xml, llms.txt.
 *
 * Uso: cd _build && npm install && npm run build
 * Variáveis: SITE_ORIGIN (padrão https://sipiengenharia.com.br), CHROME_PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer-core';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { transformSync } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(HERE, 'src');

// Único ponto de configuração do domínio canônico de produção.
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://sipiengenharia.com.br').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SEO = {
  siteName: 'SIPI Engenharia',
  pages: {
    home: {
      t: 'SIPI Engenharia | Laje Pronta e Pavimento Industrializado',
      d: 'Sistema SIPI integra engenharia, fabricação, logística, içamento, escoramento e montagem para entregar lajes prontas em edifícios de alvenaria estrutural.'
    },
    sistema: {
      t: 'Sistema SIPI | Laje Pronta para Alvenaria Estrutural',
      d: 'Conheça o Sistema SIPI: engenharia, fabricação industrial, elétrica incorporada, logística, içamento, escoramento e montagem da laje pronta.'
    },
    empresa: {
      t: 'SIPI Engenharia | Engenharia para Pavimento Industrializado',
      d: 'Conheça a SIPI Engenharia e sua atuação na integração de projeto, fabricação, logística e montagem de lajes prontas para alvenaria estrutural.'
    },
    contato: {
      t: 'Avaliação de Empreendimento | SIPI Engenharia',
      d: 'Envie os dados do empreendimento para avaliação técnica da aplicação do Sistema SIPI em obras de alvenaria estrutural.'
    }
  },
  orgDescription: 'Empresa de engenharia voltada à industrialização do pavimento, integrando engenharia, fabricação, logística, içamento, escoramento e montagem de lajes prontas para empreendimentos de alvenaria estrutural.',
  service: {
    name: 'Sistema SIPI',
    alternateName: 'Sistema Integrado de Pavimento Industrializado',
    serviceType: 'Sistema integrado de pavimento industrializado e laje pronta para edifícios de alvenaria estrutural',
    description: 'O Sistema SIPI integra engenharia, compatibilização, fabricação industrial, transporte, logística, içamento, escoramento e montagem para entrega da laje pronta conforme o planejamento do empreendimento.'
  },
  // Dados de contato usados no JSON-LD. O build falha se deixarem de aparecer no conteúdo visível.
  contact: {
    email: 'contato@sipiengenharia.com.br',
    telephone: '+55 11 93727-1020',
    telephoneVisible: '(11) 93727 - 1020',
    streetAddress: 'Praça Félix, 08 - Vila Silvia',
    addressVisible: 'Praça Félix, 08 - Vila Silvia, São Paulo - SP',
    instagram: 'https://www.instagram.com/sipi.engenharia/'
  },
  ogImage: { path: 'assets/og/sipi-og.jpg', width: 1200, height: 630, alt: 'Peça de laje pronta içada por guindaste sobre edifício em construção ao entardecer.' }
};

/* ------------------------------------------------------------------ */
/* utilitários                                                         */
/* ------------------------------------------------------------------ */
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function replaceOnce(str, from, to, label) {
  const n = str.split(from).length - 1;
  if (n !== 1) throw new Error(`[build] "${label}": esperado 1 trecho, encontrado ${n}`);
  return str.replace(from, () => to);
}
function log(...a) { console.log('[build]', ...a); }
const hash = (...parts) => crypto.createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 8);
const VENDOR = { react: 'vendor/react-18.3.1.production.min.js', reactDom: 'vendor/react-dom-18.3.1.production.min.js', three: 'vendor/three-0.160.0.module.min.js' };
const FONTS = { inter: 'fonts/inter-v20', grotesk: 'fonts/space-grotesk-v22' };

/* ------------------------------------------------------------------ */
/* 1. runtime (support.js) e cena 3D                                   */
/* ------------------------------------------------------------------ */
function buildRuntime() {
  let s = read(path.join(SRC, 'support.js'));
  s = replaceOnce(s,
    `    return {
      template: dc.innerHTML,`,
    `    // SIPI build patch: the template ships as raw text inside
    // <script type="text/x-dc-template" id="dc-template"> so crawlers never
    // index {{ }} placeholders and camelCase attributes survive intact.
    const tplEl = doc.getElementById("dc-template");
    return {
      template: tplEl ? tplEl.textContent : dc.innerHTML,`, 'template source');
  s = replaceOnce(s,
    `    if (!window.__resources) {
      fetch(location.href)`,
    `    // SIPI build patch: the raw template is already inline, so skip re-downloading the page.
    if (!window.__resources && !doc.getElementById("dc-template")) {
      fetch(location.href)`, 'refetch');
  s = replaceOnce(s,
    'var REACT_URL = "https://unpkg.com/react@18.3.1/umd/react.production.min.js";',
    '// SIPI build patch: React is self-hosted (same bytes and SRI as unpkg).\n  var REACT_URL = "' + VENDOR.react + '";', 'react url');
  s = replaceOnce(s,
    'var REACT_DOM_URL = "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js";',
    'var REACT_DOM_URL = "' + VENDOR.reactDom + '";', 'react-dom url');
  s = replaceOnce(s,
    `      const isCE = isCustomElementName(name);
      const tick = () => {`,
    `      const isCE = isCustomElementName(name);
      // SIPI build patch: wait for custom elements with whenDefined instead of
      // polling every 50 ms and giving up after 30 s (the 3D module loads lazily).
      if (isCE && customElements.whenDefined) {
        customElements.whenDefined(name).then(() => {
          polling.delete(name);
          onResolved();
        });
        return;
      }
      const tick = () => {`, 'whenDefined');
  // CSS do runtime, repetido no <head> estático para a home pré-renderizada.
  const base = /var BASE_CSS = `([\s\S]*?)`;/.exec(s)[1];
  const atomics = /var ATOMIC_CSS = \(\s*\/\/[^\n]*\n\s*("(?:[^"\\]|\\.)*")\s*\);/.exec(s)[1];
  const full = /var FULL_PAGE_CSS = ("(?:[^"\\]|\\.)*");/.exec(s)[1];
  s = transformSync(s, { minify: true, legalComments: 'none', target: 'es2019' }).code;
  write(path.join(ROOT, 'support.js'), s);

  let sc = read(path.join(SRC, 'sipi-scene.js'));
  sc = replaceOnce(sc,
    "import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';",
    `import * as THREE from './${VENDOR.three}';`, 'three import');
  sc = transformSync(sc, { minify: true, format: 'esm', legalComments: 'none', target: 'es2019' }).code;
  write(path.join(ROOT, 'sipi-scene.js'), sc);

  return {
    supportV: hash(s),
    sceneV: hash(sc),
    BASE_CSS: new Function('return `' + base + '`')().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, ''),
    ATOMIC_CSS: JSON.parse(atomics),
    FULL_PAGE_CSS: JSON.parse(full)
  };
}

/* ------------------------------------------------------------------ */
/* 2. imagens                                                          */
/* ------------------------------------------------------------------ */
const SIZES = {
  card: '(min-width: 1024px) 380px, (min-width: 700px) 66vw, 72vw',
  half: '(min-width: 1440px) 645px, (min-width: 1024px) 50vw, 90vw',
  wide: '(min-width: 1280px) 1184px, 92vw',
  // object-fit:cover em blocos mais altos que 16:9 no mobile: a imagem é desenhada mais larga que a tela.
  cta: '(max-width: 700px) 810px, 100vw',
  hero: '(max-width: 1000px) 1420px, 100vw',
  logoHeader: '170px',
  logoFooter: '258px'
};
const IMAGES = {
  'sipi-logo.png': { widths: [320, 640, 960], alpha: true },
  // Fica sob a camada escura do hero (60–94% de opacidade) e é o elemento de LCP.
  'hero-bg.png': { widths: [960, 1280, 1672], webpOnly: true, quality: 76 },
  'poster-fabricacao-industrial.png': { widths: [480, 800, 1200], sizes: SIZES.half },
  'comparativo-processo-sipi-v3.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'comparativo-processo-convencional-v2.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'beneficio-menos-atividades-v2.png': { widths: [400, 800, 1024], sizes: SIZES.card },
  'beneficio-dependencia-operacional-v2.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'beneficio-escoramento.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'beneficio-eletrica-incorporada.jpeg': { widths: [400, 800, 1200], sizes: SIZES.card },
  'beneficio-pronta-em-cima-e-embaixo.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'beneficio-obra-limpa-e-seca.png': { widths: [400, 800, 1200], sizes: SIZES.card },
  'custo-total-processo.jpeg': { widths: [480, 800, 1280], sizes: SIZES.half },
  'cta-avaliacao-empreendimento.png': { widths: [640, 960, 1280, 1672], sizes: SIZES.cta },
  'sistema-sipi-hero-v2.png': { widths: [640, 960, 1280, 1672], sizes: SIZES.wide },
  'sistema-compatibilizacao.png': { widths: [480, 800, 1280], sizes: SIZES.half },
  'fabricacao-industrial.png': { widths: [480, 800, 1280], sizes: SIZES.half },
  'sistema-controle-industrial.png': { widths: [480, 800, 1280], sizes: SIZES.half },
  'empresa-sipi-v3.png': { widths: [480, 800, 1280], sizes: SIZES.half },
  'contato-avaliacao.jpeg': { widths: [480, 800, 1280], sizes: SIZES.half }
};
const OPT = 'assets/opt';
const stem = (f) => f.replace(/\.[a-z]+$/i, '');
const fresh = (out, src) => fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;

async function buildImages() {
  fs.mkdirSync(path.join(ROOT, OPT), { recursive: true });
  const made = {};
  const keep = new Set();
  for (const [file, cfg] of Object.entries(IMAGES)) {
    const src = path.join(ROOT, 'assets', file);
    const { width } = await sharp(src).metadata();
    const widths = [...new Set(cfg.widths.map((w) => Math.min(w, width)))];
    made[file] = { avif: [], webp: [], sizes: cfg.sizes };
    const h = hash(fs.readFileSync(src).toString('base64'), JSON.stringify(cfg), 'q1');
    for (const w of widths) {
      const base = `${OPT}/${stem(file)}-${w}.${h}`;
      const webp = path.join(ROOT, base + '.webp');
      if (!fresh(webp, src)) {
        await sharp(src).resize({ width: w, withoutEnlargement: true })
          .webp(cfg.alpha ? { quality: 90, alphaQuality: 100, effort: 6 } : { quality: cfg.quality || 82, effort: 6 }).toFile(webp);
      }
      made[file].webp.push([base + '.webp', w]);
      keep.add(base + '.webp');
      if (cfg.webpOnly) continue;
      const avif = path.join(ROOT, base + '.avif');
      if (!fresh(avif, src)) {
        await sharp(src).resize({ width: w, withoutEnlargement: true })
          .avif(cfg.alpha ? { quality: 72, effort: 6 } : { quality: 60, effort: 6 }).toFile(avif);
      }
      made[file].avif.push([base + '.avif', w]);
      keep.add(base + '.avif');
    }
  }
  // GIF da montagem → vídeo MP4 (H.264): mesma animação e tempos de quadro, cerca de
  // um terço do peso e decodificação por hardware (um GIF/AVIF animado deste tamanho
  // ocupa a thread principal). O primeiro quadro vira o pôster.
  const gif = path.join(ROOT, 'assets/montagem-obra.gif');
  const gh = hash(fs.readFileSync(gif).toString('base64'), 'x264-crf23-slow-film');
  made.gif = { mp4: `${OPT}/montagem-obra.${gh}.mp4`, poster: `${OPT}/montagem-obra-poster.${gh}.webp` };
  keep.add(made.gif.mp4); keep.add(made.gif.poster);
  if (!fs.existsSync(path.join(ROOT, made.gif.mp4))) {
    log('convertendo montagem-obra.gif em MP4…');
    execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', gif, '-fps_mode', 'vfr',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-tune', 'film', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      path.join(ROOT, made.gif.mp4)], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  if (!fs.existsSync(path.join(ROOT, made.gif.poster))) {
    await sharp(gif, { pages: 1 }).webp({ quality: 82, effort: 6 }).toFile(path.join(ROOT, made.gif.poster));
  }
  // remove variantes antigas (fonte trocada ou imagem fora do layout)
  for (const f of fs.readdirSync(path.join(ROOT, OPT))) if (!keep.has(`${OPT}/${f}`)) fs.rmSync(path.join(ROOT, OPT, f));
  // Imagem de compartilhamento (Open Graph / Twitter): recorte 1200×630 do visual do hero.
  const og = path.join(ROOT, SEO.ogImage.path);
  const heroSrc = path.join(ROOT, 'assets/hero-bg.png');
  if (!fresh(og, heroSrc)) {
    fs.mkdirSync(path.dirname(og), { recursive: true });
    await sharp(heroSrc).resize(SEO.ogImage.width, SEO.ogImage.height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 84, mozjpeg: true }).toFile(og);
  }
  return made;
}

const srcset = (list) => list.map(([p, w]) => `${p} ${w}w`).join(', ');
function picture(made, file, imgTag, sizes) {
  const m = made[file];
  const sz = sizes || m.sizes;
  const avif = m.avif.length ? `<source type="image/avif" srcSet="${srcset(m.avif)}" sizes="${sz}">` : '';
  return `<picture>${avif}<source type="image/webp" srcSet="${srcset(m.webp)}" sizes="${sz}">${imgTag}</picture>`;
}

/* ------------------------------------------------------------------ */
/* 3. template, lógica e CSS do export                                 */
/* ------------------------------------------------------------------ */
function parseSource() {
  const html = read(path.join(SRC, 'SIPI Site.dc.html'));
  const open = html.indexOf('<x-dc>'), close = html.lastIndexOf('</x-dc>');
  let template = html.slice(open + 6, close);
  const logicOpen = html.indexOf('<script type="text/x-dc"');
  const logicTagEnd = html.indexOf('>', logicOpen) + 1;
  const logicClose = html.indexOf('</script>', logicTagEnd);
  const logicTag = html.slice(logicOpen, logicTagEnd);
  let logic = html.slice(logicTagEnd, logicClose);

  const helmet = /<helmet data-dc-atomics="">([\s\S]*?)<\/helmet>/.exec(template);
  if (!helmet) throw new Error('[build] <helmet> não encontrado');
  const designCss = /<style>([\s\S]*?)<\/style>/.exec(helmet[1])[1];
  template = template.replace(helmet[0], '');
  return { template, logicTag, logic, designCss };
}

function transformTemplate(template, made) {
  let t = template;
  // imagens de conteúdo → <picture> AVIF/WebP com srcset/sizes
  for (const file of Object.keys(IMAGES)) {
    if (file === 'sipi-logo.png' || file === 'hero-bg.png' || file === 'fabricacao-industrial.png') continue;
    const re = new RegExp(`<img src="assets/${file.replace(/\./g, '\\.')}"[^>]*>`, 'g');
    const tags = t.match(re) || [];
    if (!tags.length) throw new Error(`[build] imagem não encontrada no template: ${file}`);
    for (const tag of new Set(tags)) t = t.split(tag).join(picture(made, file, tag));
  }
  // fabricação industrial: já estava num <picture> com WebP
  const fab = /<picture><source srcset="assets\/fabricacao-industrial\.webp" type="image\/webp">(<img src="assets\/fabricacao-industrial\.png"[^>]*>)<\/picture>/.exec(t);
  if (!fab) throw new Error('[build] <picture> da fabricação industrial não encontrado');
  t = t.replace(fab[0], picture(made, 'fabricacao-industrial.png', fab[1]));
  // logos: dimensões intrínsecas + variantes leves
  t = replaceOnce(t, '<img src="assets/sipi-logo.png" alt="SIPI Engenharia" style="width: 308px; height: 123px">',
    picture(made, 'sipi-logo.png', '<img src="assets/sipi-logo.png" alt="SIPI Engenharia" width="1983" height="793" style="width: 308px; height: 123px">', SIZES.logoHeader), 'logo header');
  t = replaceOnce(t, '<img src="assets/sipi-logo.png" alt="SIPI Engenharia" style="height: 103px; width: 258px; display: block; margin-bottom: 18px">',
    picture(made, 'sipi-logo.png', '<img src="assets/sipi-logo.png" alt="SIPI Engenharia" width="1983" height="793" loading="lazy" decoding="async" style="height: 103px; width: 258px; display: block; margin-bottom: 18px">', SIZES.logoFooter), 'logo footer');
  // GIF da montagem → <video> em loop, sem som, com o mesmo estilo e texto alternativo
  // (o texto alternativo do GIF passa para o contêiner, com role="img"; o vídeo é decorativo)
  const gifTag = /<div style="([^"]*)"><img src="assets\/montagem-obra\.gif" alt="([^"]*)" width="800" height="450" loading="lazy" decoding="async" style="([^"]*)">/.exec(t);
  if (!gifTag) throw new Error('[build] <img> do GIF da montagem não encontrado');
  t = t.replace(gifTag[0], `<div role="img" aria-label="${gifTag[2]}" style="${gifTag[1]}"><video data-gif="" data-src="${made.gif.mp4}" poster="${made.gif.poster}" muted="{{ true }}" loop="{{ true }}" playsInline="{{ true }}" preload="none" disablePictureInPicture="{{ true }}" aria-hidden="true" tabIndex="-1" width="800" height="450" style="${gifTag[3]}"></video>`);
  // pôster do vídeo do hero (o mesmo arquivo exibido pela home pré-renderizada)
  const heroPoster = made['hero-bg.png'].webp[made['hero-bg.png'].webp.length - 1][0];
  t = replaceOnce(t, 'poster="assets/hero-bg.png"', `poster="${heroPoster}"`, 'hero poster');
  // formulário: autocomplete, teclado e obrigatoriedade anunciada
  const form = [
    ['id="f-nome" name="nome" type="text"', 'autoComplete="name"'],
    ['id="f-empresa" name="empresa" type="text"', 'autoComplete="organization"'],
    ['id="f-cargo" name="cargo" type="text"', 'autoComplete="organization-title"'],
    ['id="f-email" name="email" type="email"', 'autoComplete="email"'],
    ['id="f-telefone" name="telefone" type="tel"', 'autoComplete="tel" inputMode="tel"'],
    ['id="f-cidade" name="cidade" type="text"', 'autoComplete="address-level2"'],
    ['id="f-estado" name="estado" type="text"', 'autoComplete="address-level1"'],
    ['<select id="f-tipo" name="tipo"', 'aria-required="true"']
  ];
  for (const [anchor, add] of form) t = replaceOnce(t, anchor, `${anchor} ${add}`, anchor);
  if (/<\/script/i.test(t)) throw new Error('[build] o template não pode conter </script>');
  return t;
}

// Vídeos que substituem GIFs animados: como um <img loading="lazy">, carregam perto
// da viewport e animam sempre, em loop e sem som.
const GIF_VIDEOS = `  gifVideos(){
    const vids = Array.prototype.slice.call(document.querySelectorAll('video[data-gif]:not([data-gif-obs])'));
    vids.forEach(v => {
      v.setAttribute('data-gif-obs','');
      v.muted = true; v.defaultMuted = true;
      const start = () => { if (!v.getAttribute('src')) v.src = v.dataset.src; const p = v.play(); if (p && p.catch) p.catch(() => {}); };
      if (!window.IntersectionObserver) { start(); return; }
      const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, {rootMargin:'1250px 0px'});
      io.observe(v);
    });
  }
`;
function transformLogic(logic, rt) {
  logic = replaceOnce(logic, '  heroVideo(){', GIF_VIDEOS + '  heroVideo(){', 'gifVideos method');
  if ((logic.match(/    this\.heroVideo\(\);\n/g) || []).length !== 2) throw new Error('[build] chamadas de heroVideo() mudaram');
  logic = logic.replace(/    this\.heroVideo\(\);\n/g, '    this.heroVideo();\n    this.gifVideos();\n');
  logic = replaceOnce(logic, "s.type = 'module'; s.src = 'sipi-scene.js';", `s.type = 'module'; s.src = 'sipi-scene.js?v=${rt.sceneV}';`, 'scene src');
  const re = /const META=\{[\s\S]*?\n\};/;
  if (!re.test(logic)) throw new Error('[build] bloco META não encontrado na lógica');
  const entries = Object.entries(SEO.pages).map(([k, v]) => `  ${k}:{t:${JSON.stringify(v.t)}, d:${JSON.stringify(v.d)}}`).join(',\n');
  return logic.replace(re, `const META={\n${entries}\n};`);
}

function fontCss() {
  const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
  const face = (family, file, weight, range) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${file}.woff2) format('woff2');unicode-range:${range}}`;
  return [
    face('Space Grotesk', `${FONTS.grotesk}-latin-ext`, '500 600', LATIN_EXT),
    face('Space Grotesk', `${FONTS.grotesk}-latin`, '500 600', LATIN),
    face('Inter', `${FONTS.inter}-latin-ext`, '400 600', LATIN_EXT),
    face('Inter', `${FONTS.inter}-latin`, '400 600', LATIN)
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 4. home pré-renderizada: troca pela árvore React                    */
/* ------------------------------------------------------------------ */
const PRE_CSS = '#dc-pre,#dc-pre>.sc-host{height:100%}' +
  '.dc-pre #dc-root{position:absolute;top:0;left:0;width:100%;opacity:0;pointer-events:none;z-index:-1}';

// Roda logo após #dc-pre. Aplica o mesmo reveal da lógica da página e, quando o
// React conclui a primeira renderização em #dc-root, transfere o estado das
// animações de entrada e remove a cópia estática no mesmo quadro.
const PRE_SCRIPT = `(function(){
var pre=document.getElementById('dc-pre');if(!pre)return;
var de=document.documentElement,ROUTE=/^#\\/?(sistema|empresa|contato)(#|$)/;
if(ROUTE.test(location.hash)){pre.remove();return;}
de.classList.add('dc-pre');
var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var secs=[].slice.call(pre.querySelectorAll('main section, footer'));
var io=!reduced&&'IntersectionObserver' in window?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.setAttribute('data-reveal','in');io.unobserve(e.target);}});},{threshold:0,rootMargin:'0px 0px -12% 0px'}):null;
// Como no site original, o reveal começa com a página já pintada: o que está na
// tela continua visível e as seções abaixo fazem a mesma transição de saída.
var revealed=false;
function reveal(){if(revealed||!pre.isConnected)return;revealed=true;
secs.forEach(function(n){if(n.id==='como-funciona')n.setAttribute('data-reveal-mode','fade');
if(!io||n.getBoundingClientRect().top<innerHeight*.92)n.setAttribute('data-reveal','in');else{n.setAttribute('data-reveal','');io.observe(n);}});}
requestAnimationFrame(function(){requestAnimationFrame(reveal);});
var moved=false;
addEventListener('hashchange',function(){if(pre.isConnected&&ROUTE.test(location.hash)){moved=true;pre.style.display='none';scrollTo(0,0);}});
var mo=new MutationObserver(function(){
var root=document.getElementById('dc-root');if(!root||!root.firstElementChild)return;
mo.disconnect();
var img=pre.querySelector('.hero-video'),vid=root.querySelector('#hero-video');
if(img&&vid&&img.currentSrc)vid.poster=img.currentSrc;
ready(root,function(){swap(root);});
});
mo.observe(document.body,{childList:true,subtree:true});
function ready(root,done){
var imgs=[].slice.call(root.querySelectorAll('img')).filter(function(i){var r=i.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<innerHeight;});
var left=imgs.length,over=false;
function fin(){if(!over){over=true;requestAnimationFrame(done);}}
setTimeout(fin,400);
if(!left)return fin();
imgs.forEach(function(i){(i.decode?i.decode():Promise.resolve()).then(tick,tick);});
function tick(){if(--left===0)fin();}
}
function pairs(a,b){
var out=[[a,b]];
for(var i=0;i<a.children.length;i++){var x=a.children[i],y=b.children[i];if(!y||x.tagName!=='DIV')continue;
for(var j=0;j<x.children.length;j++)if(y.children[j])out.push([x.children[j],y.children[j]]);}
return out;
}
// A árvore React passa a exibir exatamente o que a cópia estática exibia: as transições
// dela terminam no mesmo estado final e as da cópia continuam como clones (mesmos
// keyframes, timing e tempo atual).
function sync(a,b,keep){
if(keep||!b.getAnimations||!b.animate)return;
b.getAnimations().forEach(function(x){if(x.transitionProperty)x.finish();});
a.getAnimations().forEach(function(y){if(!y.transitionProperty||!y.effect)return;
var z=b.animate(y.effect.getKeyframes(),y.effect.getTiming());z.currentTime=y.currentTime;});
}
function swap(root){
reveal();
if(io)io.takeRecords().forEach(function(e){if(e.isIntersecting)e.target.setAttribute('data-reveal','in');});
if(!moved){
var live=[].slice.call(root.querySelectorAll('main section, footer'));
secs.forEach(function(s,i){var l=live[i];if(!l)return;
var sIn=s.getAttribute('data-reveal')==='in',lIn=l.getAttribute('data-reveal')==='in';
if(sIn&&!lIn)l.setAttribute('data-reveal','in');
pairs(s,l).forEach(function(p){sync(p[0],p[1],lIn&&!sIn);});});
}
if(io)io.disconnect();
pre.remove();de.classList.remove('dc-pre');
}
})();`;

function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function prerender(made) {
  const server = await serve(ROOT);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    // Captura a primeira renderização do React (antes de qualquer interação).
    await page.evaluateOnNewDocument(() => {
      new MutationObserver(function (recs, mo) {
        const root = document.getElementById('dc-root');
        if (!root || !root.firstElementChild) return;
        mo.disconnect();
        window.__snap = root.innerHTML;
        const rules = [];
        for (const s of document.styleSheets) {
          try { for (const r of s.cssRules) if (r.selectorText && /^\.scp[0-9a-z]+:/.test(r.selectorText)) rules.push(r.cssText); } catch (e) {}
        }
        window.__pseudo = rules.join('\n');
      }).observe(document, { childList: true, subtree: true });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__snap, { timeout: 30000 });
    if (errors.length) throw new Error('[build] erros no console durante a pré-renderização:\n' + errors.join('\n'));
    const hero = made['hero-bg.png'];
    const out = await page.evaluate((heroSrcset, heroSizes) => {
      const box = document.createElement('div');
      box.innerHTML = window.__snap;
      box.querySelectorAll('[data-dc-tpl]').forEach((n) => n.removeAttribute('data-dc-tpl'));
      box.querySelectorAll('[data-reveal],[data-reveal-mode]').forEach((n) => { n.removeAttribute('data-reveal'); n.removeAttribute('data-reveal-mode'); });
      box.querySelectorAll('[data-obs]').forEach((n) => n.removeAttribute('data-obs'));
      const hd = box.querySelector('#site-hd');
      if (hd) { hd.removeAttribute('data-hidden'); hd.removeAttribute('data-scrolled'); }
      // Vídeos: a cópia estática nunca baixa vídeo. O hero mostra o pôster como <img> (elemento de LCP).
      const v = box.querySelector('#hero-video');
      if (!v) throw new Error('hero-video ausente');
      const pic = document.createElement('picture');
      pic.innerHTML = `<source type="image/webp" srcset="${heroSrcset}" sizes="${heroSizes}">`;
      const img = document.createElement('img');
      img.className = 'hero-video';
      img.src = v.getAttribute('poster');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.width = 1672; img.height = 941;
      img.setAttribute('fetchpriority', 'high');
      pic.appendChild(img);
      v.replaceWith(pic);
      // Vídeo que substitui o GIF: na cópia estática, o pôster (mesmo quadro) como <img> lazy.
      box.querySelectorAll('video[data-gif]').forEach((x) => {
        const im = document.createElement('img');
        im.src = x.getAttribute('poster');
        im.alt = '';
        im.width = 800; im.height = 450;
        im.loading = 'lazy'; im.decoding = 'async';
        im.setAttribute('fetchpriority', 'low');
        im.setAttribute('style', x.getAttribute('style'));
        x.replaceWith(im);
      });
      box.querySelectorAll('video').forEach((x) => { x.removeAttribute('src'); x.removeAttribute('data-src'); x.removeAttribute('data-lazy'); x.removeAttribute('autoplay'); x.setAttribute('preload', 'none'); });
      box.querySelectorAll('iframe').forEach((x) => x.remove());
      // FAQ visível → FAQPage (texto idêntico ao da página)
      const faq = [...box.querySelectorAll('details.faq')].map((d) => ({
        q: d.querySelector('summary').textContent.trim(),
        a: [...d.children].filter((c) => c.tagName !== 'SUMMARY').map((c) => c.textContent.trim()).join(' ')
      }));
      return { html: box.innerHTML, faq, text: box.textContent.replace(/\s+/g, ' '), h1: box.querySelectorAll('h1').length, placeholders: (box.innerHTML.match(/\{\{[^}]*\}\}/g) || []) };
    }, srcset(hero.webp), SIZES.hero);
    out.pseudo = await page.evaluate(() => window.__pseudo);
    if (out.placeholders.length) throw new Error('[build] placeholders não resolvidos na pré-renderização: ' + out.placeholders.join(', '));
    if (out.h1 !== 1) throw new Error(`[build] a home deve ter 1 <h1> (encontrado ${out.h1})`);
    return out;
  } finally {
    await browser.close();
    server.close();
  }
}

/* ------------------------------------------------------------------ */
/* 5. SEO: head, JSON-LD, robots, sitemap, llms.txt                    */
/* ------------------------------------------------------------------ */
function jsonLd(faq) {
  const home = `${SITE_ORIGIN}/`;
  const c = SEO.contact;
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${home}#organization`,
      name: SEO.siteName,
      url: home,
      logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/assets/sipi-logo.png`, width: 1983, height: 793 },
      description: SEO.orgDescription,
      email: c.email,
      telephone: c.telephone,
      address: { '@type': 'PostalAddress', streetAddress: c.streetAddress, addressLocality: 'São Paulo', addressRegion: 'SP', addressCountry: 'BR' },
      sameAs: [c.instagram]
    },
    {
      '@type': 'WebSite',
      '@id': `${home}#website`,
      url: home,
      name: SEO.siteName,
      inLanguage: 'pt-BR',
      publisher: { '@id': `${home}#organization` }
    },
    {
      '@type': 'WebPage',
      '@id': `${home}#webpage`,
      url: home,
      name: SEO.pages.home.t,
      description: SEO.pages.home.d,
      inLanguage: 'pt-BR',
      isPartOf: { '@id': `${home}#website` },
      about: { '@id': `${home}#sistema-sipi` },
      primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/${SEO.ogImage.path}`, width: SEO.ogImage.width, height: SEO.ogImage.height }
    },
    {
      '@type': 'Service',
      '@id': `${home}#sistema-sipi`,
      name: SEO.service.name,
      alternateName: SEO.service.alternateName,
      serviceType: SEO.service.serviceType,
      description: SEO.service.description,
      provider: { '@id': `${home}#organization` },
      areaServed: { '@type': 'State', name: 'São Paulo', containedInPlace: { '@type': 'Country', name: 'Brasil' } },
      url: home
    }
  ];
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${home}#faq`,
      url: home,
      inLanguage: 'pt-BR',
      isPartOf: { '@id': `${home}#website` },
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function head({ css, ld, rt }) {
  const p = SEO.pages.home;
  const home = `${SITE_ORIGIN}/`;
  const og = `${SITE_ORIGIN}/${SEO.ogImage.path}`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.t)}</title>
<meta name="description" content="${esc(p.d)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${home}">
<meta property="og:locale" content="pt_BR">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SEO.siteName)}">
<meta property="og:title" content="${esc(p.t)}">
<meta property="og:description" content="${esc(p.d)}">
<meta property="og:url" content="${home}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="${SEO.ogImage.width}">
<meta property="og:image:height" content="${SEO.ogImage.height}">
<meta property="og:image:alt" content="${esc(SEO.ogImage.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.t)}">
<meta name="twitter:description" content="${esc(p.d)}">
<meta name="twitter:image" content="${og}">
<meta name="twitter:image:alt" content="${esc(SEO.ogImage.alt)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="data:,">
<link rel="preload" href="${FONTS.inter}-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${FONTS.grotesk}-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>
${css}
</style>
<script defer src="${VENDOR.react}"></script>
<script defer src="${VENDOR.reactDom}"></script>
<script defer src="support.js?v=${rt.supportV}"></script>
<script type="application/ld+json">${ld}</script>
</head>`;
}

function seoFiles(faq) {
  const today = new Date().toISOString().slice(0, 10);
  write(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  write(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
    <lastmod>${today}</lastmod>
  </url>
</urlset>
`);
  write(path.join(ROOT, 'llms.txt'), `# SIPI Engenharia

> A SIPI Engenharia desenvolve o Sistema Integrado de Pavimento Industrializado (SIPI), uma solução para industrialização da execução de pavimentos em edifícios de alvenaria estrutural.

## Sistema SIPI

O Sistema SIPI integra:
- engenharia e compatibilização
- planejamento
- fabricação industrial
- transporte e logística
- içamento
- escoramento
- montagem

## Laje pronta

A proposta da SIPI é entregar a laje pronta dentro de uma operação integrada. Não se trata apenas do fornecimento de uma pré-laje.

A SIPI complementa a operação da construtora e não executa a alvenaria estrutural.

## Instalações

Eletrodutos e caixas elétricas previstos em projeto podem ser incorporados às peças durante a fabricação.

As passagens hidráulicas são previstas por meio de reservas na peça; a tubulação hidráulica é executada posteriormente.

## Aplicação

O foco inicial é em edifícios residenciais de alvenaria estrutural no estado de São Paulo.

A aplicação depende da análise técnica do projeto, fase da obra, logística e condições de implantação.

## Perguntas frequentes

${faq.map((f) => `- ${f.q}`).join('\n')}

## Páginas

- [Início](${SITE_ORIGIN}/): visão geral do Sistema SIPI, etapas, benefícios e perguntas frequentes
- [Sistema SIPI](${SITE_ORIGIN}/#/sistema): o que é a laje pronta, diferença para a pré-laje e como o sistema funciona
- [Empresa](${SITE_ORIGIN}/#/empresa): atuação da SIPI Engenharia e foco inicial de aplicação
- [Avaliação de empreendimento](${SITE_ORIGIN}/#/contato): envio dos dados da obra para avaliação técnica

## Contato

- E-mail: ${SEO.contact.email}
- Telefone: ${SEO.contact.telephoneVisible}
- Endereço: ${SEO.contact.addressVisible}

## Website

${SITE_ORIGIN}/
`);
}

/* ------------------------------------------------------------------ */
/* montagem                                                            */
/* ------------------------------------------------------------------ */
async function main() {
  const rt = buildRuntime();
  log('runtime ok');
  const made = await buildImages();
  log('imagens ok');
  const src = parseSource();
  const template = transformTemplate(src.template, made);
  const logic = transformLogic(src.logic, rt);
  const cssParts = (pseudo) => [fontCss(), rt.BASE_CSS, rt.FULL_PAGE_CSS, rt.ATOMIC_CSS, src.designCss.trim(), PRE_CSS, pseudo].filter(Boolean).join('\n');
  const body = (pre) => `<body>
<x-dc></x-dc>
${pre}
<script type="text/x-dc-template" id="dc-template">${template}</script>
${src.logicTag}${logic}</script>
</body>
</html>
`;
  // passo 1: página sem pré-renderização, usada para capturar a primeira renderização
  write(path.join(ROOT, 'index.html'), head({ css: cssParts(''), ld: '{}', rt }) + '\n' + body(''));
  const snap = await prerender(made);
  log('pré-renderização ok —', snap.faq.length, 'perguntas no FAQ');
  const c = SEO.contact;
  for (const needle of [c.email, c.telephoneVisible, c.addressVisible, '@sipi.engenharia']) {
    if (!snap.text.includes(needle)) throw new Error(`[build] dado de contato do JSON-LD não aparece no conteúdo: ${needle}`);
  }
  // passo 2: página final
  const pre = `<div id="dc-pre">${snap.html}</div>\n<script>${PRE_SCRIPT}</script>`;
  write(path.join(ROOT, 'index.html'), head({ css: cssParts(snap.pseudo), ld: jsonLd(snap.faq), rt }) + '\n' + body(pre));
  seoFiles(snap.faq);
  log('index.html, robots.txt, sitemap.xml e llms.txt gerados para', SITE_ORIGIN);
}

main().catch((e) => { console.error(e); process.exit(1); });
