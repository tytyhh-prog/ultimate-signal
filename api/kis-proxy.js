const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

export default async function handler(req, res) {
  const { _path, ...queryParams } = req.query;

  if (!_path) {
    return res.status(400).json({ error: 'Missing _path parameter' });
  }

  const url = new URL(`${KIS_BASE}${_path}`);
  Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));

  console.log(`[KIS Proxy] ${req.method} ${_path}`);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'appkey': process.env.KIS_APP_KEY,
    'appsecret': process.env.KIS_APP_SECRET,
  };

  ['authorization', 'tr_id', 'custtype', 'tr_cont', 'gt_uid'].forEach(h => {
    if (req.headers[h]) headers[h] = req.headers[h];
  });

  const options = { method: req.method, headers };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body = req.body || {};
    if (_path === '/oauth2/tokenP') {
      body = { ...body, appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET };
    }
    options.body = JSON.stringify(body);
  }

  try {
    const upstream = await fetch(url.toString(), options);
    const data = await upstream.json();
    console.log(`[KIS Proxy] ${_path} → ${upstream.status}`);
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error(`[KIS Proxy] ${_path} ERROR:`, err.message);
    res.status(500).json({ error: 'KIS proxy error', message: err.message });
  }
}
