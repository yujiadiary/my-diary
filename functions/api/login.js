// POST /api/login
// body: { password }
// 返回: { token, role }
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const password = body && body.password;
  const expected = env.ADMIN_PASSWORD || 'diary2024';
  if (!password || password !== expected) {
    return new Response(JSON.stringify({ error: '密码不对' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  const { signToken, json } = await import('../_lib/util.js');
  const token = await signToken(env, { role: 'admin' });
  return json({ token, role: 'admin' });
}

export async function onRequestOptions() {
  const { handleCors } = await import('../_lib/util.js');
  return handleCors(true);
}
