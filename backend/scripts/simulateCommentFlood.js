require('dotenv').config();

function getArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return fallback;
  return arg.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printUsage() {
  console.log(`Usage:
Options:
  --videoId        Required. Target video ID for posting comments.
  --count          Number of requests to send (default: 70).
  --concurrency    Parallel request workers (default: 10).
  --baseUrl        API base URL (default: http://localhost:5000).
  --token          JWT token to use directly.
  --email          Login email (if token is not provided).
  --password       Login password (if token is not provided).
  --prefix         Comment text prefix (default: rate-limit-test).
  --help           Show this message.
`);
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

async function loginAndGetToken(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) {
    throw new Error(body.error || body.message || `Login failed (HTTP ${response.status})`);
  }

  return body.token;
}

async function postComment(baseUrl, token, videoId, content) {
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  });

  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body,
    headers: {
      retryAfter: response.headers.get('retry-after'),
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    },
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error.message || String(error) };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main() {
  if (hasFlag('help')) {
    printUsage();
    return;
  }

  const baseUrl = getArg('baseUrl', process.env.API_BASE_URL || 'http://localhost:5000');
  const videoId = toInt(getArg('videoId'), NaN);
  const totalRequests = toInt(getArg('count', '70'), 70);
  const concurrency = toInt(getArg('concurrency', '10'), 10);
  const tokenArg = getArg('token');
  const email = getArg('email', process.env.RATE_TEST_EMAIL);
  const password = getArg('password', process.env.RATE_TEST_PASSWORD);
  const messagePrefix = getArg('prefix', 'rate-limit-test');

  if (!Number.isFinite(videoId) || videoId <= 0) {
    throw new Error('Prosledi validan --videoId=<id>.');
  }

  if (!Number.isFinite(totalRequests) || totalRequests <= 0) {
    throw new Error('Prosledi validan --count=<broj>.');
  }

  let token = tokenArg;
  if (!token) {
    if (!email || !password) {
      throw new Error('Nedostaje token. Prosledi --token ili --email i --password.');
    }
    token = await loginAndGetToken(baseUrl, email, password);
  }

  const payloads = Array.from({ length: totalRequests }, (_, index) => ({
    content: `${messagePrefix}-${index + 1}-${Date.now()}`,
  }));

  console.log('--- Comment Rate Limit Simulation ---');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Video ID: ${videoId}`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Concurrency: ${concurrency}`);

  const startedAt = Date.now();
  const results = await runWithConcurrency(payloads, concurrency, async (item) => {
    return postComment(baseUrl, token, videoId, item.content);
  });
  const durationMs = Date.now() - startedAt;

  let okCount = 0;
  let tooManyCount = 0;
  let otherErrors = 0;
  let first429 = null;

  for (const result of results) {
    if (!result) {
      otherErrors += 1;
      continue;
    }

    if (result.error) {
      otherErrors += 1;
      continue;
    }

    if (result.status >= 200 && result.status < 300) {
      okCount += 1;
    } else if (result.status === 429) {
      tooManyCount += 1;
      if (!first429) first429 = result;
    } else {
      otherErrors += 1;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Duration: ${durationMs} ms`);
  console.log(`2xx responses: ${okCount}`);
  console.log(`429 responses: ${tooManyCount}`);
  console.log(`Other failures: ${otherErrors}`);

  if (first429) {
    console.log('\n--- First 429 details ---');
    console.log(`Message: ${first429.body?.error || JSON.stringify(first429.body)}`);
    console.log(`Retry-After: ${first429.headers.retryAfter}`);
    console.log(`X-RateLimit-Limit: ${first429.headers.limit}`);
    console.log(`X-RateLimit-Remaining: ${first429.headers.remaining}`);
    console.log(`X-RateLimit-Reset: ${first429.headers.reset}`);
  }

  const expectedMaxPerHour = 60;
  if (okCount > expectedMaxPerHour) {
    console.log(`\nWARNING: Primljeno je ${okCount} uspešnih komentara (> ${expectedMaxPerHour}). Proveri limiter.`);
    process.exitCode = 1;
    return;
  }

  if (tooManyCount === 0 && totalRequests > expectedMaxPerHour) {
    console.log(`\nWARNING: Nije dobijen nijedan 429 iako je poslato ${totalRequests} zahteva.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: limiter je aktivan i ograničenje se primenjuje.');
}

main().catch((error) => {
  console.error('Simulation failed:', error.message || error);
  process.exit(1);
});
