# Build de produção do site SIPI

Esta pasta transforma o export do Claude Design no site publicado na raiz do
repositório. Pastas que começam com `_` não são publicadas pelo GitHub Pages.
Não envie esta pasta para a hospedagem final (KingHost, Cloudflare etc.).

## Como atualizar o site com um novo export

1. Copie os arquivos do novo export para `_build/src/`:
   - `SIPI Site.dc.html`
   - `support.js`
   - `sipi-scene.js`
2. Copie imagens novas para `assets/`. Se uma imagem nova entrar no layout,
   adicione-a em `IMAGES` no `build.mjs`.
3. Rode:

   ```sh
   cd _build
   npm install        # na primeira vez (aprove os install scripts de sharp e ffmpeg-static, se o npm pedir)
   npm run build
   ```

4. Confira o site localmente e faça o commit dos arquivos gerados.

O build falha com uma mensagem clara se algum trecho esperado do export mudar,
por exemplo se o `<helmet>`, uma imagem ou um dado de contato deixar de existir.

## Configuração

- `SITE_ORIGIN`: domínio canônico (padrão `https://sipiengenharia.com.br`). Ele é
  usado no canonical, no Open Graph, no JSON-LD, no `robots.txt`, no `sitemap.xml`
  e no `llms.txt`. Exemplo: `SITE_ORIGIN=https://outro.dominio npm run build`.
- `CHROME_PATH`: caminho do Chrome usado na pré-renderização (padrão: Chrome do macOS).
- Títulos e descrições por seção, dados da organização e do serviço: objeto `SEO`
  no início do `build.mjs`.

## O que o build gera

| Saída | Origem |
| --- | --- |
| `index.html` | export + home pré-renderizada + metadados + JSON-LD |
| `support.js`, `sipi-scene.js` | runtime e cena 3D com os patches `SIPI build patch` |
| `assets/opt/` | variantes AVIF/WebP das imagens e o GIF em AVIF animado |
| `assets/og/sipi-og.jpg` | imagem de compartilhamento (recorte do visual do hero) |
| `robots.txt`, `sitemap.xml`, `llms.txt` | SEO |

`vendor/` (React 18.3.1 e Three.js 0.160.0) e `fonts/` (Inter e Space Grotesk,
licença OFL) são cópias fixas das mesmas versões que o export usava via CDN.

## Como a home pré-renderizada funciona

O runtime do Claude Design monta a página com React no navegador. Para que o
conteúdo apareça antes do JavaScript, e para que buscadores leiam o texto real
em vez de `{{ placeholders }}`, o build captura a primeira renderização da home
e grava esse HTML em `#dc-pre`.

Quando o React termina de montar `#dc-root`, um script curto faz três coisas no
mesmo quadro: transfere o estado das animações de entrada, usa o mesmo pôster
no vídeo do hero e remove a cópia estática. A árvore React continua sendo a
responsável por toda a interação, exatamente como no export.

## Deploy definitivo em sipiengenharia.com.br

O canonical, o Open Graph, o JSON-LD, o `robots.txt` e o `sitemap.xml` já apontam
para `https://sipiengenharia.com.br/`. Enquanto o site estiver só no GitHub Pages,
o canonical indica ao Google qual será a URL oficial. Nada impede os testes em
`rafilsk182.github.io/sipi/`.

Ao ativar o domínio:

1. **Evitar conteúdo duplicado com o GitHub Pages**
   - Se o site continuar hospedado no GitHub Pages: configure `sipiengenharia.com.br`
     como *custom domain* (Settings → Pages). O endereço `github.io` passa a
     redirecionar (301) para o domínio.
   - Se for para a KingHost ou o Cloudflare Pages: desative o GitHub Pages depois
     da migração. Se não puder, publique ali uma página que redirecione para o domínio.
2. **Cabeçalhos**: `.htaccess` (KingHost/Apache) e `_headers` (Cloudflare Pages)
   já estão na raiz, com cache (HTML revalidado, arquivos com hash por 1 ano) e
   cabeçalhos de segurança. Não envie a pasta `_build/`.
3. **HTTPS**: ative o certificado e redirecione `http://` e `www.` para
   `https://sipiengenharia.com.br/` (301).
4. **Search Console**: verifique o domínio e envie `https://sipiengenharia.com.br/sitemap.xml`.
5. **Favicon**: o site usa um ícone vazio (`data:`) para evitar o 404 de
   `/favicon.ico`. Quando houver um favicon oficial, adicione-o no `head()` do `build.mjs`.
6. **CSP (opcional)**: o runtime compila a lógica com `new Function` e usa scripts
   inline, então a política precisa de `'unsafe-inline'` e `'unsafe-eval'`. Teste
   antes como `Content-Security-Policy-Report-Only`:

   ```
   default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';
   img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self';
   frame-src https://www.youtube-nocookie.com; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
   ```
