import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { DIST_DIR } from './paths.ts';

/** `npm run preview` — a dependency-free static server over dist/. */

const PORT = Number(process.env.PORT ?? 8080);

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/atom+xml; charset=utf-8',
};

createServer((req, res) => {
  // normalize + prefix check keeps `../` out of the served path.
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const path = normalize(join(DIST_DIR, requested.endsWith('/') ? `${requested}index.html` : requested));

  if (!path.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if (statSync(path).isDirectory()) {
      res.writeHead(301, { location: `${requested}/` }).end();
      return;
    }
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(PORT, () => console.log(`Preview at http://localhost:${PORT}/`));
