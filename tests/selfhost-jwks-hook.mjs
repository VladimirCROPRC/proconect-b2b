// Only loaded by the smoke-test child process with --import, never by the app.
import { readFileSync } from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://test-team.cloudflareaccess.com/cdn-cgi/access/certs') return Promise.resolve(Response.json(JSON.parse(readFileSync(process.env.SELFHOST_TEST_JWKS, 'utf8'))));
  return original(input, options);
};
